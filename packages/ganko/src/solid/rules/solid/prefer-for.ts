/**
 * Prefer For Rule
 *
 * Suggest using `<For>` instead of `.map()` for rendering lists.
 *
 * In Solid.js, `<For>` uses keyed updates for DOM reconciliation, while `.map()`
 * recreates DOM on every change.
 *
 * Problem with .map():
 * ```
 * {items().map((item) => <div>{item.name}</div>)}
 * ```
 * - DOM is recreated on every change, even if item content hasn't changed
 * - Can lose DOM state (form inputs, focus, etc.)
 * - Harder to track which items changed
 *
 * Better with <For>:
 * ```
 * <For each={items()}>
 *   {(item) => <div>{item.name}</div>}
 * </For>
 * ```
 * - Uses keyed updates to preserve DOM nodes
 * - Preserves DOM state across changes
 * - Clear intent about rendering a list
 *
 * Use <For> when you have objects/complex data, <Index> for primitives.
 */

import ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { CallEntity } from "../../entities";
import { isMethodCallWithName, getMethodObject } from "../../util";
import type { FixOperation } from "../../../diagnostic"
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";
import { getCallsByMethodName, getJSXContext, getArrayElementKind } from "../../queries";

/**
 * The type of callback parameter pattern detected in the map function.
 */
type CallbackPattern =
  | "single-param" // (item) => ... - can use <For>
  | "with-index" // (item, index) => ... - might want <Index>
  | "no-params" // () => ... - unclear which to use
  | "rest-params"; // (...args) => ... - unclear which to use

/**
 * Represents a detected Array#map call that should use <For /> or <Index />.
 */
interface MapCallIssue {
  /** The CallExpression node for the map call */
  callNode: ts.CallExpression;
  /** The JsxExpression wrapping the map call */
  jsxContainer: ts.JsxExpression;
  /** The array being mapped over */
  arrayNode: ts.Expression;
  /** The callback function passed to map */
  callbackNode: ts.ArrowFunction | ts.FunctionExpression;
  /** The detected callback parameter pattern */
  callbackPattern: CallbackPattern;
  /** Whether this is an optional chain (?.map) */
  isOptionalChain: boolean;
  /** Array element type detected via TypeScript (for For vs Index suggestion) */
  elementKind: "primitive" | "object" | "unknown";
}

/**
 * Get the callback function argument from a map call.
 *
 * Extracts the first argument if it's a function expression.
 *
 * @param call - The map call entity
 * @returns The callback function node, or undefined if not a function
 */
function getCallbackArgument(
  call: CallEntity,
): ts.FunctionExpression | ts.ArrowFunction | undefined {
  const firstArg = call.arguments[0];
  if (!firstArg) return undefined;
  const node = firstArg.node;
  // Direct type check for TypeScript narrowing
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node;
  }
  return undefined;
}

/**
 * Analyze the callback function's parameter pattern.
 *
 * Determines how many parameters the callback has to suggest the appropriate
 * component (For vs Index).
 *
 * @param callback - The callback function to analyze
 * @returns The detected parameter pattern
 */
function analyzeCallbackPattern(
  callback: ts.FunctionExpression | ts.ArrowFunction,
): CallbackPattern {
  const params = callback.parameters;

  if (params.length === 0) {
    return "no-params";
  }

  if (params.length === 1) {
    // Check for rest parameter: (...args)
    const firstParam = params[0];
    if (!firstParam) return "no-params";
    if (firstParam.dotDotDotToken) {
      return "rest-params";
    }
    return "single-param";
  }

  // Multiple parameters means they're using the index
  return "with-index";
}



/**
 * Analyze a call entity to detect Array#map calls in JSX children.
 *
 * Checks if the call is a map method call used as a JSX child expression.
 * Handles optional chaining and extracts all relevant information for reporting
 * and fixing.
 *
 * @param call - The call entity to analyze
 * @param graph - The program graph for JSX context lookup
 * @returns Map call issue details, or null if not a relevant map call
 */
