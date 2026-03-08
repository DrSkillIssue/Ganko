/**
 * No Leaked Event Listener Rule
 *
 * Detects addEventListener inside reactive effects without a matching
 * cleanup strategy. Three cleanup strategies are recognized:
 *
 * 1. removeEventListener in onCleanup (canonical pattern)
 * 2. Destroying the target object (.close/.abort/.terminate) in cleanup
 * 3. AbortController signal pattern: passing { signal: controller.signal }
 *    as addEventListener options and calling controller.abort() in cleanup
 *
 * BAD:
 *   createEffect(() => {
 *     window.addEventListener("resize", handler);
 *   });
 *
 * GOOD (removeEventListener):
 *   createEffect(() => {
 *     window.addEventListener("resize", handler);
 *     onCleanup(() => window.removeEventListener("resize", handler));
 *   });
 *
 * GOOD (AbortController signal):
 *   createEffect(() => {
 *     const controller = new AbortController();
 *     window.addEventListener("resize", handler, { signal: controller.signal });
 *     onCleanup(() => controller.abort());
 *   });
 *
 * GOOD (target destroy):
 *   createEffect(() => {
 *     const es = new EventSource(url());
 *     es.addEventListener("message", handler);
 *     onCleanup(() => es.close());
 *   });
 */

import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"
import { findEnclosingEffectScope, collectCleanupCallbacks, hasAnyCleanup } from "./leak-detect"
import type { CallEntity } from "../../entities"

/**
 * Methods that destroy an event target, making all attached listeners
 * unreachable. Calling any of these in cleanup is equivalent to
 * removeEventListener for every listener on that target.
 */
const TARGET_DESTROY_METHODS = new Set(["close", "abort", "terminate"])

const messages = {
  leakedListener:
    "addEventListener() inside a reactive effect without onCleanup. Each re-run leaks a listener. Add onCleanup(() => removeEventListener(...)).",
} as const

const options = {}

/**
 * Predicate: matches any call to removeEventListener.
 *
 * @param c - The call entity to check
 * @returns True if the call is to removeEventListener
 */
function isRemoveEventListener(c: CallEntity): boolean {
  if (c.callee.type !== "MemberExpression") return false
  const prop = c.callee.property
  return prop.type === "Identifier" && prop.name === "removeEventListener"
}

/**
 * Extract the target object name from an addEventListener call.
 *
 * For `es.addEventListener(...)` returns "es".
 * For `window.addEventListener(...)` returns "window".
 * Returns null for non-MemberExpression callees or computed targets.
 *
 * @param call - The addEventListener call entity
 * @returns The target identifier name, or null
 */
function getTarget(call: CallEntity): string | null {
  if (call.callee.type !== "MemberExpression") return null
  const obj = call.callee.object
  if (obj.type === "Identifier") return obj.name
  return null
}

/**
 * Create a predicate that matches target.close(), target.abort(), or
 * target.terminate() for a specific target name.
 *
 * @param name - The target identifier name to match against
 * @returns Predicate function for hasAnyCleanup
 */
function makeTargetDestroyPredicate(name: string): (c: CallEntity) => boolean {
  return (c) => {
    if (c.callee.type !== "MemberExpression") return false
    const obj = c.callee.object
    if (obj.type !== "Identifier" || obj.name !== name) return false
    const prop = c.callee.property
    return prop.type === "Identifier" && TARGET_DESTROY_METHODS.has(prop.name)
  }
}

/**
 * Extract the AbortController variable name from addEventListener's options.
 *
 * Matches the pattern:
 *   addEventListener("event", handler, { signal: controller.signal })
 *
 * Returns the controller name ("controller") when the third argument is an
 * ObjectExpression containing a `signal` property whose value is a
 * MemberExpression of the form `<identifier>.signal`.
 *
 * @param call - The addEventListener call entity
 * @returns The controller identifier name, or null
 */
function getSignalControllerName(call: CallEntity): string | null {
  const opts = call.arguments[2]
  if (!opts) return null

  const node = opts.node
  if (node.type !== "ObjectExpression") return null

  for (let i = 0, len = node.properties.length; i < len; i++) {
    const prop = node.properties[i]
    if (!prop) continue;
    if (prop.type !== "Property") continue
    if (prop.key.type !== "Identifier" || prop.key.name !== "signal") continue

    const val = prop.value
    if (val.type !== "MemberExpression") return null
    if (val.property.type !== "Identifier" || val.property.name !== "signal") return null
    if (val.object.type !== "Identifier") return null
    return val.object.name
  }

  return null
}

/**
 * Create a predicate that matches `<name>.abort()` in cleanup.
 *
 * @param name - The AbortController variable name
 * @returns Predicate function for hasAnyCleanup
 */
function makeAbortPredicate(name: string): (c: CallEntity) => boolean {
  return (c) => {
    if (c.callee.type !== "MemberExpression") return false
    const obj = c.callee.object
    if (obj.type !== "Identifier" || obj.name !== name) return false
    const prop = c.callee.property
    return prop.type === "Identifier" && prop.name === "abort"
  }
}

export const noLeakedEventListener = defineSolidRule({
  id: "no-leaked-event-listener",
  severity: "warn",
  messages,
  meta: {
    description: "Detect addEventListener in effects without removeEventListener in onCleanup.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const addCalls = getCallsByMethodName(graph, "addEventListener")
    if (addCalls.length === 0) return

    const cleanups = collectCleanupCallbacks(graph)

    for (let i = 0, len = addCalls.length; i < len; i++) {
      const call = addCalls[i]
      if (!call) continue;

      const result = findEnclosingEffectScope(graph, call.scope)
      if (!result) continue

      // Strategy 1: removeEventListener in cleanup
      if (hasAnyCleanup(graph, cleanups, result.scope, isRemoveEventListener)) continue

      // Strategy 2: destroy the target object (.close/.abort/.terminate)
      const target = getTarget(call)
      if (target) {
        if (hasAnyCleanup(graph, cleanups, result.scope, makeTargetDestroyPredicate(target))) continue
      }

      // Strategy 3: AbortController signal pattern
      // addEventListener("event", handler, { signal: controller.signal })
      // with controller.abort() in cleanup
      const controller = getSignalControllerName(call)
      if (controller) {
        if (hasAnyCleanup(graph, cleanups, result.scope, makeAbortPredicate(controller))) continue
      }

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "no-leaked-event-listener",
          "leakedListener",
          messages.leakedListener,
          "warn",
        ),
      )
    }
  },
})
