/**
 * Function Utilities
 *
 * Helper functions for working with function nodes.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import { COMPONENT_PATTERN, isUpperAlpha } from "@drskillissue/ganko-shared";

export type FunctionNode = T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression;

/**
 * Check if a node is a function node (declaration or expression).
 *
 * @param node - The AST node to check
 * @returns True if the node is a FunctionDeclaration, FunctionExpression, or ArrowFunctionExpression
 */
export function isFunctionNode(node: T.Node): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/**
 * Check if a node is a function expression (arrow or regular).
 *
 * Unlike isFunctionNode, this excludes FunctionDeclaration - useful for
 * callback argument validation where declared functions are not allowed.
 *
 * NOTE: After calling this, use direct type checks for TypeScript narrowing:
 * ```typescript
 * if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return;
 * // TypeScript now knows node is a function expression
 * ```
 *
 * @param node - The AST node to check
 * @returns True if the node is a FunctionExpression or ArrowFunctionExpression
 */
export function isFunctionExpression(node: T.Node): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

/**
 * Get the declared name of a function.
 *
 * Returns the function's id name if available, or infers from parent context
 * (VariableDeclarator for `const foo = () => {}` or Property for `{ foo: () => {} }`).
 *
 * @param node - The function node
 * @returns The function name, or null if unnamed and not in assignable context
 */
export function getFunctionName(node: FunctionNode): string | null {
  if (node.type === "FunctionDeclaration" && node.id) {
    return node.id.name;
  }
  if (node.type === "FunctionExpression" && node.id) {
    return node.id.name;
  }
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent?.type === "Property" && parent.key.type === "Identifier") {
    return parent.key.name;
  }
  if (parent?.type === "MethodDefinition" && parent.key.type === "Identifier") {
    return parent.key.name;
  }
  return null;
}

/**
 * Get the name of a function parameter.
 *
 * Handles various parameter patterns including identifiers, defaults (AssignmentPattern),
 * and rest parameters (RestElement). Returns null for destructuring patterns.
 *
 * @param node - The parameter node
 * @returns The parameter name, or null if unnamed or destructured
 */
export function getParameterName(node: T.Parameter): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "AssignmentPattern" && node.left.type === "Identifier") {
    return node.left.name;
  }
  if (node.type === "RestElement" && node.argument.type === "Identifier") {
    return node.argument.name;
  }
  return null;
}

/**
 * Get the variable name if a function is assigned to a variable.
 *
 * Walks the parent chain to extract the variable name from declarations, properties,
 * or assignment expressions. Does not include declared function names - use getFunctionName for those.
 *
 * @param node - The function node
 * @returns The variable name the function is assigned to, or null if not in an assignment context
 *
 * Examples:
 * - `const foo = () => {}` -> "foo"
 * - `const foo = function bar() {}` -> "foo" (variable takes precedence over function id)
 * - `{ foo: () => {} }` -> "foo"
 * - `function foo() {}` -> null (use getFunctionName for declared functions)
 * - `foo = () => {}` -> "foo"
 */
export function getFunctionVariableName(node: FunctionNode): string | null {
  const parent = node.parent;

  // const foo = () => {} or const foo = function() {}
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }

  // { foo: () => {} } or { foo: function() {} }
  if (parent?.type === "Property" && parent.key.type === "Identifier" && !parent.computed) {
    return parent.key.name;
  }

  // foo = () => {}
  if (
    parent?.type === "AssignmentExpression" &&
    parent.left.type === "Identifier" &&
    parent.right === node
  ) {
    return parent.left.name;
  }

  return null;
}

/**
 * Check if a function is an IIFE (Immediately Invoked Function Expression).
 *
 * An IIFE is a function expression that is directly invoked (the parent CallExpression has this as the callee).
 *
 * @param node - The node to check
 * @returns True if this function is immediately invoked, false otherwise
 */
export function isIIFE(node: T.Node): boolean {
  const parent = node.parent;
  return parent?.type === "CallExpression" && parent.callee === node;
}

/**
 * Check if a read is being used as a callee (i.e., the function is being called).
 *
 * Used to distinguish function references that are immediately called vs stored/passed as callbacks.
 *
 * @param read - An object containing the node to check
 * @returns True if the read is the callee of a call expression, false otherwise
 */
export function isCalleeRead(read: { node: T.Node }): boolean {
  const parent = read.node.parent;
  return parent?.type === "CallExpression" && parent.callee === read.node;
}