function analyzeMapCall(call: CallEntity, graph: SolidGraph): MapCallIssue | null {
  // Must be a .map() call on a CallExpression (not NewExpression)
  if (!ts.isCallExpression(call.node)) return null;
  if (!isMethodCallWithName(call.node, "map")) return null;

  const callNode = call.node;

  // Must have exactly one argument (the callback)
  if (call.arguments.length !== 1) return null;

  const callbackNode = getCallbackArgument(call);
  if (!callbackNode) return null;

  // Use getJSXContext query to check if this call is in a JSX child position
  const jsxContext = getJSXContext(graph, callNode);
  if (!jsxContext) return null;

  // Must be a child expression (not an attribute)
  if (jsxContext.kind !== "child") return null;

  // Check for optional chaining: the call might be wrapped in a ChainExpression
  let isOptionalChain = false;
  const jsxContainer: ts.JsxExpression | null = jsxContext.containerNode;

  // Handle optional chaining: items?.map(...) wraps call in ChainExpression
  // In TS AST, optional chaining is represented differently
  if (callNode.questionDotToken) {
    isOptionalChain = true;
  }

  if (!jsxContainer) return null;

  const arrayNode = getMethodObject(call.node);
  if (!arrayNode) return null;

  const callbackPattern = analyzeCallbackPattern(callbackNode);
  const elementKind = getArrayElementKind(graph, arrayNode);

  return {
    callNode,
    jsxContainer,
    arrayNode,
    callbackNode,
    callbackPattern,
    isOptionalChain,
    elementKind,
  };
}

/**
 * Generate a fix to transform Array#map to For or Index component.
 *
 * Replaces the map call with component syntax, preserving the array
 * expression and callback. Handles optional chaining by wrapping in extra braces.
 *
 * @param issue - The detected map call issue with node locations
 * @param component - The target component to transform to ("For" or "Index")
 * @param graph - The solid graph for sourceFile access
 * @returns An array of fix operations
 */
function generateFix(
  issue: MapCallIssue,
  component: "For" | "Index",
  graph: SolidGraph,
): readonly FixOperation[] {
  const { jsxContainer, arrayNode, callbackNode, isOptionalChain } = issue;

  const containerStart = jsxContainer.getStart(graph.sourceFile);
  const containerEnd = jsxContainer.end;
  const arrayStart = arrayNode.getStart(graph.sourceFile);
  const arrayEnd = arrayNode.end;
  const callbackStart = callbackNode.getStart(graph.sourceFile);
  const callbackEnd = callbackNode.end;

  const beforeArray: readonly [number, number] = [containerStart, arrayStart];
  const betweenArrayAndCallback: readonly [number, number] = [arrayEnd, callbackStart];
  const afterCallback: readonly [number, number] = [callbackEnd, containerEnd];

  if (isOptionalChain) {
    return [
      { range: beforeArray, text: `{<${component} each={` },
      { range: betweenArrayAndCallback, text: "}>{" },
      { range: afterCallback, text: `}</${component}>}` },
    ];
  }

  return [
    { range: beforeArray, text: `<${component} each={` },
    { range: betweenArrayAndCallback, text: "}>{" },
    { range: afterCallback, text: `}</${component}>` },
  ];
}

const messages = {
  preferFor:
    "Prefer Solid's `<For each={...}>` component for rendering lists of objects. Array#map recreates all DOM elements on every update, while <For> updates only changed items by keying on reference.",
  preferIndex:
    "Prefer Solid's `<Index each={...}>` component for rendering lists of primitives. Array#map recreates all DOM elements on every update, while <Index> updates only changed items by keying on index position.",
  preferForOrIndex:
    "Prefer Solid's `<For />` or `<Index />` component for rendering lists. Use <For> when items are objects (keys by reference), or <Index> when items are primitives like strings/numbers (keys by index). Array#map recreates all DOM elements on every update.",
} as const;

const options = {};

export const preferFor = defineSolidRule({
  id: "prefer-for",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce using Solid's `<For />` component for mapping an array to JSX elements.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const calls = getCallsByMethodName(graph, "map");
    if (calls.length === 0) return;

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i];
      if (!call) return;
      const issue = analyzeMapCall(call, graph);
      if (!issue) continue;

      const isObject = issue.elementKind === "object";
      const isPrimitive = issue.elementKind === "primitive";
      const isSingleParam = issue.callbackPattern === "single-param";

      const messageId = isObject || isSingleParam ? "preferFor" : isPrimitive ? "preferIndex" : "preferForOrIndex";
      const component = isObject || isSingleParam ? "For" : isPrimitive ? "Index" : null;

      emit(
        createDiagnostic(
          graph.filePath,
          issue.callNode,
          graph.sourceFile,
          "prefer-for",
          messageId,
          messages[messageId],
          "warn",
          component ? generateFix(issue, component, graph) : undefined,
        ),
      );
    }
  },
});
