/**
 * Static Value Evaluation
 *
 * Utilities for evaluating static values from AST nodes.
 */

import ts from "typescript";

/**
 * Result of evaluating a static value from an AST node.
 */
export interface StaticValueResult {
  value: string | number | boolean | null | undefined;
}

/**
 * Try to evaluate a static value from a node.
 *
 * Handles:
 * - Literals: "string", 123, true, null
 * - Template literals without expressions: `hello`
 * - Unary expressions: -1, +2, !true
 * - Binary expressions (string concatenation): "a" + "b"
 *
 * @param node - AST node to evaluate
 * @returns Object with value property, or null if value cannot be determined
 */
export function getStaticValue(node: ts.Node | null): StaticValueResult | null {
  if (!node) return null;

  if (ts.isStringLiteral(node)) {
    return { value: node.text };
  }

  if (ts.isNumericLiteral(node)) {
    return { value: Number(node.text) };
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text };
  }

  if (ts.isTemplateExpression(node)) {
    // Only handle template literals without expressions
    if (node.templateSpans.length === 0) {
      return { value: node.head.text };
    }
    return null;
  }

  if (ts.isPrefixUnaryExpression(node)) {
    const argResult = getStaticValue(node.operand);
    if (argResult === null) return null;
    const argValue = argResult.value;

    if (node.operator === ts.SyntaxKind.MinusToken) {
      if (typeof argValue === "number") return { value: -argValue };
    } else if (node.operator === ts.SyntaxKind.PlusToken) {
      if (typeof argValue === "number") return { value: +argValue };
    } else if (node.operator === ts.SyntaxKind.ExclamationToken) {
      return { value: !argValue };
    }
    return null;
  }

  if (ts.isTypeOfExpression(node)) {
    const argResult = getStaticValue(node.expression);
    if (argResult === null) return null;
    return { value: typeof argResult.value };
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = getStaticValue(node.left);
      const right = getStaticValue(node.right);
      if (left !== null && right !== null) {
        if (typeof left.value === "string" && typeof right.value === "string") {
          return { value: left.value + right.value };
        }

        if (typeof left.value === "number" && typeof right.value === "number") {
          return { value: left.value + right.value };
        }
      }
    }
    return null;
  }

  // Identifier: undefined
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") return { value: undefined };
    return null;
  }

  return null;
}

/**
 * Get the string value from a Literal node if it's a string.
 *
 * @param node - AST node to extract string from
 * @returns String value if node is a string literal, null otherwise
 */
export function getStringFromLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * Try to evaluate a static string value from a node.
 *
 * Handles:
 * - String literals: "hello"
 * - Template literals without expressions: `hello`
 * - Binary expressions (string concatenation): "hello" + " world"
 *
 * @param node - AST node to evaluate
 * @returns The static string value, or null if it cannot be determined
 */
export function getStaticStringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    if (node.templateSpans.length === 0) {
      return node.head.text;
    }
    return null;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = getStaticStringValue(node.left);
    const right = getStaticStringValue(node.right);
    if (left !== null && right !== null) {
      return left + right;
    }
  }

  return null;
}

/**
 * Extract props from a spread attribute's object expression.
 * Only handles literal object expressions like {...{ a: "1", b: "2" }}
 *
 * @param spreadAttr - JSX spread attribute to extract props from
 * @yields Tuples of [propName, propNode] for each property in the spread
 */
/**
 * Extract a static string from a JSX attribute value node.
 * Handles Literal, JSXExpressionContainer wrapping a Literal or pure TemplateLiteral.
 * @param node JSX attribute value node
 * @returns Static string value or null if dynamic
 */
/**
 * Try to evaluate a static numeric value from a node.
 *
 * Handles:
 * - Numeric literals: 42, 3.14
 * - Unary minus on numeric literals: -42
 * - Unary plus on numeric literals: +42
 *
 * @param node - AST node to evaluate
 * @returns The static numeric value, or null if it cannot be determined
 */
export function getStaticNumericValue(node: ts.Node): number | null {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node)) {
    if (ts.isNumericLiteral(node.operand)) {
      if (node.operator === ts.SyntaxKind.MinusToken) return -Number(node.operand.text);
      if (node.operator === ts.SyntaxKind.PlusToken) return Number(node.operand.text);
    }
  }
  /* `x ?? <literal>` — the result is always a number when the fallback is a
     numeric literal.  We return the fallback value which represents the
     guaranteed static minimum. */
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const fallback = getStaticNumericValue(node.right);
    if (fallback !== null) return fallback;
  }
  return null;
}

