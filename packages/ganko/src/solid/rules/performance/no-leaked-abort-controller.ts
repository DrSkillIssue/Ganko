/**
 * No Leaked Abort Controller Rule
 *
 * Detects AbortController created inside reactive effects without
 * abort() in onCleanup.
 *
 * When an effect re-runs, the previous fetch is still in-flight.
 * Without aborting, the response may set state on an unmounted component.
 *
 * BAD:
 *   createEffect(() => {
 *     const controller = new AbortController();
 *     fetch("/api", { signal: controller.signal });
 *   });
 *
 * GOOD:
 *   createEffect(() => {
 *     const controller = new AbortController();
 *     fetch("/api", { signal: controller.signal });
 *     onCleanup(() => controller.abort());
 *   });
 */

import { defineConstructorLeakRule } from "./leak-detect"

export const noLeakedAbortController = defineConstructorLeakRule({
  id: "no-leaked-abort-controller",
  constructors: ["AbortController"],
  cleanupMethod: "abort",
  messageKey: "leakedAbort",
  messageTemplate:
    "new AbortController() inside a reactive effect without onCleanup. Add onCleanup(() => controller.abort()).",
  description: "Detect AbortController in effects without abort() in onCleanup.",
})
