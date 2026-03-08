/**
 * Static Value Evaluation
 *
 * Utilities for evaluating static values from AST nodes.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

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
export function getStaticValue(node: T.Node | null): StaticValueResult | null {
  if (!node) return null;

  switch (node.type) {
    case "Literal": {
      const val = node.value;
      if (
        typeof val === "string" ||
        typeof val === "number" ||
        typeof val === "boolean" ||
        val === null
      ) {
        return { value: val };
      }
      return null;
    }

    case "TemplateLiteral": {
      const quasi = node.quasis[0];
      if (node.expressions.length === 0 && node.quasis.length === 1 && quasi) {
        return { value: quasi.value.cooked ?? quasi.value.raw };
      }
      return null;
    }

    case "UnaryExpression": {
      const argResult = getStaticValue(node.argument);
      if (argResult === null) return null;
      const argValue = argResult.value;

      switch (node.operator) {
        case "-":
          if (typeof argValue === "number") return { value: -argValue };
          break;
        case "+":
          if (typeof argValue === "number") return { value: +argValue };
          break;
        case "!":
          return { value: !argValue };
        case "typeof":
          return { value: typeof argValue };
      }
      return null;
    }

    case "BinaryExpression": {
      if (node.operator === "+") {
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

    // Identifier: true, false, undefined
    case "Identifier":
      if (node.name === "undefined") return { value: undefined };
      return null;

    default:
      return null;
  }
}

/**
 * Get the string value from a Literal node if it's a string.
 *
 * @param node - AST node to extract string from
 * @returns String value if node is a string literal, null otherwise
 */
export function getStringFromLiteral(node: T.Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
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
export function getStaticStringValue(node: T.Node): string | null {
  switch (node.type) {
    case "Literal":
      return getStringFromLiteral(node);

    case "TemplateLiteral": {
      const quasi = node.quasis[0];
      if (node.expressions.length === 0 && node.quasis.length === 1 && quasi) {
        return quasi.value.cooked ?? quasi.value.raw;
      }
      return null;
    }

    case "BinaryExpression":
      if (node.operator === "+") {
        const left = getStaticStringValue(node.left);
        const right = getStaticStringValue(node.right);
        if (left !== null && right !== null) {
          return left + right;
        }
      }
      return null;

    default:
      return null;
  }
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
export function getStaticNumericValue(node: T.Node): number | null {
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "UnaryExpression") {
    if (node.argument.type === "Literal" && typeof node.argument.value === "number") {
      if (node.operator === "-") return -node.argument.value;
      if (node.operator === "+") return node.argument.value;
    }
  }
  /* `x ?? <literal>` — the result is always a number when the fallback is a
     numeric literal.  We return the fallback value which represents the
     guaranteed static minimum. */
  if (node.type === "LogicalExpression" && node.operator === "??") {
    const fallback = getStaticNumericValue(node.right);
    if (fallback !== null) return fallback;
  }
  return null;
}

export function getStaticStringFromJSXValue(node: T.Node | null): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "JSXExpressionContainer") {
    const expression = node.expression;
    if (expression.type === "Literal" && typeof expression.value === "string") return expression.value;
    if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
      return expression.quasis.map((q) => q.value.cooked ?? "").join("");
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
export function isBooleanish(node: T.Node): boolean {
  if (node.type === "Literal") return typeof node.value === "boolean";
  if (node.type === "UnaryExpression" && node.operator === "!") return true;
  if (node.type === "BinaryExpression") return BOOLEAN_BINARY_OPERATORS.has(node.operator);

  if (node.type === "LogicalExpression") {
    if (node.operator !== "&&" && node.operator !== "||") return false;
    if (!isBooleanish(node.left)) return false;
    if (!isBooleanish(node.right)) return false;
    return true;
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
export function isDefinitelyNonBoolean(node: T.Node): boolean {
  if (node.type === "Literal") return typeof node.value !== "boolean";
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "ArrayExpression") return true;
  if (node.type === "ObjectExpression") return true;
  if (node.type === "ArrowFunctionExpression") return true;
  if (node.type === "FunctionExpression") return true;

  if (node.type === "UnaryExpression") {
    if (node.operator === "!") return false;
    return true;
  }

  if (node.type === "BinaryExpression") {
    return !BOOLEAN_BINARY_OPERATORS.has(node.operator);
  }

  if (node.type === "LogicalExpression") {
    const leftTruthiness = constantTruthiness(node.left);

    if (node.operator === "&&") {
      if (leftTruthiness === false) return isDefinitelyNonBoolean(node.left);
      if (leftTruthiness === true) return isDefinitelyNonBoolean(node.right);
      if (isDefinitelyNonBoolean(node.left)) return true;
      if (isDefinitelyNonBoolean(node.right)) return true;
      return false;
    }

    if (node.operator === "||") {
      if (leftTruthiness === true) return isDefinitelyNonBoolean(node.left);
      if (leftTruthiness === false) return isDefinitelyNonBoolean(node.right);
      if (isDefinitelyNonBoolean(node.left)) return true;
      if (isDefinitelyNonBoolean(node.right)) return true;
      return false;
    }
  }

  return false;
}

/**
 * Evaluate the constant truthiness of an AST node.
 *
 * Returns `true`/`false` for statically known truthy/falsy values,
 * or `null` if the truthiness cannot be determined at compile time.
 */
export function constantTruthiness(node: T.Node): boolean | null {
  if (node.type === "Literal") {
    const v = node.value;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
    if (typeof v === "string") return v.length > 0;
    if (typeof v === "bigint") return v !== 0n;
    if (v === null) return false;
    return true;
  }

  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    const t = node.quasis.map((q) => q.value.cooked ?? "").join("");
    return t.length > 0;
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    const value = constantTruthiness(node.argument);
    if (value === null) return null;
    return !value;
  }

  return null;
}

export function* getPropsFromSpread(spreadAttr: T.JSXSpreadAttribute): Generator<[string, T.Node]> {
  const arg = spreadAttr.argument;
  if (arg.type !== "ObjectExpression") return;

  for (const property of arg.properties) {
    if (property.type !== "Property") continue;

    if (property.key.type === "Identifier") {
      yield [property.key.name, property.key];
    } else if (property.key.type === "Literal") {
      yield [String(property.key.value), property.key];
    }
  }
}
