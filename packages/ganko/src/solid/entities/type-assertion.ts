/**
 * Type Assertion Entity
 *
 * Represents type assertions in the program graph, including:
 * - `as` assertions: `x as Type`
 * - Double assertions: `x as unknown as Type`
 * - Angle bracket assertions: `<Type>x`
 * - `as any` casts
 */

import type ts from "typescript";
import type { ScopeEntity } from "./scope";

/**
 * The kind of type assertion being performed.
 */
export type TypeAssertionKind =
  | "simple"           // Single `as` or angle bracket: `x as Type` or `<Type>x`
  | "double"           // Double assertion: `x as unknown as Type`
  | "cast-to-any"      // Casting to any: `x as any`
  | "cast-to-unknown"  // Casting to unknown (often used in double assertion)
  | "const-assertion"; // Casting to const: `x as const` (type-safe, makes value readonly)

/**
 * Represents a type assertion expression in the SolidGraph.
 *
 * Covers both `as` expressions and angle bracket syntax.
 */
export interface TypeAssertionEntity {
  readonly id: number;
  /** The assertion node (TSAsExpression or TSTypeAssertion) */
  readonly node: ts.AsExpression | ts.TypeAssertion;
  /** The expression being cast */
  readonly expression: ts.Expression;
  /** The type being cast to */
  readonly typeAnnotation: ts.TypeNode;
  /** The kind of assertion */
  readonly kind: TypeAssertionKind;
  /** Whether this is inside a loop */
  readonly inLoop: boolean;
  /** Whether this assertion is on an import expression (dynamic or static) */
  readonly onImport: boolean;
  /** The scope containing this assertion */
  readonly scope: ScopeEntity;
  /** For double assertions, reference to the inner assertion if present */
  readonly innerAssertion: TypeAssertionEntity | null;
  /**
   * Whether the cast is unnecessary because the expression type is
   * already assignable to the target type. Set during wiring phase
   * when TypeScript type info is available. null if unknown.
   */
  isUnnecessary: boolean | null;
  /**
   * The actual type of the expression (for error messages).
   * Set during wiring phase when TypeScript type info is available.
   */
  expressionType: string | null;
}

/**
 * Represents a type predicate function (function with `is` keyword).
 */
export interface TypePredicateEntity {
  readonly id: number;
  /** The function node */
  readonly node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
  /** The parameter name being narrowed */
  readonly parameterName: string;
  /** The type being asserted */
  readonly typeAnnotation: ts.TypeNode;
}

/**
 * Represents a generic function with type assertion in its return.
 *
 * Detects patterns like:
 * ```ts
 * function getData<T>(id: string): T {
 *   return JSON.parse(apiCall(id)) as T;
 * }
 * ```
 */
export interface UnsafeGenericAssertionEntity {
  readonly id: number;
  /** The function node */
  readonly node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
  /** The generic type parameter being asserted to */
  readonly typeParameterName: string;
  /** The type assertion node within the function */
  readonly assertion: ts.AsExpression | ts.TypeAssertion;
}

/**
 * Where in the program an unsafe type annotation appears.
 *
 * - "parameter": function/method parameter type (`function foo(x: any)`)
 * - "return": function/method return type (`function foo(): unknown`)
 * - "variable": variable declaration type (`let x: any`)
 * - "property": class/object property type (`class Foo { x: any }`)
 * - "generic-constraint": generic type constraint (`<T extends unknown>`)
 */
export type UnsafeAnnotationPosition =
  | "parameter"
  | "return"
  | "variable"
  | "property"
  | "generic-constraint";

/**
 * Whether the annotation is `any` or `unknown`.
 */
export type UnsafeAnnotationKind = "any" | "unknown";

/**
 * Represents an unsafe type annotation (`any` or `unknown`) in a value-level position.
 *
 * This entity is NOT created for:
 * - Type alias bodies (`type Foo = unknown`) — type-level, not value-level
 * - Interface definitions (`interface Foo { [key: string]: unknown }`) — structural types
 * - Catch clause parameters (`catch (e: unknown)`) — recommended by TypeScript
 * - Generic constraints on type parameters (`<T extends unknown>`) with `unknown` — vacuously true
 * - `Record<string, unknown>` pattern — standard generic constraint pattern
 */
export interface UnsafeTypeAnnotationEntity {
  readonly id: number;
  /** The TSAnyKeyword or TSUnknownKeyword node */
  readonly node: ts.KeywordTypeNode;
  /** Whether this is `any` or `unknown` */
  readonly kind: UnsafeAnnotationKind;
  /** Where the annotation appears */
  readonly position: UnsafeAnnotationPosition;
  /**
   * Name context for error messages.
   * For parameters: the parameter name.
   * For returns: the function name.
   * For variables: the variable name.
   * For properties: the property name.
   * For generic constraints: the type parameter name.
   */
  readonly name: string | null;
  /** The containing function name (for parameters/returns), or null */
  readonly functionName: string | null;
}
