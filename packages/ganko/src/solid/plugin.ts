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

export function analyzeInput(input: SolidInput, emit: Emit): void {
  const tree = buildSolidSyntaxTree(input, "")
  runRules(rules, tree, createSuppressionEmit(input.sourceFile, emit, tree.comments))
}

export function runSolidRules(tree: SolidSyntaxTree, sourceFile: ts.SourceFile, emit: Emit): void {
  runRules(rules, tree, createSuppressionEmit(sourceFile, emit, tree.comments))
}

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
      const tree = buildSolidSyntaxTree(input, "")
      runRules(rules, tree, createSuppressionEmit(input.sourceFile, emit, tree.comments))
    }
  },
}
