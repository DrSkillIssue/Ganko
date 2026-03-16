/**
 * JSX Utilities
 *
 * Helper functions for working with JSX elements and attributes.
 */

import ts from "typescript";
import { CHAR_O, CHAR_N, CHAR_COLON, CHAR_U, CHAR_S, CHAR_E, isUpperAlpha } from "@drskillissue/ganko-shared";

/**
 * JSX Attribute Kind (for classification)
 */
export type JSXAttributeKind =
  | "prop"
  | "event-handler"
  | "ref"
  | "directive"
  | "spread"
  | "style"
  | "class"
  | "classList";

/** Fast lookup for short attribute names that map directly to a kind. */
const SHORT_ATTR_KINDS = new Map<string, JSXAttributeKind>([
  ["ref", "ref"],
  ["style", "style"],
  ["class", "class"],
  ["className", "class"],
  ["classList", "classList"],
])

/**
 * Get the tag name from a JSX opening element.
 *
 * Handles identifier tags (div, Component), member expressions (Foo.Bar),
 * and namespaced names (namespace:name). Returns "unknown" if the tag type is not recognized.
 *
 * @param openingElement - The JSX opening element node
 * @returns The tag name as a string, or "unknown" if type is unrecognized
 */
export function getJSXTagName(openingElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  const name = openingElement.tagName;

  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isPropertyAccessExpression(name)) {
    return getJSXMemberExpressionName(name);
  }
  if (ts.isJsxNamespacedName(name)) {
    return `${name.namespace.text}:${name.name.text}`;
  }
  return "unknown";
}

/**
 * Build the full dotted name from a JSX member expression.
 *
 * Traverses the member expression chain to build the complete name string.
 * For `<Foo.Bar.Baz />`, returns "Foo.Bar.Baz".
 *
 * @param node - The JSX member expression node to extract the name from
 * @returns The full dotted name string (e.g., "Foo.Bar.Baz")
 */
function getJSXMemberExpressionName(node: ts.PropertyAccessExpression): string {
  let result = node.name.text;
  let current: ts.Expression = node.expression;

  while (ts.isPropertyAccessExpression(current)) {
    result = current.name.text + "." + result;
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    result = current.text + "." + result;
  }

  return result;
}

/**
 * Get the root identifier from a JSX member expression.
 *
 * For `<Namespace.Sub.Component />`, returns the "Namespace" JSXIdentifier node.
 * This is used to check if the root variable is defined in scope.
 *
 * @param node - The JSX member expression node
 * @returns The root JSXIdentifier, or null if the root is not an identifier
 *
 * @example
 * getJSXMemberExpressionRootIdentifier(<Foo.Bar.Baz />) // returns JSXIdentifier "Foo"
 * getJSXMemberExpressionRootIdentifier(<a.b />) // returns JSXIdentifier "a"
 */
export function getJSXMemberExpressionRootIdentifier(
  node: ts.PropertyAccessExpression,
): ts.Identifier | null {
  let current: ts.Expression = node;

  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    return current;
  }

  return null;
}

/**
 * Get the namespace from a JSX namespaced name.
 *
 * For attributes like `on:click`, `use:tooltip`, returns the namespace part (the prefix before the colon).
 * Returns null for regular attributes without namespaces.
 *
 * @param attr - The JSX attribute node
 * @returns The namespace name, or null if not a namespaced attribute
 *
 * @example
 * getAttributeNamespace(attr) // "on" for on:click
 * getAttributeNamespace(attr) // "use" for use:tooltip
 * getAttributeNamespace(attr) // null for regular attributes like "class"
 */
export function getAttributeNamespace(attr: ts.JsxAttribute): string | null {
  if (ts.isJsxNamespacedName(attr.name)) {
    return attr.name.namespace.text;
  }
  return null;
}

/**
 * Get the attribute name from a JSX attribute.
 *
 * Handles both JSXIdentifier and JSXNamespacedName attributes.
 * For namespaced names, returns the full "namespace:name" format.
 *
 * @param attr - The JSX attribute node
 * @returns The attribute name, including namespace if present (e.g., "onClick" or "on:click")
 */
export function getAttributeName(attr: ts.JsxAttribute): string {
  const name = attr.name;
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isJsxNamespacedName(name)) {
    return `${name.namespace.text}:${name.name.text}`;
  }
  return "unknown";
}

