# Phase 2: Worker Parallelism

**Effort**: L (2-3 days)
**Depends on**: Phase 1 (workers need `ts.Node` API surface and direct `ts.createProgram`)
**Independent value**: 4-6x speedup on CLI cold lint. Post-Phase 1 serial time ~6-10s → 1.5-3s with workers.

---

## Serialization boundary

`Diagnostic` is a plain JSON object:

```typescript
interface Diagnostic {
  readonly file: string
  readonly rule: string
  readonly messageId: string
  readonly message: string
  readonly severity: "error" | "warn"
  readonly loc: { start: { line: number; column: number }; end: { line: number; column: number } }
  readonly fix?: readonly { range: readonly [number, number]; text: string }[]
  readonly suggest?: readonly { messageId: string; message: string; fix: readonly { range: readonly [number, number]; text: string }[] }[]
}
```

No `ts.Node` references. No `ts.SourceFile` references. Fully `structuredClone`-able. Workers return `Diagnostic[]` via `postMessage`.

**Fix range validation**: If `--fix` mode is ever added, fixes must validate that the file content hash matches before applying. Diagnostic fix ranges contain absolute positions computed from the worker's `ts.SourceFile` — if the file changed between worker read and fix application, positions are invalid.

---

## `packages/lsp/src/cli/worker-pool.ts` (NEW)

```typescript
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Diagnostic } from "@drskillissue/ganko";

export interface WorkerResult {
  readonly file: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface WorkerTask {
  readonly tsconfigPath: string
  readonly files: readonly string[]
  readonly rootPath: string
}

interface PendingJob {
  readonly task: WorkerTask
  resolve(results: readonly WorkerResult[]): void
  reject(err: Error): void
}

const WORKER_SCRIPT = resolve(__dirname, "lint-worker.js");
if (!existsSync(WORKER_SCRIPT)) {
  throw new Error(`Worker script not found at ${WORKER_SCRIPT}. Ensure the project is built.`);
}

export function defaultWorkerCount(): number {
  return Math.min(4, Math.max(1, availableParallelism() - 1));
}

export interface WorkerPool {
  dispatch(tasks: readonly WorkerTask[]): Promise<readonly WorkerResult[]>
  terminate(): Promise<void>
}

export function createWorkerPool(count: number): WorkerPool {
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
      const replacement = new Worker(WORKER_SCRIPT);
      workers[workers.indexOf(worker)] = replacement;
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
```

Key design decisions:
- Workers are long-lived within a single CLI invocation. Spawning N workers, sending one chunk each, collecting results.
- Worker count capped at `min(4, availableParallelism() - 1)`. 4 workers × ~200MB per program = ~800MB extra memory. Acceptable for a lint tool.
- Workers are NOT pooled across daemon requests. The daemon uses serial analysis for warm paths (see daemon section below).

---

## `packages/lsp/src/cli/lint-worker.ts` (NEW)

```typescript
import { parentPort, workerData } from "node:worker_threads";
import ts from "typescript";
import { createSolidInput, buildSolidGraph, runSolidRules, createOverrideEmit } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { WorkerTask, WorkerResult } from "./worker-pool";

const port = parentPort;
if (!port) {
  throw new Error("lint-worker must be run as a worker_threads Worker");
}

port.on("message", (task: WorkerTask) => {
  const results = runLintTask(task);
  port.postMessage(results);
});

function runLintTask(task: WorkerTask): readonly WorkerResult[] {
  const configFile = ts.readConfigFile(task.tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    task.rootPath,
  );
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  const checker = program.getTypeChecker();

  const results: WorkerResult[] = [];

  for (let i = 0, len = task.files.length; i < len; i++) {
    const path = task.files[i];
    if (!path) continue;
    const key = canonicalPath(path);
    if (classifyFile(key) === "css") continue;

    const sourceFile = program.getSourceFile(key);
    if (!sourceFile) continue;

    const input = createSolidInput(key, program);
    const graph = buildSolidGraph(input);

    const diagnostics: Diagnostic[] = [];
    const emit = (d: Diagnostic) => diagnostics.push(d);
    runSolidRules(graph, sourceFile, emit);

    results.push({ file: key, diagnostics });
  }

  return results;
}
```

