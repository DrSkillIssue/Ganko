/**
 * Cross-File ESLint Plugin Adapter
 *
 * Bridges ganko's cross-file rules into ESLint's plugin format.
 *
 * Cross-file rules require both SolidGraph and CSSGraph. In ESLint's
 * per-file model, these rules run on Solid files (.tsx/.jsx/.ts) and
 * resolve CSS files from static import declarations.
 *
 * Uses createBatchPluginAdapter: all cross-file rules share one analysis
 * pass per SourceCode instance, avoiding redundant graph construction.
 */
import { CSS_EXTENSIONS, canonicalPath, matchesExtension } from "@ganko/shared"
import { createBatchPluginAdapter, buildSolidInputFromContext } from "../eslint-adapter"
import type { RuleContext } from "../eslint-adapter"
import type { CrossRuleContext } from "./rule"
import { SolidGraph } from "../solid/impl"
import { runPhases as runSolidPhases } from "../solid/phases"
import type { CSSInput } from "../css/input"
import { buildCSSGraph } from "../css/plugin"
import { buildLayoutGraph } from "./layout"
import { runCrossFileRules } from "./plugin"
import { resolveTailwindValidatorSync } from "../css/tailwind"
import { rules } from "./rules"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

function findImportedCSS(graph: SolidGraph): readonly { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  const seen = new Set<string>()
  const baseDir = dirname(graph.file)

  for (let i = 0; i < graph.imports.length; i++) {
    const imp = graph.imports[i]
    if (!imp) continue
    const source = imp.source
    if (!matchesExtension(source, CSS_EXTENSIONS)) continue
    const filePath = canonicalPath(resolve(baseDir, source))
    if (!existsSync(filePath)) continue
    if (seen.has(filePath)) continue
    seen.add(filePath)
    out.push({ path: filePath, content: readFileSync(filePath, "utf-8") })
  }

  return out
}

function buildCrossContext(context: RuleContext): CrossRuleContext {
  const input = buildSolidInputFromContext(context)
  const solidGraph = new SolidGraph(input)
  runSolidPhases(solidGraph, input)

  const cssFiles = findImportedCSS(solidGraph)
  const tailwind = cssFiles.length > 0 ? resolveTailwindValidatorSync(cssFiles) : null
  const resolved = tailwind ?? undefined
  const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles }
  if (resolved !== undefined) cssInput.tailwind = resolved
  const cssGraph = buildCSSGraph(cssInput)
  return {
    solids: [solidGraph],
    css: cssGraph,
    layout: buildLayoutGraph([solidGraph], cssGraph),
  }
}

export const { eslintRules } = createBatchPluginAdapter(
  rules,
  buildCrossContext,
  runCrossFileRules,
)

export { rules }