export function getStaticStringFromJSXValue(node: ts.Node | null): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) {
    const expression = node.expression;
    if (!expression) return null;
    if (ts.isStringLiteral(expression)) return expression.text;
    if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isTemplateExpression(expression) && expression.templateSpans.length === 0) {
      return expression.head.text;
    }
  }
  return null;
}

/** Binary operators that always produce a boolean result. */
const BOOLEAN_BINARY_OPERATORS = new Set([
  "==", "!=", "===", "!==", ">", ">=", "<", "<=", "in", "instanceof",
]);

/**
 * Check if an AST node is structurally boolean — its result is always boolean
 * regardless of operand types.
 *
 * Handles boolean literals, `!expr`, comparison operators, and `&&`/`||`
 * chains where both sides are boolean.
 */
export function isBooleanish(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isBinaryExpression(node)) {
    const opText = node.operatorToken.getText();
    if (BOOLEAN_BINARY_OPERATORS.has(opText)) return true;
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken || kind === ts.SyntaxKind.BarBarToken) {
      if (!isBooleanish(node.left)) return false;
      if (!isBooleanish(node.right)) return false;
      return true;
    }
  }

  return false;
}

/**
 * Check if an AST node definitively cannot produce a boolean value.
 *
 * Returns true for string/array/object/function literals, non-boolean
 * unary operators, non-comparison binary operators, and logical expressions
 * whose short-circuit evaluation yields a non-boolean.
 */
export function isDefinitelyNonBoolean(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) ||
      ts.isRegularExpressionLiteral(node) || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isArrayLiteralExpression(node)) return true;
  if (ts.isObjectLiteralExpression(node)) return true;
  if (ts.isArrowFunction(node)) return true;
  if (ts.isFunctionExpression(node)) return true;

  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) return false;
    return true;
  }

  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    // Logical operators
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const leftTruthiness = constantTruthiness(node.left);
      if (leftTruthiness === false) return isDefinitelyNonBoolean(node.left);
      if (leftTruthiness === true) return isDefinitelyNonBoolean(node.right);
      if (isDefinitelyNonBoolean(node.left)) return true;
      if (isDefinitelyNonBoolean(node.right)) return true;
      return false;
    }
    if (kind === ts.SyntaxKind.BarBarToken) {
      const leftTruthiness = constantTruthiness(node.left);
      if (leftTruthiness === true) return isDefinitelyNonBoolean(node.left);
      if (leftTruthiness === false) return isDefinitelyNonBoolean(node.right);
      if (isDefinitelyNonBoolean(node.left)) return true;
      if (isDefinitelyNonBoolean(node.right)) return true;
      return false;
    }
    // Non-logical binary
    const opText = node.operatorToken.getText();
    return !BOOLEAN_BINARY_OPERATORS.has(opText);
  }

  return false;
}

/**
 * Evaluate the constant truthiness of an AST node.
 *
 * Returns `true`/`false` for statically known truthy/falsy values,
 * or `null` if the truthiness cannot be determined at compile time.
 */
export function constantTruthiness(node: ts.Node): boolean | null {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return false;

  if (ts.isStringLiteral(node)) {
    return node.text.length > 0;
  }

  if (ts.isNumericLiteral(node)) {
    const v = Number(node.text);
    return v !== 0 && !Number.isNaN(v);
  }

  if (ts.isBigIntLiteral(node)) {
    return node.text !== "0n" && node.text !== "0";
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length > 0;
  }

  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) {
    return node.head.text.length > 0;
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const value = constantTruthiness(node.operand);
    if (value === null) return null;
    return !value;
  }

  return null;
}

export function* getPropsFromSpread(spreadAttr: ts.JsxSpreadAttribute): Generator<[string, ts.Node]> {
  const arg = spreadAttr.expression;
  if (!ts.isObjectLiteralExpression(arg)) return;

  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;

    if (ts.isPropertyAssignment(property)) {
      if (ts.isIdentifier(property.name)) {
        yield [property.name.text, property.name];
      } else if (ts.isStringLiteral(property.name)) {
        yield [property.name.text, property.name];
      }
    } else if (ts.isShorthandPropertyAssignment(property)) {
      yield [property.name.text, property.name];
    }
  }
}
