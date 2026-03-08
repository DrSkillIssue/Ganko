/**
 * Call Expression Utilities
 *
 * Helper functions for working with call expressions.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

/**
 * Extract the callee name from a call expression.
 *
 * Returns the identifier name for direct calls (foo()) or the property name
 * for method calls (obj.foo()). Returns null if the callee is not a simple identifier or property.
 *
 * @param node - The call or new expression node
 * @returns The callee name, or null if not extractable
 */
export function getCallName(node: T.CallExpression | T.NewExpression): string | null {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

/**
 * Check if a call expression is a method call (callee is a MemberExpression).
 *
 * @param node - The call or new expression node
 * @returns True if this is a method call, false otherwise
 *
 * @example
 * isMethodCall(node) // true for: arr.map(), obj.foo()
 * isMethodCall(node) // false for: foo(), new Foo()
 */
export function isMethodCall(node: T.CallExpression | T.NewExpression): boolean {
  return node.callee.type === "MemberExpression";
}

/**
 * Get the object that a method is being called on.
 *
 * Returns null for non-method calls. For method chains, returns the entire chain up to the method name.
 *
 * @param node - The call or new expression node
 * @returns The object expression being called on, or null if not a method call
 *
 * @example
 * getMethodObject(node) // returns `arr` node for: arr.map(...)
 * getMethodObject(node) // returns `obj.foo` node for: obj.foo.bar(...)
 * getMethodObject(node) // returns null for: foo(...)
 */
export function getMethodObject(node: T.CallExpression | T.NewExpression): T.Expression | null {
  if (node.callee.type === "MemberExpression") {
    return node.callee.object;
  }
  return null;
}

/**
 * Get the method name from a method call.
 *
 * Returns null for non-method calls, computed property access with non-identifier keys,
 * or when the property is not a simple string.
 *
 * @param node - The call or new expression node
 * @returns The method name, or null if not extractable
 *
 * @example
 * getMethodName(node) // returns "map" for: arr.map(...)
 * getMethodName(node) // returns "map" for: arr["map"](...)
 * getMethodName(node) // returns null for: foo(...)
 * getMethodName(node) // returns null for: arr[variable](...)
 */
export function getMethodName(node: T.CallExpression | T.NewExpression): string | null {
  if (node.callee.type !== "MemberExpression") {
    return null;
  }

  const property = node.callee.property;
  if (property.type === "Identifier") {
    return property.name;
  }
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
}

/**
 * Check if a call is a method call with a specific method name.
 *
 * Convenience function combining isMethodCall and getMethodName comparison.
 *
 * @param node - The call or new expression node
 * @param methodName - The expected method name
 * @returns True if this is a method call with the given name, false otherwise
 *
 * @example
 * isMethodCallWithName(node, "map") // true for: arr.map(...)
 * isMethodCallWithName(node, "map") // true for: arr["map"](...)
 * isMethodCallWithName(node, "map") // false for: arr.filter(...)
 * isMethodCallWithName(node, "map") // false for: map(...)
 */
export function isMethodCallWithName(
  node: T.CallExpression | T.NewExpression,
  methodName: string,
): boolean {
  return getMethodName(node) === methodName;
}

/**
 * JS built-in functions that take deferred callbacks.
 */
export const DEFERRED_FUNCTIONS = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);

/**
 * Methods that take deferred callbacks.
 * Map of method name -> array of argument indices that are deferred.
 */
export const DEFERRED_METHODS = new Map<string, number[]>([
  ["addEventListener", [1]],
  ["removeEventListener", [1]],
  ["then", [0, 1]],
  ["catch", [0]],
  ["finally", [0]],
]);

/**
 * Array methods that execute callbacks synchronously (inherit parent context).
 */
export const SYNC_CALLBACK_METHODS = new Set([
  "map",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "every",
  "some",
  "forEach",
  "reduce",
  "reduceRight",
  "flatMap",
  "sort",
  "toSorted",
]);

/**
 * Constructor suffixes that take deferred callbacks (Observer patterns).
 */
const DEFERRED_CONSTRUCTOR_SUFFIXES = ["Observer"] as const;

/**
 * Check if a constructor name takes deferred callbacks.
 *
 * @param name - Constructor name
 * @returns True if constructor takes deferred callbacks
 */
export function isDeferredConstructor(name: string): boolean {
  for (let i = 0; i < DEFERRED_CONSTRUCTOR_SUFFIXES.length; i++) {
    const suffix = DEFERRED_CONSTRUCTOR_SUFFIXES[i];
    if (suffix !== undefined && name.endsWith(suffix)) return true;
  }
  return false;
}
