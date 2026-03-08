import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { SolidInput } from "../solid/input"
import type { CSSInput, CSSFile } from "../css/input"
import { buildSolidGraph } from "../solid/plugin"
import { buildCSSGraph } from "../css/plugin"
import { SOLID_EXTENSIONS, CSS_EXTENSIONS, canonicalPath as canonicalizePath, matchesExtension, noopLogger } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import { parseFile } from "../solid/parse"
import { rules } from "./rules"
import { rules as cssGraphRules } from "../css/rules"
import type { CrossRuleContext } from "./rule"
import { buildLayoutGraph, maybeLogLayoutPerf, publishLayoutPerfStatsForTest } from "./layout"
import { readFileSync } from "node:fs"
import { resolveTailwindValidatorSync } from "../css/tailwind"

/**
 * Input for cross-file analysis.
 */
export interface CrossFileInput {
  readonly solid: SolidInput | readonly SolidInput[]
  readonly css: CSSInput
}

/**
 * Deduplicate items by canonical path, preserving first occurrence.
 *
 * @param items - Input items to deduplicate
 * @param getPath - Extract the path field from an item
 * @param withPath - Produce a copy with the canonicalized path
 */
function dedupeByPath<T>(
  items: readonly T[],
  getPath: (item: T) => string,
  withPath: (item: T, canonical: string) => T,
): T[] {
  const out: T[] = []
  const seen = new Set<string>()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    const raw = getPath(item)
    const key = canonicalizePath(raw)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw === key ? item : withPath(item, key))
  }

  return out
}

function dedupeSolidInputs(inputs: readonly SolidInput[]): SolidInput[] {
  return dedupeByPath(inputs, (i) => i.file, (i, p) => ({ ...i, file: p }))
}

function dedupeCSSFiles(files: readonly CSSFile[]): CSSFile[] {
  return dedupeByPath(files, (f) => f.path, (f, p) => ({ ...f, path: p }))
}

/**
 * Run cross-file rules against pre-built graphs.
 *
 * Separates rule execution from graph construction so that callers
 * with cached graphs (e.g. LSP GraphCache) can skip redundant parsing.
 *
 * @param context Pre-built Solid, CSS, and layout graphs
 * @param emit Diagnostic emitter
 */
export function runCrossFileRules(context: CrossRuleContext, emit: Emit, log?: Logger): void {
  if (context.solids.length === 0) return

  const trackedEmit: Emit = (diagnostic) => {
    context.layout.perf.diagnosticsEmitted++
    emit(diagnostic)
  }

  /* CSS graph rules (property, selector, cascade, a11y, animation, structure)
     run against the full workspace CSSGraph so cross-file custom property
     resolution, duplicate detection, and cascade analysis are accurate. */
  runRules(cssGraphRules, context.css, trackedEmit)

  runRules(rules, context, trackedEmit)

  publishLayoutPerfStatsForTest(context.layout.perf)
  maybeLogLayoutPerf(context.layout.perf, log)
}

/**
 * Analyze pre-parsed cross-file input and emit diagnostics.
 *
 * For use by callers that have already parsed the inputs
 * (e.g. ESLint integration, LSP).
 *
 * @param input Parsed Solid and CSS inputs
 * @param emit Diagnostic emitter
 */
export function analyzeCrossFileInput(input: CrossFileInput, emit: Emit, logger: Logger = noopLogger): void {
  const solids = Array.isArray(input.solid) ? input.solid : [input.solid]
  const dedupedSolids = dedupeSolidInputs(solids)
  const dedupedCSSFiles = dedupeCSSFiles(input.css.files)
  if (dedupedSolids.length === 0 || dedupedCSSFiles.length === 0) return

  const solidGraphs = dedupedSolids.map((solid) => buildSolidGraph(solid))
  const tailwind = input.css.tailwind ?? resolveTailwindValidatorSync(dedupedCSSFiles)
  const resolvedTailwind = tailwind ?? undefined
  const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { ...input.css, files: dedupedCSSFiles, logger }
  if (resolvedTailwind !== undefined) cssInput.tailwind = resolvedTailwind
  const cssGraph = buildCSSGraph(cssInput)
  const context: CrossRuleContext = {
    solids: solidGraphs,
    css: cssGraph,
    layout: buildLayoutGraph(solidGraphs, cssGraph, logger),
  }
  runCrossFileRules(context, emit, logger)
}

/**
 * The cross-file plugin.
 *
 * Analyzes rules that require both Solid and CSS graphs.
 * Reads files from disk, parses them, and runs cross-file rules.
 *
 * @example
 * ```ts
 * import { createRunner, CrossFilePlugin } from "@drskillissue/ganko"
 *
 * const runner = createRunner({ plugins: [CrossFilePlugin] })
 * const diagnostics = runner.run(["src/App.tsx", "src/App.css"])
 * ```
 */
export const CrossFilePlugin: Plugin<"cross-file"> = {
  kind: "cross-file",
  extensions: [...SOLID_EXTENSIONS, ...CSS_EXTENSIONS],

  /**
   * Analyze cross-file rules and emit diagnostics.
   *
   * Separates files into Solid and CSS groups, builds both graphs,
   * then runs all cross-file rules.
   */
  analyze(files: readonly string[], emit: Emit): void {
    const cssFiles: CSSFile[] = []
    const solidInputs: SolidInput[] = []
    const seenCSS = new Set<string>()
    const seenSolid = new Set<string>()

    for (const file of files) {
      const key = canonicalizePath(file)

      if (matchesExtension(file, CSS_EXTENSIONS)) {
        if (seenCSS.has(key)) continue
        seenCSS.add(key)
        const content = readFileSync(key, "utf-8")
        cssFiles.push({ path: key, content })
        continue
      }

      if (matchesExtension(file, SOLID_EXTENSIONS)) {
        if (seenSolid.has(key)) continue
        seenSolid.add(key)
        try {
          solidInputs.push(parseFile(key))
        } catch {
          // Skip files with syntax errors — they cannot be analyzed
        }
      }
    }

    if (solidInputs.length === 0 || cssFiles.length === 0) return

    const solidGraphs = solidInputs.map((input) => buildSolidGraph(input))
    const tailwind = resolveTailwindValidatorSync(cssFiles)
    const resolvedTw = tailwind ?? undefined
    const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles }
    if (resolvedTw !== undefined) cssInput.tailwind = resolvedTw
    const cssGraph = buildCSSGraph(cssInput)
    const context: CrossRuleContext = {
      solids: solidGraphs,
      css: cssGraph,
      layout: buildLayoutGraph(solidGraphs, cssGraph),
    }

    runCrossFileRules(context, emit)
  },
}
