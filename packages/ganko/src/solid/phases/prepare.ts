/**
 * Prepare Phase (Phase 1)
 *
 * Validates that the AST has parent links set by the TypeScript-ESLint parser.
 * This is a prerequisite for all subsequent phases that traverse the AST.
 *
 * Throws an error if parent links are missing, indicating incorrect parser config.
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";

/**
 * Validates that AST has parent links set by typescript-eslint parser.
 */
function validateParentLinks(ast: T.Program): void {
  const firstStmt = ast.body[0];
  if (ast.body.length > 0 && firstStmt && firstStmt.parent !== ast) {
    throw new Error(
      "AST missing parent links. Configure typescript-eslint with parserOptions.project",
    );
  }
}

export function runPreparePhase(_graph: SolidGraph, input: SolidInput): void {
    validateParentLinks(input.sourceCode.ast);
}
