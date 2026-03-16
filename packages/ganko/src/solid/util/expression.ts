/**
 * Expression Utilities
 *
 * Helper functions for working with expression nodes.
 */

import ts from "typescript";

/**
 * Get a human-readable descriptive name for an expression.
 *
 * Used for error messages to describe what value is being operated on.
 *
 * @param node - The expression node to describe
 * @returns A human-readable name for the expression
 *
 * @example
 * getExpressionName(identifierNode)        // "foo"
 * getExpressionName(memberExprNode)        // "bar" (property name)
 * getExpressionName(callExprNode)          // "getData()"
 * getExpressionName(awaitExprNode)         // "awaited value"
 * getExpressionName(literalNode)           // "123" or '"hello"'
 */
export function getExpressionName(node: ts.Node): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }

  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }

  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (ts.isStringLiteral(arg)) return arg.text;
    if (ts.isNumericLiteral(arg)) return arg.text;
    return "property";
  }

  if (ts.isCallExpression(node)) {
    return getCallExpressionName(node);
  }

  if (ts.isNewExpression(node)) {
    if (ts.isIdentifier(node.expression)) {
      return `new ${node.expression.text}()`;
    }
    return "new instance";
  }

  if (ts.isAwaitExpression(node)) {
    return `await ${getExpressionName(node.expression)}`;
  }

  if (ts.isYieldExpression(node)) {
    if (node.expression) {
      return `yield ${getExpressionName(node.expression)}`;
    }
    return "yield";
  }

  if (ts.isPrefixUnaryExpression(node)) {
    const opText = ts.tokenToString(node.operator) ?? "";
    return `${opText}${getExpressionName(node.operand)}`;
  }

  if (ts.isPostfixUnaryExpression(node)) {
    return getExpressionName(node.operand);
  }

  if (ts.isBinaryExpression(node)) {
    // Assignment operators
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) {
      return getExpressionName(node.left);
    }
    return "result";
  }

  if (ts.isConditionalExpression(node)) {
    return "conditional";
  }

  if (ts.isCommaListExpression(node)) {
    const exprs = node.elements;
    const lastExpr = exprs[exprs.length - 1];
    if (lastExpr) {
      return getExpressionName(lastExpr);
    }
    return "sequence";
  }

  if (ts.isArrayLiteralExpression(node)) {
    return "array";
  }

  if (ts.isObjectLiteralExpression(node)) {
    return "object";
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return "function";
  }

  if (ts.isClassExpression(node)) {
    return node.name ? node.name.text : "class";
  }

  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return "template";
  }

  if (ts.isTaggedTemplateExpression(node)) {
    if (ts.isIdentifier(node.tag)) {
      return `${node.tag.text}\`\``;
    }
    return "tagged template";
  }

  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }

  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    return "super";
  }

  if (ts.isMetaProperty(node)) {
    return `${ts.tokenToString(node.keywordToken) ?? ""}.${node.name.text}`;
  }

  if (node.kind === ts.SyntaxKind.ImportKeyword) {
    return "dynamic import";
  }

  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    return getExpressionName(node.expression);
  }

  if (ts.isParenthesizedExpression(node)) {
    return getExpressionName(node.expression);
  }

  if (ts.isStringLiteral(node)) {
    return `"${node.text}"`;
  }

  if (ts.isNumericLiteral(node)) {
    return node.text;
  }

  if (ts.isBigIntLiteral(node)) {
    return node.text;
  }

  if (ts.isRegularExpressionLiteral(node)) {
    return node.text;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return "null";
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return "true";
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return "false";
  }

  return "expression";
}

/**
 * Get a descriptive name for a call expression.
 */
function getCallExpressionName(node: ts.CallExpression): string {
  const callee = node.expression;

  if (ts.isIdentifier(callee)) {
    return `${callee.text}()`;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return `${callee.name.text}()`;
  }

  if (ts.isElementAccessExpression(callee)) {
    const arg = callee.argumentExpression;
    if (ts.isStringLiteral(arg)) {
      return `${arg.text}()`;
    }
    return "method()";
  }

  if (ts.isCallExpression(callee)) {
    return "chained call";
  }

  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
    return "IIFE";
  }

  return "call result";
}

