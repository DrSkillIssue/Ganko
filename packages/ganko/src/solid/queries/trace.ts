/**
 * Value tracing, passthrough detection, and reachability analysis
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { ScopeEntity } from "../entities/scope";
import { HOOK_PATTERN } from "@ganko/shared";
import { getStaticStringValue } from "../util/static-value";
import { getScopeFor, isInTrackedContext } from "./scope";
import { isInsideJSXExpression } from "./parent-chain";
import { getVariableByNameInScope } from "./scope";
import { getContainingFunction } from "./entity";

/**
 * Options for reachability analysis.
 */
export interface ReachabilityOptions {
  treatHooksAsTracked?: boolean;
  checkIIFE?: boolean;
}

export function isInOnDepsPosition(graph: SolidGraph, node: T.Node): boolean {
  const cached = graph.onDepsCache.get(node);
  if (cached !== undefined) return cached;
  const result = computeIsInOnDepsPosition(node);
  graph.onDepsCache.set(node, result);
  return result;
}

function computeIsInOnDepsPosition(node: T.Node): boolean {
  let current: T.Node = node;
  let parent = node.parent;

  while (parent) {
    if (parent.type === "CallExpression" && parent.callee === current) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (parent.type === "ArrayExpression") {
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (parent.type === "CallExpression") {
      if (parent.arguments[0] === current) {
        const callee = parent.callee;
        if (callee.type === "Identifier" && callee.name === "on") return true;
      }
    }
    break;
  }

  return false;
}

export function isPassthroughPosition(graph: SolidGraph, node: T.Node): boolean {
  const cached = graph.passthroughCache.get(node);
  if (cached !== undefined) return cached;
  const result = computePassthroughPosition(graph, node);
  graph.passthroughCache.set(node, result);
  return result;
}

function computePassthroughPosition(graph: SolidGraph, node: T.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (parent.type === "ReturnStatement" && parent.argument === node) return true;
  if (parent.type === "VariableDeclarator" && parent.init === node) return true;

  if (parent.type === "Property" && parent.value === node) {
    if (isInAssignmentContext(parent.parent)) return true;
    // Property inside an object passed as a call argument: { ip: ipAddress }
    // Traverse from the ObjectExpression to the call argument position
    if (parent.parent?.type === "ObjectExpression") {
      const argNode = findCallArgumentNode(parent.parent);
      if (isPassthroughCallArgumentNode(graph, argNode)) return true;
      if (isCustomHookArgumentNode(argNode)) return true;
    }
    return false;
  }

  if (parent.type === "ArrayExpression") {
    if (isInAssignmentContext(parent)) return true;
    return isPassthroughCallArgumentNode(graph, findCallArgumentNode(parent));
  }

  const argNode = findCallArgumentNode(node);
  if (isPassthroughCallArgumentNode(graph, argNode)) return true;
  if (isCustomHookArgumentNode(argNode)) return true;

  return false;
}

function isInAssignmentContext(node: T.Node | undefined): boolean {
  if (!node) return false;
  if (node.type === "ReturnStatement" || node.type === "VariableDeclarator" || node.type === "AssignmentExpression") return true;
  if (node.type === "ObjectExpression" || node.type === "ArrayExpression") return isInAssignmentContext(node.parent);
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return isInAssignmentContext(node.parent);
  return false;
}

function findCallArgumentNode(node: T.Node): T.Node {
  let current: T.Node | undefined = node;
  let argNode: T.Node = node;
  while (current?.parent?.type === "ArrayExpression") {
    argNode = current.parent;
    current = current.parent;
  }
  return argNode;
}

function isPassthroughCallArgumentNode(graph: SolidGraph, argNode: T.Node): boolean {
  const arg = graph.callsByArgNode.get(argNode);
  if (!arg?.semantic) return false;
  const type = arg.semantic.semantic.type;
  return type === "passthrough" || type === "untracked";
}

function isCustomHookArgumentNode(argNode: T.Node): boolean {
  const parent = argNode.parent;
  if (parent?.type !== "CallExpression") return false;
  const callee = parent.callee;
  if (callee.type === "Identifier" && HOOK_PATTERN.test(callee.name)) return true;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier" && HOOK_PATTERN.test(callee.property.name)) return true;
  return false;
}

export function isReachableFromTrackedContext(graph: SolidGraph, node: T.Node, options?: ReachabilityOptions): boolean {
  const scope = getScopeFor(graph, node);
  if (isInTrackedContext(graph, scope)) return true;

  // Check if directly inside a JSX expression (respects function boundaries)
  if (isInsideJSXExpression(node)) return true;

  // Check if inside a function with reactive captures called from tracked context
  const fn = getContainingFunction(graph, node);
  if (fn) {
    // Check reachability flags
    const flags = fn._reachability;
    if (flags & 1) return true; // REACHABILITY_BASE
    if (options?.treatHooksAsTracked && (flags & 2)) return true; // REACHABILITY_HOOK
    if (options?.checkIIFE && (flags & 4)) return true; // REACHABILITY_IIFE
  }

  return false;
}

export function isPassthroughCallArgument(graph: SolidGraph, node: T.Node): boolean {
  const argNode = findCallArgumentNode(node);
  return isPassthroughCallArgumentNode(graph, argNode);
}

export function isCustomHookArgument(_graph: SolidGraph, node: T.Node): boolean {
  const argNode = findCallArgumentNode(node);
  return isCustomHookArgumentNode(argNode);
}

export function isInSyncCallbackAtTopLevel(graph: SolidGraph, node: T.Node, componentScope: ScopeEntity): boolean {
  const scope = getScopeFor(graph, node);
  // Check if we're inside a sync callback (map, filter, find, etc.)
  const chain = scope._scopeChain;
  if (!chain) return false;

  for (let i = 0, len = chain.length; i < len; i++) {
    const s = chain[i];
    if (!s) continue;
    if (s === componentScope) return false;
    const ctx = s.trackingContext;
    if (ctx && ctx.type === "tracked" && ctx.source === "sync-callback") {
      if (s.parent === componentScope) return true;
    }
  }
  return false;
}

export function traceToValue(graph: SolidGraph, expr: T.Expression, scope: ScopeEntity): T.Expression {
  if (expr.type !== "Identifier") return expr;
  const variable = getVariableByNameInScope(graph, expr.name, scope);
  if (!variable) return expr;
  const assignments = variable.assignments;
  if (assignments.length === 0) return expr;
  const first = assignments[0];
  if (!first) return expr;
  return first.value ?? expr;
}

export function resolveToStaticString(graph: SolidGraph, identifier: T.Identifier): string | null {
  const scope = getScopeFor(graph, identifier);
  const variable = getVariableByNameInScope(graph, identifier.name, scope);
  if (!variable) return null;
  const assignments = variable.assignments;
  if (assignments.length === 0) return null;
  const first = assignments[0];
  if (!first) return null;
  const value = first.value;
  if (!value) return null;
  return getStaticStringValue(value);
}

/**
 * Whether a node is nested inside a Solid primitive argument with `value`
 * semantic. Value-semantic arguments are evaluated once as initialization
 * snapshots (e.g. createSignal's first argument), so signal calls inside
 * them are intentional one-shot reads — not stale top-level captures.
 *
 * Walks the parent chain from the node, stopping at function boundaries.
 * At each ancestor, checks if it is a registered argument node in the graph
 * whose semantic type is `"value"`.
 *
 * @param graph - The solid graph instance
 * @param node - The AST node to check
 * @returns True if the node is inside a value-semantic primitive argument
 */
export function isInsideValueSemanticArg(graph: SolidGraph, node: T.Node): boolean {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      return false;
    }

    const arg = graph.callsByArgNode.get(current);
    if (arg?.semantic) {
      return arg.semantic.semantic.type === "value";
    }

    current = current.parent;
  }
  return false;
}

