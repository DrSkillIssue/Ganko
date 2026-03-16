/**
 * Shared utilities for memory leak detection rules.
 *
 * Provides the core pattern: detect a resource allocation inside a reactive
 * effect scope, then verify a corresponding cleanup exists via one of three
 * strategies:
 *
 * 1. onCleanup inside the effect body (canonical Solid pattern)
 * 2. onCleanup at a parent scope (component body) that cleans the same resource
 * 3. Direct cleanup call in the effect body before re-allocation
 *
 * Strategies 2+3 together form the "manual cleanup + component onCleanup" pattern
 * where the direct call handles re-run and the component onCleanup handles disposal.
 * Either strategy alone indicates deliberate cleanup intent and suppresses the warning.
 */

import ts from "typescript"
import type { SolidGraph } from "../../impl"
import type { SolidRule } from "../../rule"
import { defineSolidRule } from "../../rule"
import type { CallEntity } from "../../entities/call"
import type { ScopeEntity } from "../../entities/scope"
import { getCallsByPrimitive, getAncestorScopes, getNewExpressionsByCallee, getScopeFor } from "../../queries"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

/**
 * Effect primitive names that create reactive computations with re-run semantics.
 */
export const EFFECT_SOURCES: ReadonlySet<string> = new Set([
  "createEffect",
  "createRenderEffect",
  "createComputed",
  "createMemo",
])

/**
 * Lifecycle hooks that run exactly once during the component's lifetime.
 * Resources allocated here cannot accumulate through re-execution.
 * onMount is createEffect(() => untrack(fn)) — tracks nothing, runs once.
 */
const ONESHOT_LIFECYCLE_SOURCES: ReadonlySet<string> = new Set([
  "onMount",
])

/**
 * Deferred primitives whose callbacks can fire multiple times.
 * createReaction's onInvalidate fires each time tracked dependencies
 * change and track() is re-called, so resources can accumulate.
 */
const RERUNNABLE_LIFECYCLE_SOURCES: ReadonlySet<string> = new Set([
  "createReaction",
])

/**
 * Result of finding the enclosing effect scope for a resource allocation.
 *
 * Encodes a fundamental semantic property of the enclosing scope: whether
 * its body can execute more than once during the component's lifetime.
 * This directly determines whether a single resource allocation can
 * accumulate into a leak.
 *
 * @param scope - the effect callback scope containing the allocation
 * @param rerunnable - true for createEffect/createMemo/createComputed/
 *   createRenderEffect/createReaction (body re-executes on dependency
 *   changes). False for onMount (runs exactly once, tracks nothing).
 */
export interface EffectScopeResult {
  readonly scope: ScopeEntity;
  readonly rerunnable: boolean;
}

/**
 * Find the enclosing effect scope for a given scope.
 *
 * Walks ancestor scopes looking for a scope that introduces a new effect
 * context (not inherited from its parent). Only matches scopes where
 * the context was directly assigned by an effect primitive, preventing
 * nested functions from being mistaken for the effect scope.
 *
 * @param graph - the solid graph
 * @param scope - the scope to start searching from
 * @returns the effect callback scope, or null if not inside an effect
 */
export function findEnclosingEffectScope(graph: SolidGraph, scope: ScopeEntity): EffectScopeResult | null {
  const ancestors = getAncestorScopes(graph, scope)

  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i]
    if (!ancestor) continue
    const context = ancestor.trackingContext ?? ancestor._resolvedContext
    if (!context) continue

    // Skip scopes that merely inherited their context from the parent.
    // Only match scopes that explicitly introduced a new tracking context
    // (the actual effect callback, not a nested function inside it).
    if (!ancestor.trackingContext && ancestor.parent) {
      const parentContext = ancestor.parent.trackingContext ?? ancestor.parent._resolvedContext
      if (parentContext === context) continue
    }

    if (context.source) {
      if (context.type === "tracked" && EFFECT_SOURCES.has(context.source)) {
        return { scope: ancestor, rerunnable: true }
      }
      if (context.type === "deferred" && ONESHOT_LIFECYCLE_SOURCES.has(context.source)) {
        return { scope: ancestor, rerunnable: false }
      }
      if (context.type === "deferred" && RERUNNABLE_LIFECYCLE_SOURCES.has(context.source)) {
        return { scope: ancestor, rerunnable: true }
      }
    }
  }

  return null
}

