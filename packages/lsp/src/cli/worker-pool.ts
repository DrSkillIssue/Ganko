/**
 * Worker Pool — Thread-based parallelism for CLI lint
 *
 * Dispatches file chunks to worker_threads, each running its own ts.Program.
 * Workers are long-lived within a single CLI invocation. No shared mutable state.
 */
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Diagnostic } from "@drskillissue/ganko";
import type { RuleOverrides } from "@drskillissue/ganko-shared";

export interface WorkerResult {
  readonly file: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface WorkerTask {
  readonly tsconfigPath: string
  readonly files: readonly string[]
  readonly rootPath: string
  readonly overrides: RuleOverrides
}

interface PendingJob {
  readonly task: WorkerTask
  resolve(results: readonly WorkerResult[]): void
  reject(err: Error): void
}

const WORKER_SCRIPT = resolve(__dirname, "lint-worker.js");

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
    const onMessage = (results: readonly WorkerResult[]) => {
      worker.removeListener("error", onError);
      idle.push(worker);
      job.resolve(results);
      tryDispatch();
    };

    const onError = (err: Error) => {
      worker.removeListener("message", onMessage);
      worker.terminate().catch(() => {});
      const idx = workers.indexOf(worker);
      const replacement = new Worker(WORKER_SCRIPT);
      workers[idx] = replacement;
      idle.push(replacement);
      job.reject(err);
      tryDispatch();
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
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
      await Promise.all(workers.map((w) => w.terminate()));
      workers.length = 0;
      idle.length = 0;
      queue.length = 0;
    },
  };
}