Each worker:
1. Receives `{ tsconfigPath, files, rootPath }`
2. Builds its own `ts.Program` from the tsconfig (resolves all files, but only analyzes its chunk)
3. For each assigned file: `createSolidInput` → `buildSolidGraph` → `runSolidRules`
4. Returns `WorkerResult[]` via `postMessage`

The `ts.createProgram` cost (~3-8s cold) runs concurrently across all workers. With Phase 4's `.tsbuildinfo`, this drops to ~200ms per worker.

Note: `runSolidRules` takes `(graph, sourceFile, emit)` — this is the Phase 1 post-migration signature. The worker does NOT apply rule severity overrides. Overrides are applied by the main thread when collecting results (see lint.ts changes below). This avoids serializing the `RuleOverrides` object to each worker and keeps the worker code minimal.

**Correction**: The worker MUST apply rule overrides. Without overrides, suppressed rules still emit diagnostics that the main thread would need to filter — but the main thread has no way to distinguish "rule emitted but should be off" from "rule emitted at warn". Pass `overrides` as part of `WorkerTask` and apply `createOverrideEmit` in the worker.

Updated `WorkerTask`:

```typescript
export interface WorkerTask {
  readonly tsconfigPath: string
  readonly files: readonly string[]
  readonly rootPath: string
  readonly overrides: Record<string, string>
}
```

Updated worker `emit`:

```typescript
const hasOverrides = Object.keys(task.overrides).length > 0;
const rawEmit = (d: Diagnostic) => diagnostics.push(d);
const emit = hasOverrides ? createOverrideEmit(rawEmit, task.overrides) : rawEmit;
runSolidRules(graph, sourceFile, emit);
```

---

## `packages/lsp/src/cli/lint.ts` changes

The serial per-file loop (lines 519-555) is replaced with worker dispatch when `filesToLint.length > WORKER_THRESHOLD`.

### New imports

```typescript
import { createWorkerPool, defaultWorkerCount, type WorkerResult } from "./worker-pool";
```

### tsconfig resolution

After Phase 1, `lint.ts` creates a `BatchTypeScriptService` from `projectRoot`. The tsconfig path is needed by workers. Extract it:

```typescript
const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
if (!tsconfigPath) {
  die(`No tsconfig.json found in ${projectRoot}`);
}
```

### File partitioning

```typescript
const WORKER_THRESHOLD = 20;

function partitionFiles(files: readonly string[], count: number): string[][] {
  const chunks: string[][] = Array.from({ length: count }, () => []);
  const solidFiles: string[] = [];
  for (let i = 0, len = files.length; i < len; i++) {
    const f = files[i];
    if (!f) continue;
    if (classifyFile(canonicalPath(f)) !== "css") {
      solidFiles.push(f);
    }
  }
  for (let i = 0; i < solidFiles.length; i++) {
    const f = solidFiles[i];
    if (!f) continue;
    const chunk = chunks[i % count];
    if (!chunk) continue;
    chunk.push(f);
  }
  return chunks.filter((c) => c.length > 0);
}
```

Round-robin partitioning. No attempt at load-balancing by file size — file analysis cost is dominated by graph building (~5-13ms), which is roughly constant per file. Round-robin gives even distribution.

**Note on ESLint ignores**: The `filesToLint` array that feeds into `partitionFiles` is computed after ESLint config resolution and global ignore application on the main thread. Workers receive only pre-filtered file paths and do not need to load or evaluate ESLint ignore patterns.

### Main analysis block replacement

Current (lines 509-555):

```typescript
const cache = new GraphCache(log);
const t0 = performance.now();
// ... warmProgram + serial loop
```

Post-Phase 2:

```typescript
const t0 = performance.now();
const allDiagnostics: Diagnostic[] = [];
let serialBatch: BatchTypeScriptService | undefined;

const solidFilesToLint = filesToLint.filter(
  (f) => classifyFile(canonicalPath(f)) !== "css"
);

if (solidFilesToLint.length > WORKER_THRESHOLD) {
  // Parallel path — workers are in-process thread parallelism, unrelated to the daemon.
  // The daemon path (see daemon.ts) handles !noDaemon separately by delegating to the daemon process.
  const workerCount = defaultWorkerCount();
  const chunks = partitionFiles(solidFilesToLint, workerCount);
  const pool = createWorkerPool(workerCount);

  // Note: filesToLint (which feeds solidFilesToLint and partitionFiles) is computed AFTER
  // ESLint config is loaded and global ignores are applied. Workers do not need separate
  // ignore handling because the file list is pre-filtered by the main thread.
  if (log.enabled) log.info(`dispatching ${solidFilesToLint.length} files to ${chunks.length} workers`);

  try {
    const tasks = chunks.map((files) => ({
      tsconfigPath,
      files,
      rootPath: projectRoot,
      overrides: eslintResult.overrides,
    }));

    const workerResults = await pool.dispatch(tasks);

    for (let i = 0, len = workerResults.length; i < len; i++) {
      const wr = workerResults[i];
      if (!wr) continue;
      for (let j = 0, dLen = wr.diagnostics.length; j < dLen; j++) {
        const d = wr.diagnostics[j];
        if (!d) continue;
        allDiagnostics.push(d);
      }
    }
  } finally {
    await pool.terminate();
  }
} else {
  // Serial path (few files)
  serialBatch = createBatchProgram(projectRoot);
  const batch = serialBatch;
  const { program } = batch;

  try {
    for (let i = 0, len = solidFilesToLint.length; i < len; i++) {
      const path = solidFilesToLint[i];
      if (!path) continue;
      const key = canonicalPath(path);
      const sourceFile = program.getSourceFile(key);
      if (!sourceFile) {
        if (log.enabled) log.trace(`lint: skipping ${key} (not in program)`);
        continue;
      }

      const input = createSolidInput(key, program, log);
      const graph = buildSolidGraph(input);

      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(graph, sourceFile, emit);

      for (let j = 0, dLen = results.length; j < dLen; j++) {
        const result = results[j];
        if (!result) continue;
        allDiagnostics.push(result);
      }
    }
  } finally {
    batch.dispose();
  }
}
```

The serial path uses `createBatchProgram` (from Phase 1). The parallel path spawns workers that each build their own program.

### Cross-file analysis

Cross-file analysis runs on the main thread AFTER single-file diagnostics are collected from workers. The main thread builds its own `ts.Program` for the cross-file pass.

Post-Phase 1, the cross-file pass needs a `GraphCache` with `SolidGraph` for each file. Workers don't populate this cache (they can't — `SolidGraph` contains `ts.Node` references from the worker's program, not the main thread's).

For cross-file analysis, the main thread must rebuild graphs. With Phase 1's zero-parse architecture, this is ~5-13ms per file × 230 files = ~1.2-3s. This is the cost of full-program cross-file analysis regardless of workers.

```typescript
if (options.crossFile) {
  const batch = serialBatch ?? createBatchProgram(projectRoot);
  const ownsBatch = serialBatch === undefined;
  const cache = new GraphCache(log);

  for (const solidPath of fileIndex.solidFiles) {
    const key = canonicalPath(solidPath);
    const sourceFile = batch.program.getSourceFile(key);
    if (!sourceFile) continue;
    const input = createSolidInput(key, batch.program, log);
    const graph = buildSolidGraph(input);
    const version = `hash:${createHash("sha256").update(sourceFile.text).digest("hex").slice(0, 16)}`;
    cache.setSolidGraph(key, version, graph);
  }

  const allCSSFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
  // ... rest of cross-file analysis identical to current code
  // but using batch.program instead of project.getProgram()

  if (ownsBatch) batch.dispose();
}
```

`serialBatch` is set when the serial path was taken (reuse the already-built program). When the parallel path was taken, a new batch program is built for cross-file analysis.

### Timing note

The cross-file graph rebuild on the main thread could overlap with worker execution. But workers use the main thread's event loop for `Promise` resolution, and `ts.createProgram` is synchronous. Two approaches:

1. **Sequential**: Workers finish → main thread builds program + cross-file. Total = max(workers) + cross-file.
2. **Overlapping**: Main thread starts building its program concurrently while workers run. Workers are in separate threads, so the main thread's synchronous `ts.createProgram` doesn't block them.

Approach 2 is free because `ts.createProgram` runs synchronously on the main thread while workers run in parallel threads. The main thread should start building its program immediately after dispatching workers:

```typescript
// Dispatch workers
const workerPromise = pool.dispatch(tasks);

// Main thread: build its own program for cross-file analysis concurrently
const batch = createBatchProgram(projectRoot);

// Await workers
const workerResults = await workerPromise;

// Now run cross-file analysis using main-thread program
```