/**
 * Extract the function name from a callee expression.
 * Handles both bare identifiers (e.g., `setTimeout`) and property access
 * expressions (e.g., `window.setTimeout`, `globalThis.clearInterval`).
 */
export function extractCalleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name)
  ) {
    return callee.name.text
  }
  return null
}

/**
 * Check if an AST node is contained within another node using position comparison.
 */
export function isInsideNode(node: ts.Node, ancestor: ts.Node): boolean {
  return node.pos >= ancestor.pos && node.end <= ancestor.end
}

/**
 * Result of collecting cleanup callbacks across the file.
 *
 * @param byEffect - onCleanup callbacks inside effect scopes, keyed by effect scope
 * @param bySibling - onCleanup callbacks outside any effect, keyed by the scope
 *   they were declared in (component body, custom primitive, etc.)
 */
export interface CleanupCollection {
  readonly byEffect: Map<ScopeEntity, ts.Node[]>;
  readonly bySibling: Map<ScopeEntity, ts.Node[]>;
}

/**
 * Resolve the callback body from an onCleanup argument.
 *
 * Handles inline arrow/function expressions and named function references
 * (variables assigned to arrow/function expressions, function declarations).
 *
 * @param graph - the solid graph
 * @param cleanup - the onCleanup call entity
 * @returns the resolved callback AST node, or null if unresolvable
 */
function resolveCleanupCallback(graph: SolidGraph, cleanup: CallEntity): ts.Node | null {
  const callbackArg = cleanup.arguments[0]
  if (!callbackArg) return null

  const callbackNode = callbackArg.node

  if (
    ts.isArrowFunction(callbackNode) ||
    ts.isFunctionExpression(callbackNode)
  ) {
    return callbackNode
  }

  if (!ts.isIdentifier(callbackNode)) return null

  // Resolve named function reference: onCleanup(cleanup)
  const callRange = cleanup.node.pos
  let resolved: ts.Node | null = null

  // Check variable assignments for arrow/function expressions
  const vars = graph.variablesByName.get(callbackNode.text)
  if (vars) {
    for (let vi = 0, vlen = vars.length; vi < vlen; vi++) {
      const v = vars[vi]
      if (!v) continue
      if (v.scope !== cleanup.scope && !isAncestorScope(graph, v.scope, cleanup.scope)) continue

      const decls = v.declarations
      for (let di = 0, dlen = decls.length; di < dlen; di++) {
        const declarator = decls[di]?.parent
        if (declarator && ts.isVariableDeclaration(declarator) && declarator.initializer) {
          const init = declarator.initializer
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (!resolved || init.pos <= callRange) {
              resolved = init
            }
            break
          }
        }
      }
    }
  }

  // Fallback to function declarations
  if (!resolved) {
    const fns = graph.functionsByName.get(callbackNode.text)
    if (fns) {
      for (let fi = 0, flen = fns.length; fi < flen; fi++) {
        const fn = fns[fi]
        if (!fn) continue
        if (!fn.scope) continue
        if (fn.scope !== cleanup.scope && !isAncestorScope(graph, fn.scope, cleanup.scope)) continue
        resolved = fn.node
        break
      }
    }
  }

  return resolved
}

/**
 * Collect all onCleanup callback bodies, indexed by enclosing scope.
 *
 * Returns two maps:
 * - byEffect: onCleanup calls inside effect scopes, keyed by effect scope
 * - bySibling: onCleanup calls outside any effect, keyed by the scope they
 *   were declared in. Covers component bodies, custom primitives (createXxx),
 *   hooks (useXxx), and any other non-effect scope.
 */
export function collectCleanupCallbacks(graph: SolidGraph): CleanupCollection {
  const cleanupCalls = getCallsByPrimitive(graph, "onCleanup")
  const byEffect = new Map<ScopeEntity, ts.Node[]>()
  const bySibling = new Map<ScopeEntity, ts.Node[]>()

  for (let i = 0, len = cleanupCalls.length; i < len; i++) {
    const cleanup = cleanupCalls[i]
    if (!cleanup) continue
    const resolved = resolveCleanupCallback(graph, cleanup)
    if (!resolved) continue

    const result = findEnclosingEffectScope(graph, cleanup.scope)
    if (result) {
      const existing = byEffect.get(result.scope)
      if (existing) existing.push(resolved)
      else byEffect.set(result.scope, [resolved])
      continue
    }

    // Sibling-level onCleanup — not inside any effect.
    // Index by the scope the onCleanup was declared in so we can match
    // against effects that share the same parent scope.
    const key = cleanup.scope
    const existing = bySibling.get(key)
    if (existing) existing.push(resolved)
    else bySibling.set(key, [resolved])
  }

  return { byEffect, bySibling }
}

