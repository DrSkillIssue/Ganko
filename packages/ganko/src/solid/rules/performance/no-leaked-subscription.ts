/**
 * No Leaked Subscription Rule
 *
 * Detects WebSocket/EventSource/BroadcastChannel created inside reactive
 * effects without close() in onCleanup.
 *
 * Each effect re-run opens a new connection. Without cleanup, previous
 * connections remain open consuming network resources.
 *
 * BAD:
 *   createEffect(() => {
 *     const ws = new WebSocket(url);
 *     ws.onmessage = handler;
 *   });
 *
 * GOOD:
 *   createEffect(() => {
 *     const ws = new WebSocket(url);
 *     ws.onmessage = handler;
 *     onCleanup(() => ws.close());
 *   });
 */

import { defineConstructorLeakRule } from "./leak-detect"

export const noLeakedSubscription = defineConstructorLeakRule({
  id: "no-leaked-subscription",
  constructors: ["WebSocket", "EventSource", "BroadcastChannel"],
  cleanupMethod: "close",
  messageKey: "leakedSubscription",
  messageTemplate:
    "new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => instance.close()).",
  description: "Detect WebSocket/EventSource/BroadcastChannel in effects without close() in onCleanup.",
})