/**
 * Whether a signal/memo reference is used as a JSX attribute value on a
 * component element (not DOM). Passing an accessor without calling it to
 * a component prop is the correct Solid pattern when the child reads it
 * in its own tracked context.
 *
 * With type info available, additionally verifies the signal's type is
 * callable (Accessor or function), preventing false negatives on value
 * props that happen to receive a signal reference by mistake.
 *
 * @param graph - The solid graph instance
 * @param node - The AST node to check (the signal identifier)
 * @returns True if the node is a valid accessor passthrough in JSX
 */
export function isJSXAccessorPassthrough(graph: SolidGraph, node: T.Node): boolean {
  const parent = node.parent;
  if (parent?.type !== "JSXExpressionContainer") return false;

  const grandparent = parent.parent;
  if (grandparent?.type !== "JSXAttribute") return false;

  const opening = grandparent.parent;
  if (opening?.type !== "JSXOpeningElement") return false;

  const jsxElement = opening.parent;
  if (!jsxElement || (jsxElement.type !== "JSXElement" && jsxElement.type !== "JSXFragment")) return false;

  const element = graph.jsxByNode.get(jsxElement);
  if (!element || element.isDomElement) return false;

  // With type info: verify the signal's type is callable (Accessor<T> or function)
  if (graph.typeResolver.hasTypeInfo()) {
    return graph.typeResolver.isCallableType(node);
  }

  // Without type info: conservatively don't suppress — we can't distinguish
  // accessor-expecting props from value-expecting props
  return false;
}