/**
 * Check if an expression is a simple identifier or member expression.
 * These are typically safe to reference multiple times.
 *
 * @param node - The expression to check
 * @returns True if simple (identifier or non-computed member chain)
 */
export function isSimpleExpression(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return true;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (node.kind === ts.SyntaxKind.SuperKeyword) return true;
  if (ts.isPropertyAccessExpression(node)) {
    return isSimpleExpression(node.expression);
  }
  if (ts.isParenthesizedExpression(node)) {
    return isSimpleExpression(node.expression);
  }
  return false;
}

/**
 * Check if evaluating an expression might modify state or trigger external behavior.
 *
 * Returns true for expressions that:
 * - Call functions (could do anything)
 * - Assign values (`x = 1`, `x++`)
 * - Use `await` or `yield`
 * - Use `delete`
 *
 * Returns false for expressions that only read values:
 * - Identifiers, literals, `this`
 * - Property access (without getters, which we can't detect)
 * - Object/array literals with safe contents
 * - Arithmetic, logical, comparison operators
 *
 * Conservative: returns true when uncertain.
 *
 * @param node - The expression to check
 * @returns True if evaluating this expression might modify state
 */
export function mayHaveSideEffects(node: ts.Expression): boolean {
  // Safe: no side effects
  if (ts.isIdentifier(node)) return false;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) ||
      ts.isRegularExpressionLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return false;
  if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isTemplateExpression(node)) return false;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) return false;

  // Always have or may have side effects
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) ||
      ts.isYieldExpression(node) || ts.isTaggedTemplateExpression(node)) return true;
  if (ts.isPostfixUnaryExpression(node)) return true;

  if (ts.isPropertyAccessExpression(node)) {
    return mayHaveSideEffects(node.expression);
  }

  if (ts.isElementAccessExpression(node)) {
    if (mayHaveSideEffects(node.expression)) return true;
    return mayHaveSideEffects(node.argumentExpression);
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        if (mayHaveSideEffects(el.expression)) return true;
      } else {
        if (mayHaveSideEffects(el)) return true;
      }
    }
    return false;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (mayHaveSideEffects(prop.expression)) return true;
      } else if (ts.isPropertyAssignment(prop)) {
        if (prop.name && ts.isComputedPropertyName(prop.name)) {
          if (mayHaveSideEffects(prop.name.expression)) return true;
        }
        if (mayHaveSideEffects(prop.initializer)) return true;
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        // Shorthand is just identifier reference - no side effects
      }
    }
    return false;
  }

  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken ||
        node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.TildeToken) {
      return mayHaveSideEffects(node.operand);
    }
    return true;
  }

  if (ts.isDeleteExpression(node)) return true;
  if (ts.isTypeOfExpression(node)) return mayHaveSideEffects(node.expression);
  if (ts.isVoidExpression(node)) return mayHaveSideEffects(node.expression);

  if (ts.isBinaryExpression(node)) {
    // Assignment operators
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind >= ts.SyntaxKind.PlusEqualsToken &&
        node.operatorToken.kind <= ts.SyntaxKind.CaretEqualsToken) {
      return true;
    }
    return mayHaveSideEffects(node.left) || mayHaveSideEffects(node.right);
  }

  if (ts.isConditionalExpression(node)) {
    return mayHaveSideEffects(node.condition) ||
      mayHaveSideEffects(node.whenTrue) ||
      mayHaveSideEffects(node.whenFalse);
  }

  if (ts.isCommaListExpression(node)) {
    return node.elements.some(mayHaveSideEffects);
  }

  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    return mayHaveSideEffects(node.expression);
  }

  if (ts.isParenthesizedExpression(node)) {
    return mayHaveSideEffects(node.expression);
  }

  return true;
}

/**
 * O(1) lookup for TypeScript keyword and simple type names.
 * Keys are ts.SyntaxKind values, values are the human-readable names.
 */
