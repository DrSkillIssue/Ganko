/**
 * Function Utilities
 *
 * Helper functions for working with function nodes.
 */

import ts from "typescript";
import { COMPONENT_PATTERN, isUpperAlpha } from "@drskillissue/ganko-shared";

export type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration;

/**
 * Check if a node is a function node (declaration or expression).
 *
 * @param node - The AST node to check
 * @returns True if the node is a FunctionDeclaration, FunctionExpression, or ArrowFunctionExpression
 */
export function isFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
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
export function isFunctionExpression(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
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
export function getFunctionName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isFunctionExpression(node) && node.name) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isMethodDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
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
export function getParameterName(node: ts.ParameterDeclaration): string | null {
  const name = node.name;
  if (ts.isIdentifier(name)) return name.text;
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
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  // { foo: () => {} } or { foo: function() {} }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  // foo = () => {}
  if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left) &&
    parent.right === node
  ) {
    return parent.left.text;
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
export function isIIFE(node: ts.Node): boolean {
  const parent = node.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
}

/**
 * Check if a read is being used as a callee (i.e., the function is being called).
 *
 * Used to distinguish function references that are immediately called vs stored/passed as callbacks.
 *
 * @param read - An object containing the node to check
 * @returns True if the read is the callee of a call expression, false otherwise
 */
export function isCalleeRead(read: { node: ts.Node }): boolean {
  const parent = read.node.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === read.node;
}

/**
 * Check if a node is or contains JSX (JSXElement or JSXFragment).
 * Handles ternary expressions, logical expressions, and parenthesized expressions.
 *
 * @param node - The AST node to check
 * @returns True if the node is or contains JSX
 */
export function containsJSX(node: ts.Node | null | undefined): boolean {
  if (!node) return false;

  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return true;
  }

  if (ts.isBlock(node)) {
    return hasJSXReturn(node);
  }

  if (ts.isConditionalExpression(node)) {
    return containsJSX(node.whenTrue) || containsJSX(node.whenFalse);
  }

  if (ts.isBinaryExpression(node) && (
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )) {
    return containsJSX(node.left) || containsJSX(node.right);
  }

  if (ts.isCommaListExpression(node)) {
    const exprs = node.elements;
    for (let i = 0; i < exprs.length; i++) {
      if (containsJSX(exprs[i])) return true;
    }
    return false;
  }

  return false;
}

/**
 * Check if a block statement contains any return statement with JSX.
 * Does not recurse into nested functions.
 *
 * @param body - The block statement to check
 * @returns True if any return statement in the block contains JSX
 */
function hasJSXReturn(body: ts.Block): boolean {
  const statements = body.statements;
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
function checkStatementForJSXReturn(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) {
    return containsJSX(stmt.expression);
  }

  if (ts.isIfStatement(stmt)) {
    if (ts.isBlock(stmt.thenStatement)) {
      if (hasJSXReturn(stmt.thenStatement)) return true;
    } else if (ts.isReturnStatement(stmt.thenStatement) && containsJSX(stmt.thenStatement.expression)) {
      return true;
    }
    // Check alternate
    if (stmt.elseStatement) {
      if (ts.isBlock(stmt.elseStatement)) {
        if (hasJSXReturn(stmt.elseStatement)) return true;
      } else if (ts.isReturnStatement(stmt.elseStatement) && containsJSX(stmt.elseStatement.expression)) {
        return true;
      } else if (ts.isIfStatement(stmt.elseStatement)) {
        if (checkStatementForJSXReturn(stmt.elseStatement)) return true;
      }
    }
    return false;
  }

  if (ts.isSwitchStatement(stmt)) {
    const clauses = stmt.caseBlock.clauses;
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      if (!clause) continue;
      const stmts = clause.statements;
      for (let j = 0; j < stmts.length; j++) {
        const caseStmt = stmts[j];
        if (!caseStmt) continue;
        if (checkStatementForJSXReturn(caseStmt)) return true;
      }
    }
    return false;
  }

  if (ts.isTryStatement(stmt)) {
    if (hasJSXReturn(stmt.tryBlock)) return true;
    if (stmt.catchClause && hasJSXReturn(stmt.catchClause.block)) return true;
    if (stmt.finallyBlock && hasJSXReturn(stmt.finallyBlock)) return true;
    return false;
  }

  if (ts.isBlock(stmt)) {
    return hasJSXReturn(stmt);
  }

  return false;
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
  if (!body) return false;

  // Arrow function with JSX expression body is always a component
  if (containsJSX(body)) return true;

  // For block bodies, require PascalCase name AND JSX return
  if (!ts.isBlock(body)) return false;

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
