import type ts from "typescript"
import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { SolidInput } from "./input"
import type { SolidSyntaxTree } from "../compilation/core/solid-syntax-tree"
import { buildSolidSyntaxTree } from "./impl"
import { rules } from "./rules"
import { createSolidInput } from "./create-input"
import { createSuppressionEmit } from "../suppression"
import { SOLID_EXTENSIONS, matchesExtension } from "@drskillissue/ganko-shared"

/**
 * Build a SolidSyntaxTree from input.
 *
 * Exported for use by cross-file rules that need to build trees
 * without running all solid rules.
 */
export function buildSolidGraph(input: SolidInput): SolidSyntaxTree {
  return buildSolidSyntaxTree(input, "")
}

/**
 * Analyze pre-parsed input and emit diagnostics.
 *
 * For use by ESLint integration and LSP where the caller
 * has already parsed the file (e.g. ESLint provides SourceCode).
 */
export function analyzeInput(input: SolidInput, emit: Emit): void {
  const tree = buildSolidGraph(input)
  runRules(rules, tree, createSuppressionEmit(input.sourceFile, emit, tree.comments))
}

/**
 * Run single-file Solid rules on a pre-built tree.
 *
 * Separates rule execution from tree construction so callers that
 * cache trees (e.g. CLI lint) can build once, run single-file rules,
 * and reuse the same tree for cross-file analysis.
 */
export function runSolidRules(tree: SolidSyntaxTree, sourceFile: ts.SourceFile, emit: Emit): void {
  runRules(rules, tree, createSuppressionEmit(sourceFile, emit, tree.comments))
}

/**
 * The Solid.js plugin.
 *
 * Analyzes Solid.js files by building a SolidSyntaxTree and running all rules.
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
      const tree = buildSolidGraph(input)
      runRules(rules, tree, createSuppressionEmit(input.sourceFile, emit, tree.comments))
    }
  },
}
