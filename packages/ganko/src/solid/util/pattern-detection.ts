/**
 * Pattern Detection Utilities
 *
 * Shared pattern detection functions used across multiple rules.
 * These help identify common AST patterns like variable declarators,
 * early returns, etc.
 */

import ts from "typescript";

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
export function getDeclaratorName(node: ts.VariableDeclaration): string | null {
  return ts.isIdentifier(node.name) ? node.name.text : null;
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
export function findContainingVariableDeclarator(node: ts.Node): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current)) return current;
    // Stop at function/statement boundaries
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isExpressionStatement(current) ||
      ts.isReturnStatement(current)
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
export function isEarlyReturnPattern(ifStmt: ts.IfStatement): boolean {
  const consequent = ifStmt.thenStatement;
  return (
    ts.isReturnStatement(consequent) ||
    (ts.isBlock(consequent) &&
      consequent.statements.length === 1 &&
      consequent.statements[0] !== undefined &&
      ts.isReturnStatement(consequent.statements[0]))
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
export function getPropertyKeyName(key: ts.Node): string | null {
  if (ts.isIdentifier(key)) return key.text;
  if (ts.isStringLiteral(key)) return key.text;
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
  node: ts.Node,
): boolean {
  const parent = node.parent;
  if (!parent || !ts.isPropertyAssignment(parent) || parent.initializer !== node) return false;

  const obj = parent.parent;
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false;

  const callOrArg = obj.parent;
  if (!callOrArg) return false;

  // Direct argument: createFoo({ init: () => ... })
  if (ts.isCallExpression(callOrArg)) {
    return isReactivePrimitiveCallNode(callOrArg);
  }

  // Could be nested inside another wrapper, but one level is sufficient
  // for the common pattern.
  return false;
}

function isReactivePrimitiveCallNode(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return REACTIVE_PRIMITIVE_NAME.test(callee.text);
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return REACTIVE_PRIMITIVE_NAME.test(callee.name.text);
  }
  return false;
}