const TS_TYPE_NAMES: Readonly<Record<number, string>> = {
  // Keyword types
  [ts.SyntaxKind.AnyKeyword]: "any",
  [ts.SyntaxKind.UnknownKeyword]: "unknown",
  [ts.SyntaxKind.NeverKeyword]: "never",
  [ts.SyntaxKind.VoidKeyword]: "void",
  [ts.SyntaxKind.UndefinedKeyword]: "undefined",
  [ts.SyntaxKind.NullKeyword]: "null",
  [ts.SyntaxKind.StringKeyword]: "string",
  [ts.SyntaxKind.NumberKeyword]: "number",
  [ts.SyntaxKind.BooleanKeyword]: "boolean",
  [ts.SyntaxKind.BigIntKeyword]: "bigint",
  [ts.SyntaxKind.SymbolKeyword]: "symbol",
  [ts.SyntaxKind.ObjectKeyword]: "object",
  [ts.SyntaxKind.IntrinsicKeyword]: "intrinsic",
  // Simple named types
  [ts.SyntaxKind.ThisType]: "this",
  [ts.SyntaxKind.TypeLiteral]: "object type",
  [ts.SyntaxKind.FunctionType]: "function type",
  [ts.SyntaxKind.ConstructorType]: "constructor type",
  [ts.SyntaxKind.ConditionalType]: "conditional type",
  [ts.SyntaxKind.MappedType]: "mapped type",
  [ts.SyntaxKind.ImportType]: "import type",
  [ts.SyntaxKind.TemplateLiteralType]: "template literal type",
};

/**
 * Get a human-readable name for a TypeScript type annotation.
 *
 * Uses O(1) lookup for keyword types, recursion for compound types.
 *
 * @param node - The type node to describe
 * @returns A human-readable name for the type
 *
 * @example
 * getTypeName(stringKeyword)     // "string"
 * getTypeName(typeReference)     // "MyType"
 * getTypeName(arrayType)         // "string[]"
 * getTypeName(unionType)         // "string | number"
 */
export function getTypeName(node: ts.TypeNode): string {
  // Fast path: direct lookup
  const name = TS_TYPE_NAMES[node.kind];
  if (name) return name;

  if (ts.isTypeReferenceNode(node)) {
    if (ts.isIdentifier(node.typeName)) {
      return node.typeName.text;
    }
    if (ts.isQualifiedName(node.typeName)) {
      return getQualifiedName(node.typeName);
    }
    return "type";
  }

  if (ts.isArrayTypeNode(node)) {
    return `${getTypeName(node.elementType)}[]`;
  }

  if (ts.isUnionTypeNode(node)) {
    return joinTypeNames(node.types, " | ");
  }

  if (ts.isIntersectionTypeNode(node)) {
    return joinTypeNames(node.types, " & ");
  }

  if (ts.isTupleTypeNode(node)) {
    return `[${joinTypeNames(node.elements, ", ")}]`;
  }

  if (ts.isOptionalTypeNode(node)) {
    return `${getTypeName(node.type)}?`;
  }

  if (ts.isRestTypeNode(node)) {
    return `...${getTypeName(node.type)}`;
  }

  if (ts.isLiteralTypeNode(node)) {
    return getLiteralTypeName(node);
  }

  if (ts.isIndexedAccessTypeNode(node)) {
    return `${getTypeName(node.objectType)}[${getTypeName(node.indexType)}]`;
  }

  if (ts.isTypeOperatorNode(node)) {
    const opText = ts.tokenToString(node.operator) ?? "";
    return `${opText} ${getTypeName(node.type)}`;
  }

  if (ts.isTypeQueryNode(node)) {
    if (ts.isIdentifier(node.exprName)) {
      return `typeof ${node.exprName.text}`;
    }
    return "typeof expression";
  }

  if (ts.isInferTypeNode(node)) {
    return `infer ${node.typeParameter.name.text}`;
  }

  if (ts.isNamedTupleMember(node)) {
    return `${node.name.text}: ${getTypeName(node.type)}`;
  }

  return "type";
}

/**
 * Join type names with a separator, avoiding .map() allocation for small arrays.
 */
