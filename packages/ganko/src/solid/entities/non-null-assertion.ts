/**
 * Non-Null Assertion Entity
 *
 * Represents a TSNonNullExpression (the `!` operator) in the program graph.
 */

import type ts from "typescript";

/**
 * Represents a non-null assertion expression (`expr!`) in the SolidGraph.
 */
export interface NonNullAssertionEntity {
  readonly id: number;
  /** The TSNonNullExpression node */
  readonly node: ts.NonNullExpression;
  /** The expression being asserted as non-null */
  readonly expression: ts.Expression;
}
