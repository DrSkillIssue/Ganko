/**
 * No Leaked Observer Rule
 *
 * Detects ResizeObserver/MutationObserver/IntersectionObserver created inside
 * reactive effects without disconnect() in onCleanup.
 *
 * Observers hold strong references to observed elements and their callbacks.
 * Without disconnect(), the observer persists after the component unmounts.
 *
 * BAD:
 *   createEffect(() => {
 *     const observer = new ResizeObserver(callback);
 *     observer.observe(el);
 *   });
 *
 * GOOD:
 *   createEffect(() => {
 *     const observer = new ResizeObserver(callback);
 *     observer.observe(el);
 *     onCleanup(() => observer.disconnect());
 *   });
 */

import { defineConstructorLeakRule } from "./leak-detect"

export const noLeakedObserver = defineConstructorLeakRule({
  id: "no-leaked-observer",
  constructors: ["ResizeObserver", "MutationObserver", "IntersectionObserver"],
  cleanupMethod: "disconnect",
  messageKey: "leakedObserver",
  messageTemplate:
    "new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => observer.disconnect()).",
  description: "Detect Observer APIs in effects without disconnect() in onCleanup.",
})
