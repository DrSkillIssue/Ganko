import ts from "typescript"
import { resolve } from "path"
import { buildSolidGraph, analyzeInput } from "../../src/solid/plugin"
import { createSolidInput } from "../../src/solid/create-input"
import type { Emit } from "../../src/graph"
import type { SolidGraph, SolidInput } from "../../src"
import type { Diagnostic, FixOperation } from "../../src/diagnostic"

/**
 * Create an in-memory ts.Program from a map of virtual file contents.
 * Falls back to the real filesystem for lib files (e.g. lib.d.ts).
 */
export function createTestProgram(files: Record<string, string>): ts.Program {
  // Normalize paths to absolute so TypeScript's internal path normalization matches
  const fileMap = new Map<string, string>()
  for (const [key, value] of Object.entries(files)) {
    fileMap.set(resolve(key), value)
  }
  const defaultHost = ts.createCompilerHost({})

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      const content = fileMap.get(fileName)
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true)
      }
      return defaultHost.getSourceFile(fileName, languageVersion)
    },
    fileExists(fileName) {
      return fileMap.has(fileName) || defaultHost.fileExists(fileName)
    },
    readFile(fileName) {
      return fileMap.get(fileName) ?? defaultHost.readFile(fileName)
    },
  }

  return ts.createProgram({
    rootNames: [...fileMap.keys()],
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    host,
  })
}

/**
 * Parse code and create SolidInput using the TypeScript compiler API.
 */
export function parseCode(code: string, filePath = "test.tsx"): SolidInput {
  const resolvedPath = resolve(filePath)
  const program = createTestProgram({ [filePath]: code })
  return createSolidInput(resolvedPath, program)
}

/**
 * Build a SolidGraph from code string.
 */
export function buildGraph(code: string, filePath = "test.tsx"): SolidGraph {
  const input = parseCode(code, filePath)
  return buildSolidGraph(input)
}

export interface RuleTestResult {
  diagnostics: readonly Diagnostic[]
  graph: SolidGraph
  code: string
}

/**
 * Run a single rule against code.
 */
export function checkRule(rule: { check: (graph: SolidGraph, emit: Emit) => void }, code: string): RuleTestResult {
  const graph = buildGraph(code)
  const diagnostics: Diagnostic[] = []
  rule.check(graph, (d) => diagnostics.push(d))
  return { diagnostics, graph, code }
}

/**
 * Run ALL rules against code.
 */
export function checkAll(code: string): RuleTestResult {
  const input = parseCode(code)
  const graph = buildSolidGraph(input)
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
