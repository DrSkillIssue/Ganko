/**
 * No Leaked Timer Rule
 *
 * Detects setInterval/setTimeout inside reactive effects without onCleanup.
 *
 * Effects re-run when dependencies change. Each re-run creates a new timer.
 * Without onCleanup to clear the previous timer, timers accumulate and leak.
 *
 * BAD:
 *   createEffect(() => {
 *     const id = setInterval(() => refresh(), 5000);
 *   });
 *
 * GOOD:
 *   createEffect(() => {
 *     const id = setInterval(() => refresh(), 5000);
 *     onCleanup(() => clearInterval(id));
 *   });
 */

import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { findEnclosingEffectScope, collectCleanupCallbacks, hasAnyCleanup, extractCalleeName } from "./leak-detect"
import type { CallEntity } from "../../entities"

const TIMER_PAIRS: ReadonlyMap<string, string> = new Map([
  ["setInterval", "clearInterval"],
  ["setTimeout", "clearTimeout"],
])

function makeClearerPredicate(name: string): (c: CallEntity) => boolean {
  return (c) => extractCalleeName(c.callee) === name
}

const CLEARER_PREDICATES = new Map<string, (c: CallEntity) => boolean>([
  ["clearInterval", makeClearerPredicate("clearInterval")],
  ["clearTimeout", makeClearerPredicate("clearTimeout")],
])

const messages = {
  leakedTimer:
    "{{setter}}() inside a reactive effect without onCleanup. Each re-run leaks a timer. Add onCleanup(() => {{clearer}}(id)).",
} as const

const options = {}

export const noLeakedTimer = defineSolidRule({
  id: "no-leaked-timer",
  severity: "warn",
  messages,
  meta: {
    description: "Detect setInterval/setTimeout in effects without onCleanup to clear them.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const calls = graph.calls
    if (calls.length === 0) return

    const cleanups = collectCleanupCallbacks(graph)

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;
      const name = extractCalleeName(call.callee)
      if (!name) continue

      const clearer = TIMER_PAIRS.get(name)
      if (!clearer) continue

      const result = findEnclosingEffectScope(graph, call.scope)
      if (!result) continue

      const predicate = CLEARER_PREDICATES.get(clearer)
      if (!predicate) continue

      if (hasAnyCleanup(graph, cleanups, result.scope, predicate)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "no-leaked-timer",
          "leakedTimer",
          resolveMessage(messages.leakedTimer, { setter: name, clearer }),
          "warn",
        ),
      )
    }
  },
})
