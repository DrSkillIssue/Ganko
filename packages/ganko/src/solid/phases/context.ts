/**
 * Context Phase (Phase 4)
 *
 * Sets tracking contexts based on Solid primitive call semantics.
 *
 * This phase:
 * - Marks component function scopes with "component-body" context
 * - Propagates context to nested scopes
 * - Sets "tracked" context for effect/memo callbacks
 * - Sets "deferred" context for deferred computations
 * - Sets "untracked" context for untracked regions
 * - Sets contexts for flow component callbacks (For, Index, Show, Match, ErrorBoundary)
 *
 * Context determines whether signal reads are tracked for reactivity.
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { ScopeEntity, TrackingContext } from "../entities/scope";
import type { CallEntity } from "../entities/call";
import type { JSXElementEntity } from "../entities/jsx";
import { UNKNOWN_CONTEXT as _UNKNOWN_CONTEXT } from "../entities/scope";
import { getScopeFor } from "../queries/scope";
import { findFunctionChildExpression } from "../util/jsx";

export function runContextPhase(graph: SolidGraph, _input: SolidInput): void {
    // Set component context for component functions first
    const componentFunctions = graph.componentFunctions;
    for (let i = 0, len = componentFunctions.length; i < len; i++) {
      const fn = componentFunctions[i];
      if (!fn) continue;
      const context: TrackingContext = { type: "component-body", source: fn.name ?? "component" };
      fn.scope._resolvedContext = context;
      propagateContextToChildren(fn.scope, context);
    }

    // Set contexts from primitive call argument semantics
    const calls = graph.calls;
    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i];
      if (!call) continue;
      const semantics = call.argumentSemantics;

      for (let j = 0, slen = semantics.length; j < slen; j++) {
        const semantic = semantics[j];
        if (!semantic) continue;
        const semType = semantic.semantic.type;

        // Only process context-setting semantics
        if (semType !== "tracked" && semType !== "deferred" && semType !== "untracked") {
          continue;
        }

        const arg = call.arguments[semantic.position];
        if (!arg) continue;

        // Find the function argument at this position
        const argNode = arg.node;
        if (argNode.type === "SpreadElement") continue;

        // Handle function expressions directly passed as arguments
        if (argNode.type === "ArrowFunctionExpression" || argNode.type === "FunctionExpression") {
          setFunctionContext(argNode, semType, call, graph);
          continue;
        }

        // Handle identifier references to functions
        if (argNode.type === "Identifier") {
          const fns = graph.functionsByName.get(argNode.name);
          if (fns && fns.length === 1) {
            const resolvedFn = fns[0];
            if (!resolvedFn) continue;
            const primitiveName = call.primitive?.name ?? "unknown";
            const context: TrackingContext = { type: semType, source: primitiveName };
            resolvedFn.scope._resolvedContext = context;
            propagateContextToChildren(resolvedFn.scope, context);
          }
        }
      }
    }

    // Set deferred context for JSX event handler functions
    setEventHandlerContexts(graph);

    // Set contexts for flow component callback children
    setFlowComponentContexts(graph);
}

/**
 * Sets the tracking context on a function scope based on its primitive call.
 * @param node - The function node
 * @param type - The context type
 * @param call - The call entity
 * @param graph - The solid graph
 */
function setFunctionContext(
  node: T.ArrowFunctionExpression | T.FunctionExpression,
  type: "tracked" | "deferred" | "untracked",
  call: CallEntity,
  graph: SolidGraph,
): void {
  const fnScope = getScopeFor(graph, node);
  const primitiveName = call.primitive?.name ?? "unknown";
  const context: TrackingContext = { type, source: primitiveName };
  fnScope._resolvedContext = context;
  propagateContextToChildren(fnScope, context);
}

/**
 * Propagates tracking context to child scopes.
 * 
 * Context priority (explicit contexts override inherited):
 * 1. untracked: untrack(), createRoot() — overrides all
 * 2. Primitive semantics: tracked/deferred/sync — overrides parent
 * 3. jsx-expression: JSX expression boundaries — overrides component-body
 * 4. deferred: event handlers, onMount, onCleanup — overrides component-body
 * 5. component-body: component function bodies — does NOT track
 * 6. unknown: no context
 * 
 * @param scope - The parent scope
 * @param context - The context to propagate
 */
function propagateContextToChildren(scope: ScopeEntity, context: TrackingContext): void {
  const children = scope.children;
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    const existing = child._resolvedContext;
    
    // Check if we should override the existing context
    if (!existing || existing.type === "unknown" || shouldOverrideContext(existing.type, context.type)) {
      child._resolvedContext = context;
      propagateContextToChildren(child, context);
    }
  }
}

/**
 * Determines if newType should override existingType during propagation.
 *
 * Event handler `deferred` context is sacrosanct — handlers fire on user
 * interaction regardless of the surrounding reactive scope, so no parent
 * propagation (including `untracked` from Show/Match) should clobber it.
 */
