/**
 * Non-Null Assertion Entity
 *
 * Represents a TSNonNullExpression (the `!` operator) in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

/**
 * Represents a non-null assertion expression (`expr!`) in the SolidGraph.
 */
export interface NonNullAssertionEntity {
  readonly id: number;
  /** The TSNonNullExpression node */
  readonly node: T.TSNonNullExpression;
  /** The expression being asserted as non-null */
  readonly expression: T.Expression;
}
