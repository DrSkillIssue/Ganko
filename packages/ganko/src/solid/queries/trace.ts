/**
 * Value tracing, passthrough detection, and reachability analysis
 */
import ts from "typescript";
import type { SolidGraph } from "../impl";
import type { ScopeEntity } from "../entities/scope";
import { HOOK_PATTERN } from "@drskillissue/ganko-shared";
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

export function isInOnDepsPosition(graph: SolidGraph, node: ts.Node): boolean {
  const cached = graph.onDepsCache.get(node);
  if (cached !== undefined) return cached;
  const result = computeIsInOnDepsPosition(node);
  graph.onDepsCache.set(node, result);
  return result;
}

function computeIsInOnDepsPosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  let parent = node.parent;

  while (parent) {
    if (ts.isCallExpression(parent) && parent.expression === current) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isArrayLiteralExpression(parent)) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isCallExpression(parent)) {
      if (parent.arguments[0] === current) {
        const callee = parent.expression;
        if (ts.isIdentifier(callee) && callee.text === "on") return true;
      }
    }
    break;
  }

  return false;
}

export function isPassthroughPosition(graph: SolidGraph, node: ts.Node): boolean {
  const cached = graph.passthroughCache.get(node);
  if (cached !== undefined) return cached;
  const result = computePassthroughPosition(graph, node);
  graph.passthroughCache.set(node, result);
  return result;
}

function computePassthroughPosition(graph: SolidGraph, node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (ts.isReturnStatement(parent) && parent.expression === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true;

  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    if (isInAssignmentContext(parent.parent)) return true;
    // Property inside an object passed as a call argument: { ip: ipAddress }
    if (parent.parent && ts.isObjectLiteralExpression(parent.parent)) {
      const argNode = findCallArgumentNode(parent.parent);
      if (isPassthroughCallArgumentNode(graph, argNode)) return true;
      if (isCustomHookArgumentNode(argNode)) return true;
    }
    return false;
  }

  if (ts.isArrayLiteralExpression(parent)) {
    if (isInAssignmentContext(parent)) return true;
    return isPassthroughCallArgumentNode(graph, findCallArgumentNode(parent));
  }

  const argNode = findCallArgumentNode(node);
  if (isPassthroughCallArgumentNode(graph, argNode)) return true;
  if (isCustomHookArgumentNode(argNode)) return true;

  return false;
}

function isInAssignmentContext(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (ts.isReturnStatement(node) || ts.isVariableDeclaration(node) || ts.isBinaryExpression(node)) return true;
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return isInAssignmentContext(node.parent);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return isInAssignmentContext(node.parent);
  return false;
}

function findCallArgumentNode(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node;
  let argNode: ts.Node = node;
  while (current?.parent && ts.isArrayLiteralExpression(current.parent)) {
    argNode = current.parent;
    current = current.parent;
  }
  return argNode;
}

function isPassthroughCallArgumentNode(graph: SolidGraph, argNode: ts.Node): boolean {
  const arg = graph.callsByArgNode.get(argNode);
  if (!arg?.semantic) return false;
  const type = arg.semantic.semantic.type;
  return type === "passthrough" || type === "untracked";
}

function isCustomHookArgumentNode(argNode: ts.Node): boolean {
  const parent = argNode.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  const callee = parent.expression;
  if (ts.isIdentifier(callee) && HOOK_PATTERN.test(callee.text)) return true;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && HOOK_PATTERN.test(callee.name.text)) return true;
  return false;
}

export function isReachableFromTrackedContext(graph: SolidGraph, node: ts.Node, options?: ReachabilityOptions): boolean {
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

export function isPassthroughCallArgument(graph: SolidGraph, node: ts.Node): boolean {
  const argNode = findCallArgumentNode(node);
  return isPassthroughCallArgumentNode(graph, argNode);
}

export function isCustomHookArgument(_graph: SolidGraph, node: ts.Node): boolean {
  const argNode = findCallArgumentNode(node);
  return isCustomHookArgumentNode(argNode);
}

export function isInSyncCallbackAtTopLevel(graph: SolidGraph, node: ts.Node, componentScope: ScopeEntity): boolean {
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

export function traceToValue(graph: SolidGraph, expr: ts.Expression, scope: ScopeEntity): ts.Expression {
  if (!ts.isIdentifier(expr)) return expr;
  const variable = getVariableByNameInScope(graph, expr.text, scope);
  if (!variable) return expr;
  return variable.initializer ?? expr;
}

export function resolveToStaticString(graph: SolidGraph, identifier: ts.Identifier): string | null {
  const scope = getScopeFor(graph, identifier);
  const variable = getVariableByNameInScope(graph, identifier.text, scope);
  if (!variable) return null;
  const value = variable.initializer;
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
export function isInsideValueSemanticArg(graph: SolidGraph, node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
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
export function isJSXAccessorPassthrough(graph: SolidGraph, node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isJsxExpression(parent)) return false;

  const grandparent = parent.parent;
  if (!grandparent || !ts.isJsxAttribute(grandparent)) return false;

  // JsxAttribute -> JsxAttributes -> JsxOpeningElement/JsxSelfClosingElement
  const attrs = grandparent.parent;
  if (!attrs || !ts.isJsxAttributes(attrs)) return false;
  const opening = attrs.parent;
  if (!opening || (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening))) return false;

  const jsxElement = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
  if (!jsxElement || (!ts.isJsxElement(jsxElement) && !ts.isJsxSelfClosingElement(jsxElement) && !ts.isJsxFragment(jsxElement))) return false;

  const element = graph.jsxByNode.get(jsxElement as any);
  if (!element || element.isDomElement) return false;

  // With type info: verify the signal's type is callable (Accessor<T> or function)
  if (graph.typeResolver.hasTypeInfo()) {
    return graph.typeResolver.isCallableType(node);
  }

  // Without type info: conservatively don't suppress — we can't distinguish
  // accessor-expecting props from value-expecting props
  return false;
}
