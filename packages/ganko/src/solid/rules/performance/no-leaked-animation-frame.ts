/**
 * No Leaked Animation Frame Rule
 *
 * Detects requestAnimationFrame inside reactive effects without
 * cancelAnimationFrame in onCleanup.
 *
 * Recursive rAF loops continue indefinitely after component unmount.
 * The tick closure captures the component scope, preventing GC.
 *
 * BAD:
 *   createEffect(() => {
 *     requestAnimationFrame(tick);
 *   });
 *
 * GOOD:
 *   createEffect(() => {
 *     const id = requestAnimationFrame(tick);
 *     onCleanup(() => cancelAnimationFrame(id));
 *   });
 */

import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { findEnclosingEffectScope, collectCleanupCallbacks, hasAnyCleanup, extractCalleeName } from "./leak-detect"
import type { CallEntity } from "../../entities"

const messages = {
  leakedRaf:
    "requestAnimationFrame() inside a reactive effect without onCleanup. Add onCleanup(() => cancelAnimationFrame(id)).",
} as const

const options = {}

const isCancelRaf = (c: CallEntity): boolean => extractCalleeName(c.callee) === "cancelAnimationFrame"

export const noLeakedAnimationFrame = defineSolidRule({
  id: "no-leaked-animation-frame",
  severity: "warn",
  messages,
  meta: {
    description: "Detect requestAnimationFrame in effects without cancelAnimationFrame in onCleanup.",
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
      if (extractCalleeName(call.callee) !== "requestAnimationFrame") continue

      const result = findEnclosingEffectScope(graph, call.scope)
      if (!result) continue

      // requestAnimationFrame fires once and completes. In a one-shot scope
      // like onMount, exactly one rAF is scheduled — no accumulation possible.
      // Only rerunnable scopes (createEffect, createMemo, createReaction, etc.)
      // can accumulate rAF callbacks across re-executions.
      if (!result.rerunnable) continue

      if (hasAnyCleanup(graph, cleanups, result.scope, isCancelRaf)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "no-leaked-animation-frame",
          "leakedRaf",
          messages.leakedRaf,
          "warn",
        ),
      )
    }
  },
})
