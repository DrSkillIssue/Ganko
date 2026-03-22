import ts from "typescript"
import { resolve } from "path"
import { buildSolidSyntaxTree } from "../../src/solid/impl"
import { analyzeInput } from "../../src/solid/plugin"
import { createSolidInput } from "../../src/solid/create-input"
import type { Emit } from "../../src/graph"
import type { SolidSyntaxTree, SolidInput } from "../../src"
import type { Diagnostic, FixOperation } from "../../src/diagnostic"

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
}

const defaultHost = ts.createCompilerHost(compilerOptions)

/**
 * Cache parsed lib SourceFile objects at module scope. Lib .d.ts files are
 * immutable so parsing them once and reusing across all ts.createProgram
 * invocations is safe and eliminates the dominant cost per call (~100 lib files).
 */
const MODULE_MARKER_RE = /export |import /
const LIB_CACHE_MAX = 200
const libSourceFileCache = new Map<string, ts.SourceFile | undefined>()

/**
 * Last program for incremental reuse. TypeScript's createProgram with
 * oldProgram reuses unchanged SourceFiles AND internal type checker
 * structures (symbol tables, flow graph caches). Since every test shares
 * the same ~100 lib files, this avoids rebuilding checker internals
 * from scratch for each of the 1500+ test invocations.
 */
let lastProgram: ts.Program | null = null

/**
 * Create an in-memory ts.Program from a map of virtual file contents.
 * Falls back to the real filesystem for lib files (e.g. lib.d.ts).
 * Uses oldProgram for incremental reuse of lib SourceFiles and checker state.
 */
export function createTestProgram(files: Map<string, string>): ts.Program {
  const fileMap = new Map<string, string>()
  for (const [key, value] of files) {
    fileMap.set(resolve(key), value)
  }

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      const content = fileMap.get(fileName)
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true)
      }
      const cached = libSourceFileCache.get(fileName)
      if (cached !== undefined) return cached
      if (libSourceFileCache.size >= LIB_CACHE_MAX) libSourceFileCache.clear()
      const sf = defaultHost.getSourceFile(fileName, languageVersion)
      libSourceFileCache.set(fileName, sf)
      return sf
    },
    fileExists(fileName) {
      return fileMap.has(fileName) || defaultHost.fileExists(fileName)
    },
    readFile(fileName) {
      return fileMap.get(fileName) ?? defaultHost.readFile(fileName)
    },
  }

  const opts: ts.CreateProgramOptions = {
    rootNames: [...fileMap.keys()],
    options: compilerOptions,
    host,
  }
  if (lastProgram) opts.oldProgram = lastProgram
  const program = ts.createProgram(opts)
  lastProgram = program
  return program
}

/**
 * Parse code and create SolidInput using the TypeScript compiler API.
 */
export function parseCode(code: string, filePath = "test.tsx"): SolidInput {
  const resolvedPath = resolve(filePath)
  const program = createTestProgram(new Map([[filePath, code]]))
  return createSolidInput(resolvedPath, program)
}

/**
 * Build a SolidSyntaxTree from code string.
 */
export function buildGraph(code: string, filePath = "test.tsx"): SolidSyntaxTree {
  const input = parseCode(code, filePath)
  return buildSolidSyntaxTree(input, "")
}

export interface RuleTestResult {
  diagnostics: readonly Diagnostic[]
  graph: SolidSyntaxTree
  code: string
}

/**
 * Run a single rule against code.
 */
export function checkRule(rule: { check: (graph: SolidSyntaxTree, emit: Emit) => void }, code: string): RuleTestResult {
  const graph = buildGraph(code)
  const diagnostics: Diagnostic[] = []
  rule.check(graph, (d) => diagnostics.push(d))
  return { diagnostics, graph, code }
}

/**
 * Batch rule checker — creates ONE ts.Program with all code snippets as separate
 * virtual files, then runs the rule against each file's graph independently.
 *
 * This eliminates the dominant cost of creating a separate ts.Program per test.
 * A batch of N snippets costs ~1 program creation instead of N.
 *
 * Usage:
 * ```ts
 * const batch = createRuleBatch(myRule, [
 *   `code snippet 1`,
 *   `code snippet 2`,
 *   ...
 * ])
 * // batch[0].diagnostics, batch[1].diagnostics, etc.
 * ```
 */
export function createRuleBatch(
  rule: { check: (graph: SolidSyntaxTree, emit: Emit) => void },
  snippets: readonly string[],
  setupPerSnippet?: readonly ((() => void) | null)[],
): readonly RuleTestResult[] {
  if (snippets.length === 0) return []

  // Build a single program with all snippets as separate virtual files.
  // Each snippet gets `export {}` appended to force TypeScript module mode,
  // ensuring separate module scopes (no global variable collisions).
  const fileMap = new Map<string, string>()
  for (let i = 0; i < snippets.length; i++) {
    const code = snippets[i]!
    // Only add export {} if the snippet doesn't already have an export/import
    const needsModuleMarker = !MODULE_MARKER_RE.test(code)
    fileMap.set(`batch_${i}.tsx`, needsModuleMarker ? code + "\nexport {}" : code)
  }
  const program = createTestProgram(fileMap)

  // Build SolidSyntaxTree and run rule for each file independently
  const results: RuleTestResult[] = []
  const collector: { target: Diagnostic[] | null } = { target: null }
  const collect = (d: Diagnostic) => collector.target!.push(d)
  for (let i = 0; i < snippets.length; i++) {
    const filePath = resolve(`batch_${i}.tsx`)
    const input = createSolidInput(filePath, program)
    const graph = buildSolidSyntaxTree(input, "")
    const diagnostics: Diagnostic[] = []
    const setup = setupPerSnippet?.[i]
    if (setup) setup()
    collector.target = diagnostics
    rule.check(graph, collect)
    results.push({ diagnostics, graph, code: snippets[i]! })
  }

  lastProgram = null

  return results
}