function shouldOverrideContext(existingType: string, newType: string): boolean {
  // Deferred (event handlers) is never overridden by propagation
  if (existingType === "deferred") return false;
  // component-body overrides component-body (flow component callbacks set specific source)
  if (newType === "component-body" && existingType === "component-body") return true;
  // Deferred overrides component-body (event handler contains nested function)
  if (newType === "deferred" && existingType === "component-body") return true;
  // JSX expressions override component-body
  if (newType === "jsx-expression" && existingType === "component-body") return true;
  // Untracked overrides everything except itself
  if (newType === "untracked" && existingType !== "untracked") return true;
  return false;
}

/**
 * Sets deferred context for functions used as JSX event handler values.
 * Event handlers (onClick, onInput, on:click, etc.) execute later, not during render.
 * @param graph - The solid graph
 */
function setEventHandlerContexts(graph: SolidGraph): void {
  const eventHandlerAttrs = graph.jsxAttrsByKind.get("event-handler");
  if (!eventHandlerAttrs) return;

  const deferredContext: TrackingContext = { type: "deferred", source: "event-handler" };

  for (let i = 0, len = eventHandlerAttrs.length; i < len; i++) {
    const entry = eventHandlerAttrs[i];
    if (!entry) continue;
    const { attr } = entry;
    const valueNode = attr.valueNode;
    if (!valueNode) continue;

    // Unwrap JSXExpressionContainer to get the actual expression
    const expr = valueNode.type === "JSXExpressionContainer" 
      ? valueNode.expression 
      : valueNode;

    // Handle inline function expressions: onClick={() => ...}
    if (expr.type === "ArrowFunctionExpression" || expr.type === "FunctionExpression") {
      const fnScope = getScopeFor(graph, expr);
      fnScope._resolvedContext = deferredContext;
      propagateContextToChildren(fnScope, deferredContext);
      continue;
    }

    // Handle identifier references: onClick={handleClick}
    if (expr.type === "Identifier") {
      const fns = graph.functionsByName.get(expr.name);
      if (fns && fns.length === 1) {
        const resolvedFn = fns[0];
        if (resolvedFn) {
          resolvedFn.scope._resolvedContext = deferredContext;
          propagateContextToChildren(resolvedFn.scope, deferredContext);
        }
      }
    }
  }
}

/**
 * Flow component callback semantic — describes the tracking context for
 * the children callback and optionally the fallback prop.
 *
 * Runtime semantics (verified against Solid.js source):
 * - For/Index: children callback runs inside createRoot() via mapArray/indexArray.
 *   Modeled as "component-body" — runs once per item, untracked at body level,
 *   JSX expressions inside create their own tracked effects.
 * - Show/Match: children callback wrapped in untrack() inside createMemo.
 * - ErrorBoundary: fallback callback wrapped in untrack() inside createMemo.
 */
interface FlowCallbackSemantic {
  children: TrackingContext;
  fallback?: TrackingContext;
}

const FLOW_SEMANTICS = new Map<string, FlowCallbackSemantic>([
  ["For", { children: { type: "component-body", source: "For" } }],
  ["Index", { children: { type: "component-body", source: "Index" } }],
  ["Show", { children: { type: "untracked", source: "Show" } }],
  ["Match", { children: { type: "untracked", source: "Match" } }],
  ["ErrorBoundary", {
    children: { type: "untracked", source: "ErrorBoundary" },
    fallback: { type: "untracked", source: "ErrorBoundary" },
  }],
]);

/**
 * Sets tracking contexts for flow component callback children and fallback props.
 *
 * Flow components like For, Index, Show, Match, and ErrorBoundary accept
 * function children that run in specific reactive contexts at runtime.
 * This function sets the correct tracking context on those callback scopes.
 *
 * @param graph - The solid graph
 */
function setFlowComponentContexts(graph: SolidGraph): void {
  for (const [tag, semantic] of FLOW_SEMANTICS) {
    const elements = graph.jsxByTag.get(tag);
    if (!elements) continue;

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      if (!element) continue;

      const fnNode = findFunctionChildExpression(element.children);
      if (fnNode) {
        const fnScope = getScopeFor(graph, fnNode);
        fnScope._resolvedContext = semantic.children;
        propagateContextToChildren(fnScope, semantic.children);
      }

      if (semantic.fallback) {
        setFallbackPropContext(graph, element, semantic.fallback);
      }
    }
  }
}

/**
 * Sets tracking context on a fallback prop function expression.
 *
 * Looks for a `fallback` attribute on the element. If its value is a function
 * expression, sets the given tracking context on its scope.
 *
 * @param graph - The solid graph
 * @param element - The JSX element to search for fallback prop
 * @param context - The tracking context to set
 */
function setFallbackPropContext(
  graph: SolidGraph,
  element: JSXElementEntity,
  context: TrackingContext,
): void {
  const attrs = element.attributes;
  for (let i = 0, len = attrs.length; i < len; i++) {
    const attrEntry = attrs[i];
    if (!attrEntry) continue;
    if (attrEntry.name !== "fallback") continue;
    const value = attrEntry.valueNode;
    if (!value) break;
    const expr = value.type === "JSXExpressionContainer"
      ? value.expression
      : value;
    if (expr.type === "ArrowFunctionExpression" || expr.type === "FunctionExpression") {
      const fnScope = getScopeFor(graph, expr);
      fnScope._resolvedContext = context;
      propagateContextToChildren(fnScope, context);
    }
    break;
  }
}