function joinTypeNames(types: readonly ts.TypeNode[], sep: string): string {
  const len = types.length;
  if (len === 0) return "";
  const first = types[0];
  if (len === 1 && first) return getTypeName(first);

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    const t = types[i];
    if (t) parts.push(getTypeName(t));
  }
  return parts.join(sep);
}

/**
 * Get name for TSLiteralType nodes.
 */
function getLiteralTypeName(node: ts.LiteralTypeNode): string {
  const lit = node.literal;
  if (ts.isStringLiteral(lit)) {
    return `"${lit.text}"`;
  }
  if (ts.isNumericLiteral(lit)) {
    return lit.text;
  }
  if (ts.isPrefixUnaryExpression(lit) && ts.isNumericLiteral(lit.operand)) {
    const opText = ts.tokenToString(lit.operator) ?? "";
    return `${opText}${lit.operand.text}`;
  }
  if (ts.isNoSubstitutionTemplateLiteral(lit)) {
    return "template literal type";
  }
  if (lit.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (lit.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (lit.kind === ts.SyntaxKind.NullKeyword) return "null";
  return "literal";
}

/**
 * Get the full name from a qualified name (e.g., `Namespace.Type`).
 */
function getQualifiedName(node: ts.QualifiedName): string {
  const right = node.right.text;
  if (ts.isIdentifier(node.left)) {
    return `${node.left.text}.${right}`;
  }
  if (ts.isQualifiedName(node.left)) {
    return `${getQualifiedName(node.left)}.${right}`;
  }
  return right;
}

/**
 * Check if a node is an empty object literal `{}`.
 *
 * @param node - The expression node to check
 * @returns True if node is an empty object literal
 */
export function isEmptyObjectLiteral(node: ts.Expression): boolean {
  return ts.isObjectLiteralExpression(node) && node.properties.length === 0;
}

/**
 * Unwraps ParenthesizedExpression nodes to get the inner expression.
 *
 * TypeScript AST wraps `(expr)` in an explicit ParenthesizedExpression node,
 * unlike ESTree which treats parentheses as transparent. This utility peels
 * through all layers of parentheses to reach the semantically meaningful node.
 */
export function unwrapParenthesized(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Comparison operators that produce boolean results.
 */
export const COMPARISON_OPERATORS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
]);

/**
 * Check if a node is a comparison expression that produces a boolean.
 *
 * @param node - The AST node to check
 * @returns True if the node is a comparison expression
 */
export function isComparisonExpression(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  const opText = node.operatorToken.getText();
  return COMPARISON_OPERATORS.has(opText);
}

/**
 * Check if a node is a logical expression (&&, ||, ??).
 *
 * @param node - The AST node to check
 * @returns True if the node is a logical expression
 */
export function isLogicalExpression(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  const kind = node.operatorToken.kind;
  return kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken;
}

/**
 * Check if a node is a unary NOT expression (!expr).
 *
 * @param node - The AST node to check
 * @returns True if the node is a NOT expression
 */
export function isNotExpression(node: ts.Node): boolean {
  return ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken;
}

/**
 * Check if a node is a Boolean() call.
 *
 * @param node - The AST node to check
 * @returns True if the node is a Boolean() call
 */
export function isBooleanCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return ts.isIdentifier(callee) && callee.text === "Boolean";
}

/**
 * Check if a node is a double negation (!!expr).
 *
 * @param node - The AST node to check
 * @returns True if the node is a double negation expression
 */
export function isDoubleNegation(node: ts.Node): boolean {
  if (!ts.isPrefixUnaryExpression(node) || node.operator !== ts.SyntaxKind.ExclamationToken) return false;
  const arg = node.operand;
  return ts.isPrefixUnaryExpression(arg) && arg.operator === ts.SyntaxKind.ExclamationToken;
}

/**
 * Check if a node is a ternary with null/undefined/false as the alternate.
 * Pattern: condition ? value : null (used with keyed Show)
 *
 * @param node - The AST node to check
 * @returns True if the node is a guarded ternary pattern
 */
export function isGuardedTernary(node: ts.Node): boolean {
  if (!ts.isConditionalExpression(node)) return false;
  const alt = node.whenFalse;
  if (alt.kind === ts.SyntaxKind.NullKeyword || alt.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(alt) && alt.text === "undefined") return true;
  return false;
}