/**
 * Check if a scope is an ancestor of another scope.
 */
function isAncestorScope(graph: SolidGraph, candidate: ScopeEntity, descendant: ScopeEntity): boolean {
  const ancestors = getAncestorScopes(graph, descendant)
  for (let i = 0, len = ancestors.length; i < len; i++) {
    if (ancestors[i] === candidate) return true
  }
  return false
}

/**
 * Check if any cleanup callback in the effect scope contains a call matching a predicate.
 *
 * Iterates all graph calls and checks whether any call inside the cleanup callbacks
 * for the given effect scope matches the provided predicate.
 */
export function hasMatchingCleanupCall(
  graph: SolidGraph,
  cleanups: CleanupCollection,
  effectScope: ScopeEntity,
  predicate: (call: CallEntity) => boolean,
): boolean {
  return hasMatchingCallInCallbacks(graph, cleanups.byEffect, effectScope, predicate)
}

/**
 * Check if any callback node in the map for the given key contains a matching call.
 */
function hasMatchingCallInCallbacks(
  graph: SolidGraph,
  map: Map<ScopeEntity, ts.Node[]>,
  key: ScopeEntity,
  predicate: (call: CallEntity) => boolean,
): boolean {
  const callbacks = map.get(key)
  if (!callbacks) return false

  const calls = graph.calls
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i]
    if (!call) continue
    if (!predicate(call)) continue

    for (let j = 0, clen = callbacks.length; j < clen; j++) {
      const cb = callbacks[j]
      if (cb && isInsideNode(call.node, cb)) return true
    }
  }

  return false
}

/**
 * Check if a sibling onCleanup in the same parent scope contains a matching call.
 *
 * Walks the effect scope's parent chain to find any scope that has
 * sibling-level onCleanup callbacks containing the matching cleanup call.
 * Covers components, custom primitives (createXxx), and hooks (useXxx).
 *
 * Handles the pattern where onCleanup is a sibling of the effect:
 * ```
 * createEffect(() => { frameId = requestAnimationFrame(tick) })
 * onCleanup(() => cancelAnimationFrame(frameId))
 * ```
 */
export function hasSiblingCleanup(
  graph: SolidGraph,
  cleanups: CleanupCollection,
  effectScope: ScopeEntity,
  predicate: (call: CallEntity) => boolean,
): boolean {
  // The effect scope is the callback scope inside createEffect.
  // Its parent is the scope where createEffect was called (component body, etc.).
  // Sibling onCleanup calls live in that same parent scope or an ancestor.
  const ancestors = getAncestorScopes(graph, effectScope)
  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i]
    if (ancestor && hasMatchingCallInCallbacks(graph, cleanups.bySibling, ancestor, predicate)) return true
  }
  return false
}

/**
 * Check if the effect body contains a direct cleanup call matching the predicate.
 *
 * Handles the pattern where cleanup is called directly before re-allocation:
 * ```
 * createEffect(() => {
 *   cancelAnimationFrame(frameId)
 *   frameId = requestAnimationFrame(tick)
 * })
 * ```
 *
 * Also resolves one level of indirection through named functions:
 * ```
 * function cleanup() { cancelAnimationFrame(frameId) }
 * createEffect(() => {
 *   cleanup()
 *   frameId = requestAnimationFrame(tick)
 * })
 * ```
 */
