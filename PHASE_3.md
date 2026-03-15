# Phase 3: Parallelize File Processing with `worker_threads`

**Estimated Impact**: 4-6x speedup on parse+graph+rules (the serial loop)
**Files touched**: new `worker-pool.ts`, new `lint-worker.ts`, `lint.ts`, `daemon.ts`
**Risk**: Medium (serialization boundaries, error handling, deterministic output ordering)
**Depends on**: Phase 1 (direct `ts.Program`)

## Problem

The per-file analysis loop is serial (`lint.ts:519`):

```
for each file:
  getProgram → parseForESLint → buildSolidGraph → runSolidRules
```

Each file's single-file analysis is **completely independent** — no shared mutable state, no cross-file data flow. This is embarrassingly parallel. On an 8-core machine, the serial loop wastes 7 cores.

## Architecture

### Main Thread Responsibilities

1. Build `ts.Program` (Phase 1 — one call)
2. Extract `{ path, content }` pairs for each file from the program's source files
3. Dispatch work to worker pool
4. Collect `{ path, diagnostics, serializedGraph }` results
5. Run cross-file analysis on collected graphs (main thread — needs all graphs)

### Worker Thread Responsibilities

Each worker receives `{ path, content }` and:
1. Calls `parseForESLint(content, ...)` — no `programs` option (no type info in workers)
2. Calls `buildSolidGraph(input)`
3. Calls `runSolidRules(graph, input.sourceCode, emit)`
4. Returns `{ path, diagnostics, serializedGraph }` via `parentPort.postMessage`

### Type Info Strategy

`ts.Program` cannot be transferred to worker threads (it contains closures, caches, host references). Three options:

| Option | Description | Tradeoffs |
|--------|-------------|-----------|
| **(a) No type info in workers** | Workers use `parseContent` (no `programs`). ~95% of rules work. Type-aware rules (`show-truthy-conversion`, `avoid-object-spread`, `avoid-object-assign`, wiring type assertions) skip gracefully via `typeResolver.hasTypeInfo() → false`. | Fast, simple. ~5% of rules degrade to no-op. |
| **(b) Per-worker Program** | Each worker builds its own `ts.Program` from the same tsconfig. | Correct but memory-heavy (N copies of program). |
| **(c) Hybrid** | Workers parse + build graphs without types. Main thread does a type-enrichment pass on graphs using the single `ts.Program`. | Best of both — parallelism + full type coverage. More complex. |

**Decision**: Start with **(a)** for CLI cold path. Implement **(c)** as a follow-up for the daemon/LSP warm path where the Program already exists and type-enrichment is cheap.

For the daemon warm path (where program exists in memory), the main thread can still run the serial loop with full type info — the daemon's advantage is cached state, not parallelism.

### Worker Pool Design

```typescript
interface WorkerPool {
  /** Analyze files in parallel, return results in input order */
  analyzeFiles(
    files: readonly { path: string; content: string }[],
    overrides: RuleOverrides,
  ): Promise<readonly FileResult[]>

  /** Shut down all workers */
  dispose(): void
}

interface FileResult {
  readonly path: string
  readonly diagnostics: readonly Diagnostic[]
  /** Serialized SolidGraph for cross-file cache population */
  readonly graphData: SerializedSolidGraph | null
}
```

Pool size: `Math.max(1, os.availableParallelism() - 1)` (leave one core for main thread + cross-file).

### Serialization Boundary

Workers communicate via `postMessage` which uses structured clone. `Diagnostic` objects are plain data (strings, numbers, locations) — transferable without issue. `SolidGraph` instances contain methods and circular references (entity back-pointers to graph) — these must be serialized to a transfer-friendly format.

Options for graph transfer:
- Serialize only the data needed for cross-file rules (entity arrays without methods)
- Rebuild `SolidGraph` on main thread from serialized entity data
- Skip graph transfer entirely — rebuild from cached parse results on main thread for cross-file

**Decision**: Skip graph transfer for Phase 3. Workers return diagnostics only. For cross-file analysis, the main thread runs a second (serial) pass building graphs with type info. The GraphCache ensures this second pass is amortized on warm runs.

## New Files

### `packages/lsp/src/core/worker-pool.ts`

Worker pool manager:
- Spawns N `lint-worker.ts` workers
- Round-robin or chunk-based work distribution
- Collects results, maintains input ordering
- Handles worker crashes (restart + retry)
- Graceful shutdown

### `packages/lsp/src/core/lint-worker.ts`

Worker entry point:
- Receives `{ path, content, overrides }` messages
- Runs `parseContent` → `buildSolidGraph` → `runSolidRules`
- Posts `{ path, diagnostics }` back

## Changes to Existing Files

### `lint.ts`

Replace the serial loop (lines 519-555) with:
```
1. Extract { path, content } from ts.Program source files
2. workerPool.analyzeFiles(files, overrides) → single-file diagnostics
3. If crossFile: rebuild graphs on main thread (with type info), run cross-file rules
```

### `daemon.ts`

For cold daemon requests (project recreated): use worker pool.
For warm daemon requests (cached state): keep serial loop with full type info (faster than worker overhead for small change sets).

## Verification

- `bun run test` — all tests pass (tests run in-process, not in workers)
- `ganko lint` on bor-web/web — identical diagnostic output (order may differ, content must match)
- Measure wall-clock time: expect 4-6x improvement on the serial loop portion
- Verify worker crash recovery: kill -9 a worker mid-lint, should recover
- Verify memory: N workers × parse memory overhead is acceptable