This overlaps the main thread's `ts.createProgram` (~3-8s cold, ~200ms with Phase 4) with worker execution.

---

## `packages/lsp/src/cli/daemon.ts` changes

The daemon does NOT use workers. Rationale:

1. The daemon keeps a warm `ts.Program` (via `IncrementalTypeScriptService` post-Phase 1). On warm paths, only changed files need re-analysis. Typical incremental lint: 1-5 files changed. Worker dispatch overhead (spawn + program build per worker) exceeds serial analysis time for small file counts.

2. The daemon serializes lint requests (via `state.pending` chain). Workers would add complexity to the serialization model without benefit — the dominant cost on warm paths is the `ts.Program` incremental update (~50-200ms), not per-file analysis.

3. For cold daemon starts (first request), the pre-warm phase already builds the program. The first lint request pays ~1-3s for 230-file serial analysis. Workers would save ~0.5-1s at the cost of 4× memory.

The daemon continues using serial analysis with `GraphCache`. No changes needed for Phase 2.

---

## `packages/lsp/tsup.config.ts` changes

The worker file must be bundled as a separate entry point:

```typescript
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
  },
  {
    entry: ["src/cli/entry.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/cli/lint-worker.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
  },
]);
```

The worker script is `dist/lint-worker.js`. The `WORKER_SCRIPT` constant in `worker-pool.ts` resolves to this path via `resolve(__dirname, "lint-worker.js")`.

---

## CLI flag: `--max-workers`

Add to `LintOptions`:

```typescript
readonly maxWorkers: number
```

Parse in `parseLintArgs`:

```typescript
if (arg === "--max-workers") {
  const next = args[i + 1];
  const parsed = Number(next);
  if (!Number.isInteger(parsed) || parsed < 1) {
    die(`--max-workers requires a positive integer. Got: ${next ?? "(missing)"}`);
  }
  maxWorkers = parsed;
  i++;
  continue;
}
```

Default: `defaultWorkerCount()`. Used in the parallel path:

```typescript
const workerCount = options.maxWorkers ?? defaultWorkerCount();
```

Add to help text in `entry.ts`:

```
  --max-workers <n>        Max parallel workers for lint (default: auto)
```

---

## Memory safety

Each worker builds a full `ts.Program` (~200MB for 230 files). With 4 workers: ~800MB extra. Node.js default heap is ~4GB on 64-bit. For projects with >500 files, memory pressure increases. The `--max-workers 1` flag forces serial execution as an escape hatch.

Workers do not share any mutable state. Each worker's `ts.Program`, `SolidGraph`, and `Diagnostic[]` are entirely local. No `SharedArrayBuffer`, no `Atomics`, no locks.

---

## Error handling

If a worker crashes (OOM, uncaught exception), the `Worker` emits an `"error"` event. The pool's `onError` handler rejects the pending job's promise. The main thread catches the rejection, reports the error, and falls back to serial analysis for the remaining files.

```typescript
try {
  const workerResults = await pool.dispatch(tasks);
  // ... collect diagnostics
} catch (err) {
  if (log.enabled) log.warning(`worker error: ${err instanceof Error ? err.message : String(err)}, falling back to serial`);
  // Serial fallback for all files
  // ... serial analysis identical to the serial path above
} finally {
  await pool.terminate();
}
```

This is NOT a "degraded execution path" — the serial path produces identical output. It's a resilience mechanism for worker infrastructure failures (OOM, missing worker script, etc.), not a "typeless" or "skip rules" fallback.

---

## Verification

1. **Correctness**: `ganko lint` on target project (`/home/skill/p/bor-web/web`). Diff output against Phase 1 baseline. Zero diagnostic regressions.
2. **Parallelism**: `ganko lint --log-level debug` — verify `dispatching N files to M workers` in log output.
3. **Timing**: Measure wall-clock time with `--no-daemon`. Expect 1.5-3s vs 6-10s serial (Phase 1 baseline).
4. **Determinism**: Run 5 times. `ganko lint --format json | sha256sum` identical each run.
5. **Serial fallback**: `ganko lint --max-workers 1` — produces identical output, no worker log messages.
6. **Memory**: `ganko lint --max-workers 4` with `--log-level trace` — check no OOM on target project.