/**
 * Check if a node represents an explicitly boolean expression.
 * Returns true if the expression doesn't need a truthy/falsy warning.
 *
 * Detects:
 * - Comparison expressions (===, !==, <, >, etc.)
 * - Logical expressions (&&, ||, ??)
 * - NOT expressions (!x)
 * - Boolean() calls
 * - Double negation (!!x)
 * - Boolean literals
 * - Guarded ternaries (cond ? val : null)
 *
 * @param node - The AST node to check
 * @returns True if the node is an explicit boolean expression
 */
export function isExplicitBooleanExpression(node: ts.Node): boolean {
  if (isComparisonExpression(node)) return true;
  if (isLogicalExpression(node)) return true;
  if (isNotExpression(node)) return true;
  if (isBooleanCall(node)) return true;
  if (isDoubleNegation(node)) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (isGuardedTernary(node)) return true;
  return false;
}

const LOOP_KINDS = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

const CONDITIONAL_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.SwitchStatement,
]);

/**
 * Checks if a node is inside a loop construct.
 */
/**
 * Returns the nearest enclosing loop node, stopping at function boundaries.
 * @param node - Starting node
 * @returns The loop node, or null if not in a loop
 */
export function getEnclosingLoop(node: ts.Node): ts.Node | null {
  let current = node.parent;
  while (current) {
    if (LOOP_KINDS.has(current.kind)) return current;
    if (ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current)) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Checks if a node is inside a loop construct.
 */
export function isInLoop(node: ts.Node): boolean {
  return getEnclosingLoop(node) !== null;
}

/**
 * Checks if a node is inside a conditional construct.
 */
export function isInConditional(node: ts.Node): boolean {
  let current = node.parent;
  while (current) {
    if (CONDITIONAL_KINDS.has(current.kind)) return true;
    // Also check for logical expressions (&&, ||, ??)
    if (ts.isBinaryExpression(current) && (
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    )) return true;
    if (ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/** Initial stack size for expression traversal */


/**
 * Check if an expression tree contains any identifier matching the given names.
 *
 * This is useful for determining if an expression depends on specific variables,
 * such as loop callback parameters.
 *
 * @param node The expression node to search
 * @param names Set of identifier names to look for
 * @returns true if any identifier in the expression matches a name in the set
 */
export function expressionReferencesAny(node: ts.Node, names: Set<string>): boolean {
  if (names.size === 0) return false;

  const stack: ts.Node[] = [node];
  let top = 1;

  while (top > 0) {
    const current = stack[--top];
    if (!current) continue;

    if (ts.isIdentifier(current)) {
      if (names.has(current.text)) return true;
      continue;
    }

    if (ts.isPropertyAccessExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isElementAccessExpression(current)) {
      stack[top++] = current.expression;
      stack[top++] = current.argumentExpression;
      continue;
    }

    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      stack[top++] = current.expression;
      const args = current.arguments;
      if (args) {
        for (let i = args.length - 1; i >= 0; i--) {
          const arg = args[i];
          if (arg) stack[top++] = arg;
        }
      }
      continue;
    }

    if (ts.isBinaryExpression(current)) {
      stack[top++] = current.left;
      stack[top++] = current.right;
      continue;
    }

    if (ts.isConditionalExpression(current)) {
      stack[top++] = current.condition;
      stack[top++] = current.whenTrue;
      stack[top++] = current.whenFalse;
      continue;
    }

    if (ts.isPrefixUnaryExpression(current)) {
      stack[top++] = current.operand;
      continue;
    }

    if (ts.isPostfixUnaryExpression(current)) {
      stack[top++] = current.operand;
      continue;
    }

    if (ts.isSpreadElement(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isAwaitExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isYieldExpression(current)) {
      if (current.expression) stack[top++] = current.expression;
      continue;
    }

    if (ts.isArrayLiteralExpression(current)) {
      const elements = current.elements;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el) stack[top++] = el;
      }
      continue;
    }

    if (ts.isObjectLiteralExpression(current)) {
      const props = current.properties;
      for (let i = props.length - 1; i >= 0; i--) {
        const prop = props[i];
        if (!prop) continue;
        if (ts.isPropertyAssignment(prop)) {
          if (ts.isComputedPropertyName(prop.name)) stack[top++] = prop.name.expression;
          stack[top++] = prop.initializer;
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          stack[top++] = prop.name;
        } else if (ts.isSpreadAssignment(prop)) {
          stack[top++] = prop.expression;
        }
      }
      continue;
    }

    if (ts.isTemplateExpression(current)) {
      for (let i = current.templateSpans.length - 1; i >= 0; i--) {
        const span = current.templateSpans[i];
        if (span) stack[top++] = span.expression;
      }
      continue;
    }

    if (ts.isCommaListExpression(current)) {
      const exprs = current.elements;
      for (let i = exprs.length - 1; i >= 0; i--) {
        const expr = exprs[i];
        if (expr) stack[top++] = expr;
      }
      continue;
    }

    if (ts.isTaggedTemplateExpression(current)) {
      stack[top++] = current.tag;
      stack[top++] = current.template;
      continue;
    }

    if (ts.isAsExpression(current) || ts.isNonNullExpression(current) ||
        ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isTypeAssertionExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    // Don't descend into nested functions - they create new scope
    // Also skip literals, this, super, meta properties, JSX
  }

  return false;
}

/**
 * Check if an expression tree contains any identifier matching the given names,
 * including inside nested function bodies (arrow functions and function expressions).
 *
 * Unlike `expressionReferencesAny` which stops at function boundaries, this variant
 * traverses into closures. This is needed for `expandWithDerivedLocals` where
 * `const needsAnim = () => !markers().has(id)` should be recognized as depending
 * on `id` even though `id` is captured inside an arrow function.
 *
 * @param node The expression node to search
 * @param names Set of identifier names to look for
 * @returns true if any identifier in the expression (including inside closures) matches
 */
export function expressionReferencesAnyDeep(node: ts.Node, names: Set<string>): boolean {
  if (names.size === 0) return false;

  const stack: ts.Node[] = [node];
  let top = 1;

  while (top > 0) {
    const current = stack[--top];
    if (!current) continue;

    if (ts.isIdentifier(current)) {
      if (names.has(current.text)) return true;
      continue;
    }

    if (ts.isPropertyAccessExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isElementAccessExpression(current)) {
      stack[top++] = current.expression;
      stack[top++] = current.argumentExpression;
      continue;
    }

    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      stack[top++] = current.expression;
      const args = current.arguments;
      if (args) {
        for (let i = args.length - 1; i >= 0; i--) {
          const arg = args[i];
          if (arg) stack[top++] = arg;
        }
      }
      continue;
    }

    if (ts.isBinaryExpression(current)) {
      stack[top++] = current.left;
      stack[top++] = current.right;
      continue;
    }

    if (ts.isConditionalExpression(current)) {
      stack[top++] = current.condition;
      stack[top++] = current.whenTrue;
      stack[top++] = current.whenFalse;
      continue;
    }

    if (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) {
      stack[top++] = current.operand;
      continue;
    }

    if (ts.isSpreadElement(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isAwaitExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isYieldExpression(current)) {
      if (current.expression) stack[top++] = current.expression;
      continue;
    }

    if (ts.isArrayLiteralExpression(current)) {
      const elements = current.elements;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el) stack[top++] = el;
      }
      continue;
    }

    if (ts.isObjectLiteralExpression(current)) {
      const props = current.properties;
      for (let i = props.length - 1; i >= 0; i--) {
        const prop = props[i];
        if (!prop) continue;
        if (ts.isPropertyAssignment(prop)) {
          if (ts.isComputedPropertyName(prop.name)) stack[top++] = prop.name.expression;
          stack[top++] = prop.initializer;
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          stack[top++] = prop.name;
        } else if (ts.isSpreadAssignment(prop)) {
          stack[top++] = prop.expression;
        }
      }
      continue;
    }

    if (ts.isTemplateExpression(current)) {
      for (let i = current.templateSpans.length - 1; i >= 0; i--) {
        const span = current.templateSpans[i];
        if (span) stack[top++] = span.expression;
      }
      continue;
    }

    if (ts.isCommaListExpression(current)) {
      const exprs = current.elements;
      for (let i = exprs.length - 1; i >= 0; i--) {
        const expr = exprs[i];
        if (expr) stack[top++] = expr;
      }
      continue;
    }

    if (ts.isTaggedTemplateExpression(current)) {
      stack[top++] = current.tag;
      stack[top++] = current.template;
      continue;
    }

    if (ts.isAsExpression(current) || ts.isNonNullExpression(current) ||
        ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isTypeAssertionExpression(current)) {
      stack[top++] = current.expression;
      continue;
    }

    // Traverse INTO function bodies — the key difference from expressionReferencesAny
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      stack[top++] = current.body;
      continue;
    }

    // Statement traversal (needed for block-body arrow functions)
    if (ts.isBlock(current)) {
      const stmts = current.statements;
      for (let i = stmts.length - 1; i >= 0; i--) {
        const stmt = stmts[i];
        if (stmt) stack[top++] = stmt;
      }
      continue;
    }

    if (ts.isReturnStatement(current)) {
      if (current.expression) stack[top++] = current.expression;
      continue;
    }

    if (ts.isExpressionStatement(current)) {
      stack[top++] = current.expression;
      continue;
    }

    if (ts.isVariableStatement(current)) {
      const decls = current.declarationList.declarations;
      for (let i = decls.length - 1; i >= 0; i--) {
        const decl = decls[i];
        if (decl?.initializer) stack[top++] = decl.initializer;
      }
      continue;
    }

    if (ts.isVariableDeclaration(current)) {
      if (current.initializer) stack[top++] = current.initializer;
      continue;
    }

    if (ts.isIfStatement(current)) {
      stack[top++] = current.expression;
      stack[top++] = current.thenStatement;
      if (current.elseStatement) stack[top++] = current.elseStatement;
      continue;
    }

    // Skip literals, this, super, meta properties, JSX
  }

  return false;
}

