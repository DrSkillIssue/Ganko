import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { CSSInput, CSSFile } from "./input"
import { CSSGraph } from "./impl"
import { runPhases } from "./phases"
import { rules } from "./rules"
import { generateExternalPropertiesCSS } from "./library-analysis"
import { readFileSync } from "node:fs"
import { CSS_EXTENSIONS, matchesExtension } from "@ganko/shared"

/**
 * Synthetic file path for externally-provided CSS custom properties.
 * Uses a path that cannot collide with real filesystem paths.
 */
const EXTERNAL_PROPERTIES_PATH = "<external-library-properties>"

/**
 * Build a CSSGraph from input.
 *
 * When `externalCustomProperties` is present in the input, generates a synthetic
 * CSS file declaring those properties in `:root` and includes it in the graph.
 * This ensures library-provided custom properties resolve through the normal
 * cascade and resolution pipeline.
 *
 * Exported for use by cross-file rules that need to build graphs
 * without running all CSS rules.
 */
export function buildCSSGraph(input: CSSInput): CSSGraph {
  const effectiveInput = injectExternalPropertiesFile(input)
  const graph = new CSSGraph(effectiveInput)
  runPhases(graph, effectiveInput)
  return graph
}

/**
 * If the input includes external custom properties, generate a synthetic CSS file
 * declaring them in `:root` and prepend it to the file list. The synthetic file
 * is parsed through the normal pipeline, producing real `VariableEntity` entries
 * with `scope.type === "global"`.
 */
function injectExternalPropertiesFile(input: CSSInput): CSSInput {
  const externalProps = input.externalCustomProperties
  if (!externalProps || externalProps.size === 0) return input

  const syntheticCSS = generateExternalPropertiesCSS(externalProps)
  if (syntheticCSS === null) return input

  const syntheticFile: CSSFile = {
    path: EXTERNAL_PROPERTIES_PATH,
    content: syntheticCSS,
  }

  // Prepend the synthetic file so its variables are available for resolution
  // but have the lowest source order (real declarations take precedence)
  return {
    ...input,
    files: [syntheticFile, ...input.files],
  }
}

/**
 * Analyze pre-parsed CSS input and emit diagnostics.
 *
 * For use by callers that have already read file content
 * (e.g. LSP with unsaved changes).
 */
export function analyzeCSSInput(input: CSSInput, emit: Emit): void {
  const graph = buildCSSGraph(input)
  runRules(rules, graph, emit)
}

/**
 * The CSS plugin.
 *
 * Analyzes CSS/SCSS files by reading from disk, building a CSSGraph,
 * and running all rules. Rules push diagnostics via the emit callback.
 *
 * @example
 * ```ts
 * import { createRunner, CSSPlugin } from "ganko"
 *
 * const runner = createRunner({ plugins: [CSSPlugin] })
 * const diagnostics = runner.run(["src/styles/app.css"])
 * ```
 */
export const CSSPlugin: Plugin<"css"> = {
  kind: "css",
  extensions: CSS_EXTENSIONS,

  /**
   * Analyze CSS files and emit diagnostics.
   *
   * Reads each file, builds the graph, and runs all rules.
   */
  analyze(files: readonly string[], emit: Emit): void {
    const cssFiles: CSSFile[] = []
    for (const file of files) {
      if (!matchesExtension(file, CSS_EXTENSIONS)) continue
      const content = readFileSync(file, "utf-8")
      cssFiles.push({ path: file, content })
    }
    if (cssFiles.length === 0) return
    const input: CSSInput = { files: cssFiles }
    const graph = buildCSSGraph(input)
    runRules(rules, graph, emit)
  },
}
