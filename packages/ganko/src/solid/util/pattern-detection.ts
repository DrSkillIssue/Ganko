/**
 * Pattern Detection Utilities
 *
 * Shared pattern detection functions used across multiple rules.
 * These help identify common AST patterns like variable declarators,
 * early returns, etc.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

/**
 * Get the name from a VariableDeclarator if it's a simple identifier.
 *
 * Returns null for destructuring patterns (ObjectPattern, ArrayPattern).
 *
 * @param node - The variable declarator node
 * @returns The variable name, or null if destructured or not an identifier
 *
 * @example
 * const x = 1;           // returns "x"
 * const { a, b } = obj;  // returns null
 * const [x, y] = arr;    // returns null
 */
export function getDeclaratorName(node: T.VariableDeclarator): string | null {
  return node.id.type === "Identifier" ? node.id.name : null;
}

/**
 * Find the containing VariableDeclarator walking up from a node.
 *
 * Walks the parent chain to find if the node is part of a variable declarator.
 * Stops at function/statement boundaries to avoid crossing context.
 *
 * @param node - The AST node to search from
 * @returns The containing variable declarator, or null if not found
 *
 * @example
 * const x = foo();  // from foo() CallExpression, returns the VariableDeclarator
 * foo();            // from standalone call, returns null
 */
export function findContainingVariableDeclarator(node: T.Node): T.VariableDeclarator | null {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "VariableDeclarator") return current;
    // Stop at function/statement boundaries
    if (
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression" ||
      current.type === "ExpressionStatement" ||
      current.type === "ReturnStatement"
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Check if an IfStatement represents an early return pattern.
 *
 * Detects patterns like `if (!x) return null;` or `if (!x) { return null; }`.
 * Returns true if the consequent is a return statement (directly or in a block).
 *
 * @param ifStmt - The if statement node to check
 * @returns True if this is an early return pattern, false otherwise
 *
 * @example
 * if (!x) return null;           // returns true
 * if (!x) { return null; }       // returns true
 * if (!x) { console.log(x); }    // returns false
 */
export function isEarlyReturnPattern(ifStmt: T.IfStatement): boolean {
  const consequent = ifStmt.consequent;
  return (
    consequent.type === "ReturnStatement" ||
    (consequent.type === "BlockStatement" &&
      consequent.body.length === 1 &&
      consequent.body[0] !== undefined &&
      consequent.body[0].type === "ReturnStatement")
  );
}

/**
 * Get the name of a property key.
 *
 * Returns the key name for Identifier or string Literal keys.
 * Returns null for computed properties, numeric keys, or other key types.
 *
 * @param key - The property key node
 * @returns The key name, or null if not a simple string key
 *
 * @example
 * { foo: 1 }        // returns "foo"
 * { "bar": 2 }      // returns "bar"
 * { [expr]: 3 }     // returns null (computed)
 * { 123: 4 }        // returns null (numeric)
 */
export function getPropertyKeyName(key: T.Node): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

const REACTIVE_PRIMITIVE_NAME = /^(?:create[A-Z]|use[A-Z])/;

/**
 * Check if a function node is a property value inside an object literal
 * passed as an argument to a reactive primitive call (create- or use- prefixed).
 *
 * Detects: createSimpleContext({ init: (props) => { onCleanup(...) } })
 *
 * AST path: Function -> Property (value) -> ObjectExpression -> CallExpression
 * where the callee matches the create-/use- naming convention.
 */
export function isFunctionInReactivePrimitiveConfig(
  node: T.ArrowFunctionExpression | T.FunctionExpression | T.FunctionDeclaration,
): boolean {
  const parent = node.parent;
  if (!parent || parent.type !== "Property" || parent.value !== node) return false;

  const obj = parent.parent;
  if (!obj || obj.type !== "ObjectExpression") return false;

  const callOrArg = obj.parent;
  if (!callOrArg) return false;

  // Direct argument: createFoo({ init: () => ... })
  if (callOrArg.type === "CallExpression") {
    return isReactivePrimitiveCallNode(callOrArg);
  }

  // Could be nested inside another wrapper, but one level is sufficient
  // for the common pattern.
  return false;
}

function isReactivePrimitiveCallNode(node: T.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return REACTIVE_PRIMITIVE_NAME.test(callee.name);
  }
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return REACTIVE_PRIMITIVE_NAME.test(callee.property.name);
  }
  return false;
}

