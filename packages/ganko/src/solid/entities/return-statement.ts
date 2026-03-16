/**
 * Return Statement Entity
 *
 * Represents a return statement in the program graph.
 */

import type ts from "typescript";

/**
 * Represents a return statement in the SolidGraph.
 */
export interface ReturnStatementEntity {
  id: number;
  node: ts.ReturnStatement;
  /** The containing function's ID */
  functionId: number;
  /** Whether this return has an argument (non-void return) */
  hasArgument: boolean;
  /** Whether this is an early return (not the last statement in function body) */
  isEarly: boolean;
}
