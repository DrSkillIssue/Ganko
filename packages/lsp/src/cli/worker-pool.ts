/**
 * Worker Pool — Thread-based parallelism for CLI lint
 *
 * Dispatches file chunks to Bun Workers, each running its own ts.Program.
 * Workers are long-lived within a single CLI invocation. No shared mutable state.
 *
 * Uses Bun's native Worker API (web-style) instead of node:worker_threads
 * because Bun-compiled binaries have broken worker_threads Worker support.
 * The native Worker API is Bun's primary worker mechanism and works in
 * compiled executables when the worker file is alongside the binary.
 */
import { availableParallelism } from "node:os";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Diagnostic } from "@drskillissue/ganko";
import type { RuleOverrides, AccessibilityPolicy } from "@drskillissue/ganko-shared";

export interface WorkerResult {
  readonly file: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface WorkerTask {
  readonly tsconfigPath: string
  readonly files: readonly string[]
  readonly rootPath: string
  readonly overrides: RuleOverrides
  readonly accessibilityPolicy: AccessibilityPolicy | null
}

interface PendingJob {
  readonly task: WorkerTask
  resolve(results: readonly WorkerResult[]): void
  reject(err: Error): void
}

/**
 * Resolve the worker script path.
 *
 * In a Bun-compiled binary, `__dirname` points to the embedded virtual FS,
 * not the real filesystem. The worker script lives alongside the binary
 * on disk. We try `__dirname` first (works in dev/test), then fall back
 * to `dirname(process.execPath)` which is the real binary location.
 */
const WORKER_SCRIPT = (() => {
  const fromDirname = resolve(__dirname, "lint-worker.js");
  if (existsSync(fromDirname)) return fromDirname;
  return resolve(dirname(process.execPath), "lint-worker.js");
})();

export function defaultWorkerCount(): number {
  return Math.min(4, Math.max(1, availableParallelism() - 1));
}

export interface WorkerPool {
  dispatch(tasks: readonly WorkerTask[]): Promise<readonly WorkerResult[]>
  terminate(): Promise<void>
}

export function createWorkerPool(count: number): WorkerPool {
  if (!existsSync(WORKER_SCRIPT)) {
    throw new Error(`Worker script not found at ${WORKER_SCRIPT}. Ensure the project is built.`);
  }

  const workers: Worker[] = [];
  const idle: Worker[] = [];
  const queue: PendingJob[] = [];

  for (let i = 0; i < count; i++) {
    const w = new Worker(WORKER_SCRIPT);
    workers.push(w);
    idle.push(w);
  }

  function tryDispatch(): void {
    while (idle.length > 0 && queue.length > 0) {
      const worker = idle[idle.length - 1];
      if (!worker) continue;
      idle.pop();
      const job = queue[0];
      if (!job) continue;
      queue.shift();
      runJob(worker, job);
    }
  }

  function runJob(worker: Worker, job: PendingJob): void {
    const onMessage = (event: MessageEvent) => {
      worker.removeEventListener("error", onError);
      idle.push(worker);
      const results: readonly WorkerResult[] = JSON.parse(event.data);
      job.resolve(results);
      tryDispatch();
    };

    const onError = (event: ErrorEvent) => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      const idx = workers.indexOf(worker);
      const replacement = new Worker(WORKER_SCRIPT);
      workers[idx] = replacement;
      idle.push(replacement);
      job.reject(new Error(event.message));
      tryDispatch();
    };

    worker.addEventListener("message", onMessage, { once: true });
    worker.addEventListener("error", onError, { once: true });
    worker.postMessage(job.task);
  }

  return {
    dispatch(tasks) {
      const promises = tasks.map((task) => {
        return new Promise<readonly WorkerResult[]>((resolve, reject) => {
          queue.push({ task, resolve, reject });
        });
      });
      tryDispatch();
      return Promise.all(promises).then((arrays) => arrays.flat());
    },

    async terminate() {
      for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        if (w) w.terminate();
      }
      workers.length = 0;
      idle.length = 0;
      queue.length = 0;
    },
  };
}
