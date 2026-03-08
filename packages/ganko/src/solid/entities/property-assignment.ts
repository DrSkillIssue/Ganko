/**
 * Property Assignment Entity
 *
 * Represents property assignments (obj.prop = value) in the program graph.
 * These are distinct from variable assignments and are tracked separately
 * because they can cause V8 hidden class transitions.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { ScopeEntity } from "./scope";
import type { FileEntity } from "./file";

/**
 * Represents a property assignment expression in the SolidGraph.
 *
 * Tracks assignments where the left-hand side is a MemberExpression:
 * - `obj.prop = value`
 * - `obj[key] = value`
 */
export interface PropertyAssignmentEntity {
  readonly id: number;
  /** The AssignmentExpression node */
  readonly node: T.AssignmentExpression;
  /** The MemberExpression on the left side */
  readonly target: T.MemberExpression;
  /** The object being assigned to */
  readonly object: T.Expression;
  /** The property name (if computed, this may be an expression) */
  readonly property: T.Expression | T.PrivateIdentifier;
  /** Whether property is computed (obj[prop] vs obj.prop) */
  readonly computed: boolean;
  /** The assigned value expression */
  readonly value: T.Expression;
  /** The assignment operator */
  readonly operator: T.AssignmentExpression["operator"];
  /** Containing scope */
  readonly scope: ScopeEntity;
  /** Containing file */
  readonly file: FileEntity;
  /** Whether inside a loop */
  readonly isInLoop: boolean;
  /** Whether inside a conditional */
  readonly isInConditional: boolean;
  /** Whether the property exists on the object's declared type (mutation vs addition) */
  readonly propertyExistsOnType: boolean;
  /** Whether this is an array index assignment (arr[i] = value) */
  readonly isArrayIndexAssignment: boolean;
  /** Whether the property name is dynamic and cannot be statically determined */
  readonly hasDynamicPropertyName: boolean;
}
