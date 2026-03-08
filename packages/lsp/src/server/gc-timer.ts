/**
 * GcTimer — debounced garbage collection after LSP requests.
 *
 * Adapted from tsserver's GcTimer pattern: schedules a full GC 7 seconds
 * after the last request completes. Multiple rapid requests coalesce
 * into a single GC pass. Logs before/after heap to trace effectiveness.
 *
 * On Bun: uses `triggerGC()` which calls `Bun.gc(true)`.
 * On Node: uses `globalThis.gc()` if `--expose-gc` flag is set.
 */

import { triggerGC, takeMemorySnapshot, snapshotToLogLine } from "@ganko/shared";
import type { Logger } from "../core/logger";

/** Default delay in ms before triggering GC after last request. */
const DEFAULT_DELAY_MS = 7_000;

export class GcTimer {
  private timerId: ReturnType<typeof setTimeout> | undefined;
  private readonly delayMs: number;
  private readonly log: Logger;

  constructor(log: Logger, delayMs = DEFAULT_DELAY_MS) {
    this.log = log;
    this.delayMs = delayMs;
  }

  /**
   * Schedule a GC pass after idle timeout.
   *
   * Resets the timer on every call so GC fires `delayMs` after the
   * *last* request in a burst, not the first.
   */
  scheduleCollect(): void {
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
    }

    this.timerId = setTimeout(() => {
      this.timerId = undefined;
      this.runGc();
    }, this.delayMs);
  }

  /** Cancel any pending GC and release resources. */
  dispose(): void {
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  private runGc(): void {
    const triggered = triggerGC();
    if (!triggered) return;

    if (!this.log.enabled) return;
    const snapshot = takeMemorySnapshot();
    this.log.debug(`GC completed | ${snapshotToLogLine(snapshot)}`);
  }
}