/**
 * Check if a node is or contains JSX (JSXElement or JSXFragment).
 * Handles ternary expressions, logical expressions, and parenthesized expressions.
 *
 * @param node - The AST node to check
 * @returns True if the node is or contains JSX
 */
export function containsJSX(node: T.Node | null | undefined): boolean {
  if (!node) return false;

  switch (node.type) {
    case "JSXElement":
    case "JSXFragment":
      return true;

    case "BlockStatement":
      return hasJSXReturn(node);

    case "ConditionalExpression":
      return containsJSX(node.consequent) || containsJSX(node.alternate);

    case "LogicalExpression":
      return containsJSX(node.left) || containsJSX(node.right);

    case "SequenceExpression": {
      const exprs = node.expressions;
      for (let i = 0; i < exprs.length; i++) {
        if (containsJSX(exprs[i])) return true;
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Check if a block statement contains any return statement with JSX.
 * Does not recurse into nested functions.
 *
 * @param body - The block statement to check
 * @returns True if any return statement in the block contains JSX
 */
function hasJSXReturn(body: T.BlockStatement): boolean {
  const statements = body.body;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt) continue;
    if (checkStatementForJSXReturn(stmt)) return true;
  }
  return false;
}

/**
 * Checks a statement for JSX returns.
 * Does not recurse into nested functions.
 *
 * @param stmt - The statement to check
 * @returns True if the statement contains a return with JSX
 */
function checkStatementForJSXReturn(stmt: T.Statement): boolean {
  switch (stmt.type) {
    case "ReturnStatement":
      return containsJSX(stmt.argument);

    case "IfStatement": {
      if (stmt.consequent.type === "BlockStatement") {
        if (hasJSXReturn(stmt.consequent)) return true;
      } else if (stmt.consequent.type === "ReturnStatement" && containsJSX(stmt.consequent.argument)) {
        return true;
      }
      // Check alternate
      if (stmt.alternate) {
        if (stmt.alternate.type === "BlockStatement") {
          if (hasJSXReturn(stmt.alternate)) return true;
        } else if (stmt.alternate.type === "ReturnStatement" && containsJSX(stmt.alternate.argument)) {
          return true;
        } else if (stmt.alternate.type === "IfStatement") {
          if (checkStatementForJSXReturn(stmt.alternate)) return true;
        }
      }
      return false;
    }

    case "SwitchStatement": {
      const cases = stmt.cases;
      for (let i = 0; i < cases.length; i++) {
        const caseClause = cases[i];
        if (!caseClause) continue;
        const consequent = caseClause.consequent;
        for (let j = 0; j < consequent.length; j++) {
          const caseStmt = consequent[j];
          if (!caseStmt) continue;
          if (checkStatementForJSXReturn(caseStmt)) return true;
        }
      }
      return false;
    }

    case "TryStatement":
      if (hasJSXReturn(stmt.block)) return true;
      if (stmt.handler && hasJSXReturn(stmt.handler.body)) return true;
      if (stmt.finalizer && hasJSXReturn(stmt.finalizer)) return true;
      return false;

    case "BlockStatement":
      return hasJSXReturn(stmt);

    default:
      return false;
  }
}

/**
 * Check if a function is likely a Solid component.
 *
 * A function is considered a component if:
 * - Its body directly returns JSX (arrow function with JSX expression body, e.g., `() => <div/>`)
 * - Its name starts with an uppercase letter (PascalCase) AND it returns JSX
 *
 * PascalCase functions that don't return JSX are NOT considered components.
 * This prevents false positives on non-component utility functions like AST handlers.
 *
 * @param node - The function node to check
 * @returns True if the function matches component patterns, false otherwise
 */
export function isComponentFunction(node: FunctionNode): boolean {
  const body = node.body;

  // Arrow function with JSX expression body is always a component
  if (containsJSX(body)) return true;

  // For block bodies, require PascalCase name AND JSX return
  if (body.type !== "BlockStatement") return false;

  const name = getFunctionName(node);
  if (!name || !COMPONENT_PATTERN.test(name)) return false;

  // PascalCase name - check if it returns JSX
  return hasJSXReturn(body);
}

/**
 * Checks if a name follows component naming convention (PascalCase).
 */
export function isComponentName(name: string): boolean {
  return isUpperAlpha(name.charCodeAt(0));
}
