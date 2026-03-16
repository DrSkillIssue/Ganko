/**
 * Async Tracked Scope Rule
 *
 * Detects async functions used as tracked scope callbacks.
 *
 * Problem:
 * Solid's reactivity only tracks synchronously. Using async functions
 * in createEffect, createMemo, etc. means reactivity won't work after
 * the first await.
 *
 * Solution:
 * Move async work to createResource, or use the synchronous parts
 * before any await for tracking.
 */

import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { FunctionEntity } from "../../entities/function"
import { defineSolidRule } from "../../rule"
import { getAsyncFunctions } from "../../queries/iterate"
import { getEffectiveTrackingContext } from "../../queries/scope"

const messages = {
  asyncCreateEffect:
    "Async function{{fnName}} in createEffect loses tracking after await. " +
    "Read all signals before the first await, or use createResource for async data fetching.",
  asyncCreateMemo:
    "Async function{{fnName}} in createMemo won't work correctly. " +
    "createMemo must be synchronous. For async derived data, use createResource instead.",
  asyncCreateComputed:
    "Async function{{fnName}} in createComputed won't track properly. " +
    "createComputed must be synchronous—signal reads after await won't trigger re-computation.",
  asyncCreateRenderEffect:
    "Async function{{fnName}} in createRenderEffect breaks DOM update timing. " +
    "createRenderEffect must be synchronous. Move async work to onMount or createResource.",
  asyncTrackedGeneric:
    "Async function{{fnName}} in {{source}} won't track reactivity after await. " +
    "Solid's tracking only works synchronously—signal reads after await are ignored.",
} as const

const options = {}

export const asyncTracked = defineSolidRule({
  id: "async-tracked",
  severity: "error",
  messages,
  meta: {
    description: "Disallow async functions in tracked scopes (createEffect, createMemo, etc.)",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    for (const fn of getAsyncFunctions(graph)) {
      const context = getEffectiveTrackingContext(graph, fn.scope)

      if (context.type === "tracked") {
        const { messageId, data } = getMessageForSource(context.source, fn)
        const msg = resolveMessage(messages[messageId], data)
        emit(createDiagnostic(graph.file, fn.node, graph.sourceFile, "async-tracked", messageId, msg, "error"))
      }
    }
  },
})

/**
 * Get the appropriate error message ID and data based on the tracking source.
 *
 * Maps the tracking context (createEffect, createMemo, etc.) to a specific
 * error message that explains why async functions don't work in that context.
 * Returns a generic message if the source is unknown.
 *
 * @param source - The tracking context name (e.g., "createEffect"), or undefined
 * @param fn - The async function entity to generate display name from
 * @returns Object with messageId and data for the error message
 *
 * @example
 * ```typescript
 * const { messageId, data } = getMessageForSource("createEffect", fnEntity);
 * // Returns: { messageId: "asyncCreateEffect", data: { fnName: " 'myFunc'" } }
 * ```
 */
function getMessageForSource(
   source: string | undefined,
   fn: FunctionEntity,
): {
   messageId: keyof typeof messages;
   data: Record<string, string>;
} {
  // Format function name for display: " 'myFunc'" or "" if anonymous
  const fnName = fn.name ? ` '${fn.name}'` : "";

  switch (source) {
    case "createEffect":
      return { messageId: "asyncCreateEffect", data: { fnName } };
    case "createMemo":
      return { messageId: "asyncCreateMemo", data: { fnName } };
    case "createComputed":
      return { messageId: "asyncCreateComputed", data: { fnName } };
    case "createRenderEffect":
      return { messageId: "asyncCreateRenderEffect", data: { fnName } };
    default:
      return {
        messageId: "asyncTrackedGeneric",
        data: { fnName, source: source ?? "tracked scope" },
      };
  }
}