/**
 * Classify a JSX attribute by its kind.
 *
 * Uses character code checks instead of regex for event handler detection.
 *
 * @param name - Attribute name
 * @returns Attribute kind classification
 */
export function classifyAttribute(name: string): JSXAttributeKind {
  const len = name.length;
  if (len === 0) return "prop";

  // Quick path for common short names (most common attributes)
  if (len <= 9) {
    const short = SHORT_ATTR_KINDS.get(name)
    if (short) return short
  }

  const c0 = name.charCodeAt(0);

  // Check for 'o' (event handlers: on:*, onClick, oncapture:*)
  if (c0 === CHAR_O && len >= 2) {
    const c1 = name.charCodeAt(1);
    if (c1 === CHAR_N) {
      // 'on' prefix
      if (len >= 3) {
        const c2 = name.charCodeAt(2);
        // 'on:' prefix (e.g., on:click)
        if (c2 === CHAR_COLON) return "event-handler";
        // 'on[A-Z]' pattern (e.g., onClick) - check if c2 is uppercase
        if (isUpperAlpha(c2)) return "event-handler";
        // 'oncapture:' prefix
        if (
          len >= 10 &&
          c2 === 99 && // 'c'
          name.charCodeAt(3) === 97 && // 'a'
          name.charCodeAt(4) === 112 && // 'p'
          name.charCodeAt(5) === 116 && // 't'
          name.charCodeAt(6) === 117 && // 'u'
          name.charCodeAt(7) === 114 && // 'r'
          name.charCodeAt(8) === 101 && // 'e'
          name.charCodeAt(9) === CHAR_COLON
        ) {
          return "event-handler";
        }
      }
    }
  }

  // Check for 'u' (directive: use:*)
  if (c0 === CHAR_U && len >= 4) {
    if (
      name.charCodeAt(1) === CHAR_S &&
      name.charCodeAt(2) === CHAR_E &&
      name.charCodeAt(3) === CHAR_COLON
    ) {
      return "directive";
    }
  }

  return "prop";
}

/**
 * Get the name of a JSX attribute (alias for getAttributeName).
 *
 * For namespaced names like "on:click", returns the full name "on:click".
 * This is a convenience wrapper around getAttributeName.
 *
 * @param attr - The JSX attribute node
 * @returns The attribute name, including namespace if present
 */
export function getJSXAttributeName(attr: ts.JsxAttribute): string {
  return getAttributeName(attr);
}

/**
 * Get the value expression from a JSX attribute value.
 *
 * Unwraps expression containers and handles various attribute value formats:
 * - Direct literal values: href="url"
 * - Expression containers: href={expression}
 * - Empty expressions: href={} (returns null)
 * - Missing values: href (returns null)
 *
 * @param value - The attribute value (JSXExpressionContainer, Literal, or null)
 * @returns The expression node, or null if there's no value or empty expression
 */
export function getJSXAttributeValueExpression(value: ts.JsxAttribute["initializer"]): ts.Node | null {
  if (!value) return null;

  if (ts.isJsxExpression(value)) {
    if (!value.expression) {
      return null;
    }
    return value.expression;
  }

  // String literal value: href="javascript:..."
  return value;
}

/**
 * Check if a node is a JSX element or fragment.
 *
 * @param node - The node to check
 * @returns True if the node is JSXElement or JSXFragment
 */
export function isJSXElementOrFragment(node: ts.Node | null | undefined): boolean {
  if (!node) return false;
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/**
 * Find a direct function expression child inside a JSX element's children.
 *
 * Searches for a pattern like `<Component>{(args) => ...}</Component>` where
 * the child is a JSXExpressionContainer containing an arrow or function expression.
 * Returns the first function expression found among the element's children.
 *
 * Used by both the context phase (flow component tracking) and rules (signal-in-loop).
 *
 * @param children - The JSX element's child entities
 * @returns The function expression node, or null if no function child found
 */
export function findFunctionChildExpression(
  children: readonly { kind: string; node: ts.Node }[],
): ts.ArrowFunction | ts.FunctionExpression | null {
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.kind !== "expression") continue;
    if (!ts.isJsxExpression(child.node)) continue;
    const expr = child.node.expression;
    if (!expr) continue;
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      return expr;
    }
  }
  return null;
}