/**
 * Find the containing expression that determines the context of a node.
 *
 * For example, for `theme()` in `theme() === "dark" ? "white" : "black"`,
 * this returns the ConditionalExpression.
 *
 * This walks up from a node to find the expression boundary, stopping at:
 * - Statement boundaries
 * - JSX attribute values
 * - Object property values
 *
 * @param node The starting node
 * @returns The containing expression, or the node itself if at expression root
 */
export function getContainingExpression(node: ts.Node): ts.Node {
  let current = node;
  let parent = node.parent;

  while (parent) {
    // Expression or statement boundary - stop here
    if (ts.isExpressionStatement(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isReturnStatement(parent) ||
        ts.isThrowStatement(parent) ||
        ts.isJsxExpression(parent) ||
        ts.isJsxAttribute(parent) ||
        ts.isBlock(parent) ||
        ts.isIfStatement(parent) ||
        ts.isForStatement(parent) ||
        ts.isWhileStatement(parent) ||
        ts.isSwitchStatement(parent) ||
        ts.isTryStatement(parent)) {
      return current;
    }

    // Object property - stop if current is the value
    if (ts.isPropertyAssignment(parent)) {
      if (parent.initializer === current) {
        return current;
      }
    }

    // CallExpression - stop if current is an argument
    else if (ts.isCallExpression(parent)) {
      if (parent.expression !== current) {
        return current;
      }
    }

    // Expressions that contain our node - continue up
    // (array, object, binary, conditional, unary, member, template, tagged template - all just continue)

    current = parent;
    parent = parent.parent;
  }

  return current;
}

/** Methods that return strings — evidence the receiver/result is string-typed. */
export const STRING_RETURNING_METHODS = new Set([
  "trim", "toLowerCase", "toUpperCase",
  "replace", "replaceAll", "slice",
  "substring", "substr", "concat",
  "normalize", "padStart", "padEnd",
]);

/**
 * Checks if an expression is provably a string value.
 */
export function isStringExpression(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node)) return true;
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)) {
    if (STRING_RETURNING_METHODS.has(node.expression.name.text)) return true;
  }
  return false;
}
