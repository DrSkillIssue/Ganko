/**
 * Memory monitoring primitives.
 *
 * Runtime-agnostic snapshot and high-water-mark tracking. Bun-native
 * via `bun:jsc` for `objectCount`; falls back to `process.memoryUsage()`
 * on Node.js. No timers — periodic scheduling belongs in the consumer.
 */

const MB = 1_048_576;

/** Point-in-time memory measurement. */
export interface MemorySnapshot {
  /** Unix ms timestamp */
  readonly timestamp: number
  /** JS heap in use (bytes) */
  readonly heapUsedBytes: number
  /** Total heap allocated (bytes) */
  readonly heapTotalBytes: number
  /** Resident set size (bytes) */
  readonly rssBytes: number
  /** External C++ memory (bytes) */
  readonly externalBytes: number
  /** Live JS object count (Bun only, -1 on Node) */
  readonly objectCount: number
  /** Process uptime in seconds */
  readonly uptimeSeconds: number
}

/** Formatted snapshot for logging / LSP responses. */
export interface MemorySnapshotFormatted {
  readonly heapUsedMB: number
  readonly heapTotalMB: number
  readonly rssMB: number
  readonly externalMB: number
  readonly objectCount: number
  readonly uptimeMinutes: number
}

/** Detect Bun runtime once at module load. */
const isBun: boolean = typeof globalThis.Bun !== "undefined";

/**
 * Attempt to load bun:jsc APIs. Returns null on non-Bun runtimes.
 * Cached after first call.
 */
interface JscApi {
  heapStats(): { heapSize: number; objectCount: number; extraMemorySize: number }
  gcAndSweep(): number
}

let jscApi: JscApi | null | undefined;

/**
 * Load bun:jsc module at runtime.
 *
 * @returns The JscApi interface or null if unavailable
 */
function loadJsc(): JscApi | null {
  if (!isBun) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: JscApi = require("bun:jsc");
    if (typeof mod.heapStats !== "function") return null;
    return mod;
  } catch {
    return null;
  }
}

function getJsc(): JscApi | null {
  if (jscApi !== undefined) return jscApi;
  jscApi = loadJsc();
  return jscApi;
}

/**
 * Take a memory snapshot using the best available runtime API.
 *
 * On Bun: uses `bun:jsc` heapStats for accurate object count.
 * On Node: uses `process.memoryUsage()`, objectCount = -1.
 *
 * @returns Point-in-time memory snapshot
 */
export function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  const jsc = getJsc();
  let objectCount = -1;

  if (jsc !== null) {
    const stats = jsc.heapStats();
    objectCount = stats.objectCount;
  }

  return {
    timestamp: Date.now(),
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    rssBytes: mem.rss,
    externalBytes: mem.external,
    objectCount,
    uptimeSeconds: process.uptime(),
  };
}

/** Round bytes to MB with 2 decimal places. */
function bytesToMB(bytes: number): number {
  return Math.round((bytes / MB) * 100) / 100;
}

/**
 * Format a snapshot for logging / display.
 *
 * @param snapshot - Raw memory snapshot
 * @returns Formatted snapshot with MB values
 */
export function formatSnapshot(snapshot: MemorySnapshot): MemorySnapshotFormatted {
  return {
    heapUsedMB: bytesToMB(snapshot.heapUsedBytes),
    heapTotalMB: bytesToMB(snapshot.heapTotalBytes),
    rssMB: bytesToMB(snapshot.rssBytes),
    externalMB: bytesToMB(snapshot.externalBytes),
    objectCount: snapshot.objectCount,
    uptimeMinutes: Math.round(snapshot.uptimeSeconds / 60),
  };
}

/**
 * Format a snapshot as a single log line.
 *
 * @param snapshot - Raw memory snapshot
 * @returns Human-readable single-line summary
 */
export function snapshotToLogLine(snapshot: MemorySnapshot): string {
  const f = formatSnapshot(snapshot);
  const objPart = f.objectCount >= 0 ? `, objects=${f.objectCount}` : "";
  return `heap=${f.heapUsedMB}/${f.heapTotalMB}MB, rss=${f.rssMB}MB, ext=${f.externalMB}MB${objPart}, uptime=${f.uptimeMinutes}min`;
}

/**
 * Tracks high-water marks for named metrics.
 *
 * Only reports `true` from `check()` when the current value exceeds
 * the previous high-water mark by at least `growthThresholdPercent`.
 * First measurement always reports true (establishes baseline).
 */
export class HighWaterMarkTracker {
  private readonly marks = new Map<string, number>();
  private readonly growthThreshold: number;

  /**
   * @param growthThresholdPercent - Minimum growth % to trigger (default 5)
   */
  constructor(growthThresholdPercent = 5) {
    this.growthThreshold = growthThresholdPercent / 100;
  }

  /**
   * Check if a metric has grown past its high-water mark.
   *
   * @param metric - Metric name (e.g. "rss", "heapUsed")
   * @param currentValue - Current value in bytes
   * @returns true if this is the first measurement or growth exceeds threshold
   */
  check(metric: string, currentValue: number): boolean {
    const prev = this.marks.get(metric);
    if (prev === undefined) {
      this.marks.set(metric, currentValue);
      return true;
    }
    if (currentValue > prev * (1 + this.growthThreshold)) {
      this.marks.set(metric, currentValue);
      return true;
    }
    return false;
  }

  /** Reset all tracked marks. */
  reset(): void {
    this.marks.clear();
  }
}

/**
 * Trigger a full GC if available.
 *
 * Bun: `Bun.gc(true)` (full GC + sweep).
 * Node: `globalThis.gc()` if `--expose-gc` flag is set.
 *
 * @returns true if GC was triggered
 */
export function triggerGC(): boolean {
  if (isBun) {
    try {
      globalThis.Bun.gc(true);
      return true;
    } catch {
      return false;
    }
  }
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    return true;
  }
  return false;
}