export function hasDirectCleanupInEffectBody(
  graph: SolidGraph,
  effectScope: ScopeEntity,
  predicate: (call: CallEntity) => boolean,
): boolean {
  const effectNode = effectScope.node
  if (!effectNode) return false

  const calls = graph.calls
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i]
    if (!call) continue
    if (!isInsideNode(call.node, effectNode)) continue

    // Direct match: cancelAnimationFrame(id) in effect body
    if (predicate(call)) return true

    // One-level indirection: cleanup() where cleanup contains the matching call
    const name = extractCalleeName(call.callee)
    if (!name) continue

    const fns = graph.functionsByName.get(name)
    if (!fns) continue

    for (let fi = 0, flen = fns.length; fi < flen; fi++) {
      const fn = fns[fi]
      if (!fn) continue
      if (!fn.node) continue

      // Check if the resolved function body contains a matching call
      for (let ci = 0, clen = calls.length; ci < clen; ci++) {
        const inner = calls[ci]
        if (!inner) continue
        if (predicate(inner) && isInsideNode(inner.node, fn.node)) return true
      }
    }
  }

  return false
}

/**
 * Combined check for any form of cleanup associated with an effect scope.
 *
 * Checks three strategies in order:
 * 1. onCleanup inside the effect body (canonical pattern)
 * 2. onCleanup at a parent/component scope (sibling cleanup)
 * 3. Direct cleanup call in the effect body (manual re-run cleanup)
 *
 * @param graph - the solid graph
 * @param cleanups - collected cleanup callbacks from collectCleanupCallbacks
 * @param effectScope - the effect scope containing the resource allocation
 * @param predicate - matches the cleanup call (e.g., cancelAnimationFrame)
 * @returns true if any cleanup strategy is present
 */
export function hasAnyCleanup(
  graph: SolidGraph,
  cleanups: CleanupCollection,
  effectScope: ScopeEntity,
  predicate: (call: CallEntity) => boolean,
): boolean {
  if (hasMatchingCleanupCall(graph, cleanups, effectScope, predicate)) return true
  if (hasSiblingCleanup(graph, cleanups, effectScope, predicate)) return true
  if (hasDirectCleanupInEffectBody(graph, effectScope, predicate)) return true
  return false
}

/**
 * Check if any cleanup callback in the effect scope contains a method call
 * (e.g., `.disconnect()`, `.close()`, `.abort()`) on an instance created
 * in that scope. Uses a simple name-based check on property access expressions.
 */
export function hasMethodCallInCleanup(
  graph: SolidGraph,
  cleanups: CleanupCollection,
  effectScope: ScopeEntity,
  methodName: string,
): boolean {
  const predicate = (c: CallEntity): boolean => {
    const callee = c.callee
    if (!ts.isPropertyAccessExpression(callee)) return false
    const prop = callee.name
    return ts.isIdentifier(prop) && prop.text === methodName
  }

  return hasAnyCleanup(graph, cleanups, effectScope, predicate)
}

/**
 * Factory for constructor-leak rules.
 *
 * Produces a SolidRule that detects `new Constructor()` inside reactive effects
 * without a corresponding cleanup method call in `onCleanup`. Covers the shared
 * pattern used by no-leaked-observer, no-leaked-subscription, and
 * no-leaked-abort-controller.
 *
 * @param config - Rule identity and detection parameters
 * @returns A fully-defined SolidRule
 */
export function defineConstructorLeakRule(config: {
  readonly id: string
  readonly constructors: readonly string[]
  readonly cleanupMethod: string
  readonly messageKey: string
  readonly messageTemplate: string
  readonly description: string
}): SolidRule {
  const messages: Record<string, string> = { [config.messageKey]: config.messageTemplate }

  return defineSolidRule({
    id: config.id,
    severity: "warn",
    messages,
    meta: {
      description: config.description,
      fixable: false,
      category: "performance",
    },
    options: {},
    check(graph, emit) {
      const cleanups = collectCleanupCallbacks(graph)

      for (let t = 0; t < config.constructors.length; t++) {
        const type = config.constructors[t]
        if (!type) continue
        const newExprs = getNewExpressionsByCallee(graph, type)

        for (let i = 0, len = newExprs.length; i < len; i++) {
          const expr = newExprs[i]
          if (!expr) continue
          const scope = getScopeFor(graph, expr)
          const result = findEnclosingEffectScope(graph, scope)
          if (!result) continue

          if (hasMethodCallInCleanup(graph, cleanups, result.scope, config.cleanupMethod)) continue

          emit(
            createDiagnostic(
              graph.file,
              expr,
              graph.sourceFile,
              config.id,
              config.messageKey,
              resolveMessage(config.messageTemplate, { type }),
              "warn",
            ),
          )
        }
      }
    },
  })
}
