/**
 * Prepare Phase (Phase 1)
 *
 * Validates that the TypeScript SourceFile has parent links set.
 * This is a prerequisite for all subsequent phases that traverse the AST.
 *
 * Throws an error if parent links are missing, indicating incorrect parser config.
 */
import type ts from "typescript";
import type { SolidBuildContext } from "../build-context"
import type { SolidInput } from "../input";

/**
 * Validates that AST has parent links set by TypeScript parser.
 * When using ts.createSourceFile with setParentNodes=true, every
 * child node's .parent points back to its parent.
 */
function validateParentLinks(sourceFile: ts.SourceFile): void {
  const firstStmt = sourceFile.statements[0];
  if (firstStmt && !firstStmt.parent) {
    throw new Error(
      "AST missing parent links. Use ts.createSourceFile with setParentNodes=true",
    );
  }
}

export function runPreparePhase(_graph: SolidBuildContext, input: SolidInput): void {
    validateParentLinks(input.sourceFile);
}
