/**
 * MemoryWatcher — periodic memory monitoring for the LSP server.
 *
 * Runs a 30-second .unref() timer. Uses HighWaterMarkTracker to
 * gate logging to significant growth only (≥5% RSS or heap increase).
 * First snapshot always logs (establishes baseline).
 *
 * Gemini CLI pattern: periodic check + high-water-mark gating.
 * Next.js pattern: setTimeout recursion to prevent overlapping snapshots.
 */

import {
  takeMemorySnapshot,
  snapshotToLogLine,
  HighWaterMarkTracker,
  Level,
  type MemorySnapshot,
} from "@drskillissue/ganko-shared";
import type { Logger } from "../core/logger";

/** Default interval between checks (30 seconds). */
const DEFAULT_INTERVAL_MS = 30_000;

/** Growth threshold percentage for high-water-mark tracker. */
const GROWTH_THRESHOLD_PERCENT = 5;

export class MemoryWatcher {
  private timerId: ReturnType<typeof setTimeout> | undefined;
  private readonly tracker: HighWaterMarkTracker;
  private readonly intervalMs: number;
  private readonly log: Logger;
  private lastSnapshot: MemorySnapshot | null = null;

  constructor(log: Logger, intervalMs = DEFAULT_INTERVAL_MS) {
    this.log = log;
    this.intervalMs = intervalMs;
    this.tracker = new HighWaterMarkTracker(GROWTH_THRESHOLD_PERCENT);
  }

  /** Start the periodic watcher. Idempotent. */
  start(): void {
    if (this.timerId !== undefined) return;
    this.scheduleNext();
  }

  /** Stop the watcher and release resources. */
  stop(): void {
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  /** Get the most recent snapshot (null before first check). */
  getLastSnapshot(): MemorySnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Force a snapshot and return it (for on-demand requests).
   * Does not affect the periodic schedule.
   */
  takeSnapshotNow(): MemorySnapshot {
    const snapshot = takeMemorySnapshot();
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  private scheduleNext(): void {
    this.timerId = setTimeout(() => {
      this.check();
      this.scheduleNext();
    }, this.intervalMs);
    /* .unref() ensures this timer does not prevent process exit. */
    this.timerId.unref();
  }

  private check(): void {
    const snapshot = takeMemorySnapshot();
    this.lastSnapshot = snapshot;

    const rssGrew = this.tracker.check("rss", snapshot.rssBytes);
    const heapGrew = this.tracker.check("heapUsed", snapshot.heapUsedBytes);

    if (rssGrew || heapGrew) {
      const reason = rssGrew && heapGrew ? "rss+heap" : rssGrew ? "rss" : "heap";
      if (this.log.isLevelEnabled(Level.Info)) this.log.info(`growth(${reason}): ${snapshotToLogLine(snapshot)}`);
    }
  }
}
