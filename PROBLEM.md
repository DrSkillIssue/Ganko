# Ganko Performance Problem Statement

## TS Service vs TS Program: The Answer

Use `ts.Program` directly. Drop `@typescript-eslint/project-service` entirely.

Here's why:

### What `@typescript-eslint/project-service` Actually Is

It wraps `ts.server.ProjectService` — the same infrastructure VS Code's editor uses to provide IntelliSense. It was designed for interactive editor scenarios: open a file, get completions, open another file, get hover info. It tracks open/close state, schedules deferred work via 250ms timers, reassigns files between projects, and maintains an internal watcher stub.

Ganko is not an editor. Ganko is a batch analyzer that happens to also run as an LSP. You're fighting the abstraction:

- `openClientFile` / `closeClientFile` lifecycle per file (`project-service.ts:122-126`, `daemon.ts:235-258`)
- Deferred timer tracking and teardown (`project-service.ts:88-101`)
- `warmProgram` sentinel hack to pre-build the program (`project-service.ts:164-171`)
- `getCachedProgramForFile` falling through `warmSeed` (`project-service.ts:140-149`)
- The daemon syncing every solid file into the service via `openClientFile` before linting

All of this ceremony exists because `ProjectService` was never designed for "give me a `ts.Program` for 230 files as fast as possible." It was designed for "a user opened `App.tsx`, give them IntelliSense."

### What `ts.Program` Directly Gives You

`ts.createProgram` (or `ts.createIncrementalProgram` with a `BuilderProgram`) takes a `tsconfig.json`, resolves the file graph, and builds the program **once**. No open/close lifecycle. No deferred timers. No sentinel warmup. No per-file `openClientFile`. One call, one program, all source files available immediately.

For the CLI/daemon path, this is strictly better. For the LSP path, you need incremental updates — but `ts.createWatchProgram` or `ts.createIncrementalProgram` with a custom `CompilerHost` handles that without the `ProjectService` abstraction layer.

---

## The Sky-Is-The-Limit Architecture

### Current Architecture (What's Wrong)

```
CLI lint request
  → createFileIndex (scan disk)
  → readCSSFilesFromDisk (all CSS)
  → resolveTailwindValidator
  → scanDependencyCustomProperties
  → warmProgram (sentinel openClientFile)
  → for each file: getProgram → parseForESLint → buildSolidGraph → runSolidRules (SERIAL)
  → runAllCrossFileDiagnostics (rebuild all graphs again for cross-file)
```

Everything is serial, everything blocks on everything else being ready, and `parseForESLint` with `programs: [program]` does heavy work per file (ESTree↔TSNode mapping, scope analysis, `simpleTraverse`).

### Target Architecture

```
Phase 0: ts.createProgram (single call, ~3-8s → cached/incremental ~50ms)
Phase 1: Parallel file processing via worker_threads
  Worker pool → each worker: parseForESLint + buildSolidGraph + runSolidRules
Phase 2: Cross-file analysis (main thread, uses collected graphs)
Phase 3: CSS/Tailwind/Layout (parallel with Phase 1 where possible)
```

### Concrete Changes

#### 1. Replace `@typescript-eslint/project-service` with Direct `ts.Program`

**CLI/Daemon path**: Use `ts.createProgram` with a `CompilerHost` that reads from the tsconfig. One call builds the full program. Pass it to each file's `parseContentWithProgram`. No `openClientFile`, no sentinel warmup, no timer management.

**LSP path**: Use `ts.createWatchCompilerHost` + `ts.createWatchProgram` for incremental updates. On `didChangeContent`, call `updateRootFileText` on the host. The watch program incrementally re-checks only affected files. This replaces the entire `project-service.ts` module.

**For the LSP's non-linting features** (hover, definition, completion): Build a `ts.LanguageService` from the same `CompilerHost` + a `LanguageServiceHost`. This is lightweight — the `LanguageService` uses the same underlying `Program`. No `ProjectService` middleman.

#### 2. Parallelize File Processing with `worker_threads`

The dominant serial cost is the per-file loop (`lint.ts:519`): parse → graph → rules × 230 files.

Each file's analysis is independent (single-file rules don't cross file boundaries). This is embarrassingly parallel.

Architecture:

- Main thread: build `ts.Program`, extract `SourceFile` text for each file
- Worker pool (N = `os.availableParallelism()`): each worker receives `{ path, content, hasProgram }` and runs `parseForESLint` + `buildSolidGraph` + `runSolidRules`
- Workers return `{ diagnostics, serializedGraph }` back to main thread

**The catch**: `ts.Program` is not transferable across workers. Workers would either:

- **(a)** Run without type info (parse via `parseContent`, no `programs` option). This covers ~95% of rules. Type-aware rules (`show-truthy-conversion`, `avoid-object-spread`, `avoid-object-assign`, wiring phase type assertions) degrade gracefully — `typeResolver.hasTypeInfo()` returns false and they skip.
- **(b)** Each worker builds its own `ts.Program` from the same tsconfig. Memory-heavy but correct. With `ts.createIncrementalProgram` and a shared file cache, this can be amortized.
- **(c)** Run parse in workers, type resolution on main thread as an enrichment pass. Workers return partially-built graphs, main thread fills in type-dependent entities.

**Recommendation**: Option (a) for CLI cold path (fast, correct for vast majority of rules), option (c) for daemon/LSP warm path where the Program already exists.

#### 3. Decouple LSP Initial Diagnostics from Workspace Warmup

Current `handleInitialized` (`lifecycle.ts:151`) does:

1. Load ESLint config
2. Build file index
3. Read all CSS, resolve Tailwind, scan dependencies
4. Create project (with ProjectService)
5. Schedule TS warmup

All before `resolveReady()`. The editor is blocked.

New model:

1. `handleInitialized`: create file index, `resolveReady()` **immediately**
2. On `didOpen`: run file-local diagnostics (no type info, no cross-file). Return in <100ms.
3. Background: build `ts.Program`, resolve Tailwind, scan dependencies
4. When background completes: re-diagnose open files with type info + cross-file results
5. On subsequent `didChange`: incremental — only re-parse changed file, merge cached cross-file

#### 4. Persistent On-Disk Cache for Cold Start

The daemon already persists warm state in memory. Take this further:

- **Cache the serialized `ts.Program` builder state** (`ts.createIncrementalProgram` with `ts.readBuilderProgram`). This is what `tsc --incremental` does with `.tsbuildinfo` files. Cold start goes from "build program from scratch" to "load cached program state + validate".
- **Cache serialized SolidGraphs** to disk. If file content hash matches, skip parse entirely.
- **Cache `parseForESLint` output** (AST + scope manager). The ESTree parse is pure — same input always produces same output. Hash the content, cache the result.

#### 5. Skip `simpleTraverse` in Parse

`parseContent` and `parseContentWithProgram` both call `simpleTraverse(result.ast, { enter: () => { } }, true)` (`parse.ts:75`, `parse.ts:123`). This walks the entire AST with an empty callback. It exists only to set parent pointers on nodes. If the graph-building phases already handle parent resolution (which they do — `runPreparePhase` validates parent links), this traversal is redundant work on every file.

#### 6. Separate CLI Batch Engine from LSP Engine

The librarian's analysis nailed it: CLI whole-project lint and LSP initial diagnostics should not share the same latency model.

- **CLI path**: `ts.createProgram` → worker pool → collect results → cross-file → exit. Optimized for throughput.
- **LSP path**: lazy `ts.createWatchProgram` → file-local first → background enrichment. Optimized for latency to first useful answer.
- **Daemon path**: persistent `ts.Program` in memory → incremental updates → cached graphs. Optimized for repeated invocation throughput.

### Expected Performance Impact

| Change | Estimated Impact |
|--------|-----------------|
| Direct `ts.Program` instead of ProjectService | -2-4s (eliminates open/close ceremony, deferred timers, warmup sentinel) |
| Worker pool parallelism (8 cores) | 4-6x speedup on parse+graph+rules (the serial loop) |
| Skip `simpleTraverse` | -200-400ms (230 files × ~1-2ms each) |
| LSP: file-local first, background warmup | First diagnostics in <100ms instead of 13s |
| Persistent `.tsbuildinfo` cache | Cold → warm in ~200ms instead of 3-8s |
| Parse cache (content hash → ESTree) | Skip parse entirely for unchanged files |

**Conservative estimate for CLI cold lint of 230 files**: 44s → 4-6s.
**Warm daemon lint**: ~1-2s → sub-second.
**LSP first diagnostics**: 13s → <100ms (file-local), full results background in 3-5s.

---

### Implementation Order

1. **Replace ProjectService with direct `ts.Program`** — highest ROI, touches `project-service.ts`, `project.ts`
2. **Remove `simpleTraverse` no-op** — trivial, immediate gain
3. **Parallelize file processing** — `worker_threads` pool in `lint.ts` and `daemon.ts`
4. **Decouple LSP init from workspace warmup** — `lifecycle.ts`, `connection.ts`
5. **Persistent `.tsbuildinfo` cache** — `CompilerHost` with `readFile`/`writeFile` for builder state
6. **Parse result cache** — content hash → serialized ESTree+scopes