/**
 * Lazy batch rule checker — registers code snippets and creates the program
 * on first access. Designed for use at describe() scope where all snippets
 * are registered during module evaluation, then batch-compiled once when
 * the first test runs.
 *
 * Usage:
 * ```ts
 * describe("my-rule", () => {
 *   const batch = lazyRuleBatch(myRule)
 *   // Each call to batch.add() registers a snippet and returns its index
 *   const idx0 = batch.add(`code snippet 1`)
 *   const idx1 = batch.add(`code snippet 2`)
 *
 *   it("flags X", () => {
 *     // First access triggers batch compilation of ALL snippets
 *     expect(batch.result(idx0).diagnostics).toHaveLength(1)
 *   })
 *   it("allows Y", () => {
 *     expect(batch.result(idx1).diagnostics).toHaveLength(0)
 *   })
 * })
 * ```
 */
export function lazyRuleBatch(rule: { check: (graph: SolidSyntaxTree, emit: Emit) => void }): {
  add(code: string, setup?: () => void): number
  result(index: number): RuleTestResult
} {
  const snippets: string[] = []
  const setups: ((() => void) | null)[] = []
  let results: readonly RuleTestResult[] | null = null

  return {
    add(code: string, setup?: () => void): number {
      if (results !== null) throw new Error("Cannot add snippets after batch has been compiled")
      snippets.push(code)
      setups.push(setup ?? null)
      return snippets.length - 1
    },
    result(index: number): RuleTestResult {
      if (results === null) {
        results = createRuleBatch(rule, snippets, setups)
      }
      const r = results[index]
      if (!r) throw new Error(`No result at index ${index}, batch has ${results.length} results`)
      return r
    },
  }
}

/**
 * Batch parseCode — creates ONE ts.Program with all TSX snippets as separate
 * virtual files, then returns SolidInput per file. Use for cross-file tests
 * where each test needs a SolidInput but they can share a program.
 *
 * Usage:
 * ```ts
 * const batch = lazyParseBatch()
 * const s0 = batch.add(`import "./layout.css"; ...`, "/project/App.tsx")
 * const s1 = batch.add(`import "./layout.css"; ...`, "/project/Other.tsx")
 *
 * it("test", () => {
 *   // First access triggers batch compilation
 *   const input = batch.result(s0) // SolidInput
 *   analyzeCrossFileInput({ solid: input, css: { files } }, emit)
 * })
 * ```
 */
export function lazyParseBatch(): {
  add(code: string, filePath?: string): number
  result(index: number): SolidInput
} {
  const entries: { code: string; filePath: string }[] = []
  let results: SolidInput[] | null = null

  return {
    add(code: string, filePath?: string): number {
      if (results !== null) throw new Error("Cannot add snippets after batch has been compiled")
      const path = filePath ?? `/project/batch_${entries.length}.tsx`
      entries.push({ code, filePath: path })
      return entries.length - 1
    },
    result(index: number): SolidInput {
      if (results === null) {
        const fileMap = new Map<string, string>()
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!
          const code = entry.code
          const needsModuleMarker = !MODULE_MARKER_RE.test(code)
          fileMap.set(entry.filePath, needsModuleMarker ? code + "\nexport {}" : code)
        }
        const program = createTestProgram(fileMap)
        results = []
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!
          const resolvedPath = resolve(entry.filePath)
          results.push(createSolidInput(resolvedPath, program))
        }
        lastProgram = null
      }
      const r = results[index]
      if (!r) throw new Error(`No result at index ${index}, batch has ${results.length} results`)
      return r
    },
  }
}

/**
 * Run ALL rules against code.
 */
export function checkAll(code: string): RuleTestResult {
  const input = parseCode(code)
  const graph = buildSolidSyntaxTree(input, "")
  const diagnostics: Diagnostic[] = []
  analyzeInput(input, (d) => diagnostics.push(d))
  return { diagnostics, graph, code }
}

/**
 * Safely index into a readonly array, throwing if the element is missing.
 * Use in tests where the element is expected to exist.
 */
export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) throw new Error(`Expected element at index ${index}, but array length is ${arr.length}`)
  return value
}

/**
 * Apply all fixes to source code.
 */
export function applyAllFixes(code: string, diagnostics: readonly Diagnostic[]): string {
  const ops: FixOperation[] = []
  for (const d of diagnostics) {
    if (!d.fix) continue
    ops.push(...d.fix)
  }
  if (ops.length === 0) return code
  ops.sort((a, b) => b.range[0] - a.range[0])
  let result = code
  for (const op of ops) {
    result = result.slice(0, op.range[0]) + op.text + result.slice(op.range[1])
  }
  return result
}

/**
 * Apply the fix from a specific suggestion on a diagnostic.
 */
export function applySuggestion(code: string, diagnostic: Diagnostic, suggestionIndex: number): string {
  if (!diagnostic.suggest) throw new Error("Diagnostic has no suggestions")
  const suggestion = diagnostic.suggest[suggestionIndex]
  if (!suggestion) throw new Error(`No suggestion at index ${suggestionIndex}`)
  const ops = suggestion.fix.toSorted((a, b) => b.range[0] - a.range[0])
  let result = code
  for (const op of ops) {
    result = result.slice(0, op.range[0]) + op.text + result.slice(op.range[1])
  }
  return result
}
