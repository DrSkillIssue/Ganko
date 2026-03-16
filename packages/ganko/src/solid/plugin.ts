import type ts from "typescript"
import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { SolidInput } from "./input"
import { SolidGraph } from "./impl"
import { runPhases } from "./phases"
import { rules } from "./rules"
import { createSolidInput } from "./create-input"
import { createSuppressionEmit } from "../suppression"
import { SOLID_EXTENSIONS, matchesExtension } from "@drskillissue/ganko-shared"

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
  runRules(rules, graph, createSuppressionEmit(input.sourceFile, emit))
}

/**
 * Run single-file Solid rules on a pre-built graph.
 *
 * Separates rule execution from graph construction so callers that
 * cache graphs (e.g. CLI lint) can build once, run single-file rules,
 * and reuse the same graph for cross-file analysis.
 */
export function runSolidRules(graph: SolidGraph, sourceFile: ts.SourceFile, emit: Emit): void {
  runRules(rules, graph, createSuppressionEmit(sourceFile, emit))
}

/**
 * The Solid.js plugin.
 *
 * Analyzes Solid.js files by building a SolidGraph and running all rules.
 * Rules push diagnostics via the emit callback.
 */
export const SolidPlugin: Plugin<"solid"> = {
  kind: "solid",
  extensions: SOLID_EXTENSIONS,

  analyze(files: readonly string[], emit: Emit, context?: { program: ts.Program }): void {
    if (!context) {
      throw new Error("SolidPlugin.analyze requires a context with ts.Program")
    }
    const { program } = context
    for (const file of files) {
      if (!matchesExtension(file, SOLID_EXTENSIONS)) continue
      const input = createSolidInput(file, program)
      const graph = buildSolidGraph(input)
      runRules(rules, graph, createSuppressionEmit(input.sourceFile, emit))
    }
  },
}
