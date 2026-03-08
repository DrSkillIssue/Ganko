import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { TSESLint } from "@typescript-eslint/utils"
import type { SolidInput } from "./input"
import { SolidGraph } from "./impl"
import { runPhases } from "./phases"
import { rules } from "./rules"
import { parseFile } from "./parse"
import { createSuppressionEmit } from "../suppression"
import { SOLID_EXTENSIONS, matchesExtension } from "@ganko/shared"

/**
 * Build a SolidGraph from input.
 *
 * Exported for use by cross-file rules that need to build graphs
 * without running all solid rules.
 */
export function buildSolidGraph(input: SolidInput): SolidGraph {
  const graph = new SolidGraph(input)
  runPhases(graph, input)
  return graph
}

/**
 * Analyze pre-parsed input and emit diagnostics.
 *
 * For use by ESLint integration and LSP where the caller
 * has already parsed the file (e.g. ESLint provides SourceCode).
 */
export function analyzeInput(input: SolidInput, emit: Emit): void {
  const graph = buildSolidGraph(input)
  runRules(rules, graph, createSuppressionEmit(input.sourceCode, emit))
}

/**
 * Run single-file Solid rules on a pre-built graph.
 *
 * Separates rule execution from graph construction so callers that
 * cache graphs (e.g. CLI lint) can build once, run single-file rules,
 * and reuse the same graph for cross-file analysis.
 */
export function runSolidRules(graph: SolidGraph, sourceCode: TSESLint.SourceCode, emit: Emit): void {
  runRules(rules, graph, createSuppressionEmit(sourceCode, emit))
}

/**
 * The Solid.js plugin.
 *
 * Analyzes Solid.js files by reading from disk, parsing with
 * @typescript-eslint/parser, building a SolidGraph, and running all rules.
 * Rules push diagnostics via the emit callback.
 *
 * @example
 * ```ts
 * import { createRunner, SolidPlugin } from "ganko"
 *
 * const runner = createRunner({ plugins: [SolidPlugin] })
 * const diagnostics = runner.run(["src/App.tsx"])
 * ```
 */
export const SolidPlugin: Plugin<"solid"> = {
  kind: "solid",
  extensions: SOLID_EXTENSIONS,

  /**
   * Analyze Solid.js files and emit diagnostics.
   *
   * Reads each file, parses it, builds the graph, and runs all rules.
   */
  analyze(files: readonly string[], emit: Emit): void {
    for (const file of files) {
      if (!matchesExtension(file, SOLID_EXTENSIONS)) continue
      const input = parseFile(file)
      const graph = buildSolidGraph(input)
      runRules(rules, graph, createSuppressionEmit(input.sourceCode, emit))
    }
  },
}
