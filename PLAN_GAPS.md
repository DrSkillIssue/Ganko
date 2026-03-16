Now I have a comprehensive understanding of all the source code and plan documents. Let me produce the gap analysis.

---

## Complete Gap Analysis: PHASE_1–6 Implementation Gaps

Below are all gaps NOT already in PLAN_GAPS.md, including new gaps introduced by the PHASE documents themselves, cross-phase contradictions, incorrect API assumptions, and missing details.

---

### P1-G1 — `emitOnlyDtsFiles` parameter does NOT write `.tsbuildinfo`

**Phase**: 4
**Severity**: Critical
**File(s)**: `packages/lsp/src/core/batch-program.ts` (new)
**What the plan says**: PHASE_4.md line 82-89: `builderProgram.emit(undefined, writeFile, undefined, true)` with comment "emitOnlyDtsFiles — we only want .tsbuildinfo, not actual .js/.d.ts". PLAN.md line 244 repeats this claim.
**What's actually wrong**: `ts.BuilderProgram.emit()` with `emitOnlyDtsFiles=true` emits only `.d.ts` files, NOT `.tsbuildinfo`. The `.tsbuildinfo` file is written by the `emit()` call regardless of `emitOnlyDtsFiles`, BUT only when `noEmit` is NOT set. PHASE_4.md line 61 sets `noEmit: true`. When `noEmit: true` is set, `emit()` is a no-op — it writes NOTHING, including `.tsbuildinfo`. The correct approach is either: (a) remove `noEmit` from options and set `emitOnlyDtsFiles: true` (writes `.d.ts` + `.tsbuildinfo`), or (b) use `ts.emitBuilderProgram()` manually, or (c) set `noEmit: false, declaration: false, emitDeclarationOnly: false` and use a custom `writeFile` that filters to only write the `.tsbuildinfo` file. The plan's approach will silently produce no `.tsbuildinfo` file.
**What needs to happen**: Remove `noEmit: true` from the incremental options. Use `declaration: false` to avoid `.d.ts` output. Confirm `emit()` with the custom `writeFile` callback only receives `.tsbuildinfo`. Test by checking the file exists after `saveBuildInfo()`.

---

### P1-G2 — `createWatchProgram` is synchronous, NOT background-async

**Phase**: 3
**Severity**: Critical
**File(s)**: `packages/lsp/src/server/handlers/lifecycle.ts`, `packages/lsp/src/core/incremental-program.ts` (new)
**What the plan says**: PHASE_3.md line 282-345 restructures `handleInitialized` so that `resolveReady()` fires BEFORE the watch program builds. Line 319-323: "Phase B: Wait for watch program to be ready (background)... await project.watchProgramReady()". The tier model assumes `createWatchProgram` runs asynchronously in the background.
**What's actually wrong**: `ts.createWatchProgram(host)` is a synchronous call. It blocks the Node.js event loop while building the initial program (3-8s). The `afterProgramCreate` callback fires synchronously during `createWatchProgram()`. There is no "background" build — calling `createWatchProgram` in `handleInitialized` blocks the entire function for 3-8s regardless. The `readyPromise` described in PHASE_3.md line 441-464 would resolve synchronously before `createWatchProgram` returns, making `await project.watchProgramReady()` a no-op. The Tier 1 → Tier 2 progression described in PHASE_3.md cannot work as designed.
**What needs to happen**: Either: (a) Run `createWatchProgram` on a worker thread or via `setImmediate` chunks. (b) Use `createIncrementalProgram` in a separate microtask after `resolveReady()` fires. (c) Restructure so that `resolveReady()` fires immediately, then `setImmediate(() => createWatchProgram(...))` gives the event loop a chance to process pending `didOpen` requests before blocking. Option (c) is simplest but still blocks for 3-8s after the first event loop tick.

---

### P1-G3 — Phase 3 `publishTier1Diagnostics` creates per-file `ts.createProgram` — O(N) cost per open file

**Phase**: 3
**Severity**: High
**File(s)**: `packages/lsp/src/server/connection.ts`, `packages/lsp/src/core/tier1-program.ts` (new)
**What the plan says**: PHASE_3.md line 64-105 creates a new `ts.createProgram` for each `didOpen` event during Tier 1. Cost claimed: "~50-100ms dominated by lib.d.ts parsing on first call, cached by TS internally thereafter."
**What's actually wrong**: TypeScript's lib.d.ts parsing is cached within a single `CompilerHost` instance, NOT globally. Each call to `createTier1Program` creates a new `defaultHost = ts.createCompilerHost(options)`. Each new host has its own source file cache. On each `didOpen` (if the user opens 5 files before the full program is ready), the first file pays ~100ms, but files 2-5 ALSO pay ~50-100ms each because lib.d.ts is re-parsed for each new host. The total Tier 1 cost for 5 files is ~250-500ms, not ~150ms.
**What needs to happen**: Cache the `defaultHost` across Tier 1 calls in `ServerContext`. Create one `ts.createCompilerHost` during initialization and reuse it for all Tier 1 programs. The `getSourceFile` override per file can be layered on top.

---

### P1-G4 — Worker pool non-null assertions violate AGENTS.md rules

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/worker-pool.ts` (new), `packages/lsp/src/cli/lint-worker.ts` (new)
**What the plan says**: PHASE_2.md line 79: `const worker = idle.pop()!;` and `const job = queue.shift()!;`. Line 148: `parentPort!.postMessage(results);`.
**What's actually wrong**: AGENTS.md explicitly states: "No non-null assertion operator (`!`)". The worker pool code uses `!` in three places. Additionally, `chunks[i % count]!.push(f)` at PHASE_2.md line 260 is another violation.
**What needs to happen**: Replace all `!` assertions with proper narrowing. For `idle.pop()`, check the `while` condition guarantees it's non-empty and extract to a variable with a guard. For `parentPort`, check at module load (already done at line 143-145) and assign to a `const`.

---

### P1-G5 — `SolidPlugin.analyze` decision left open — contradicts AGENTS.md

**Phase**: 1
**Severity**: High
**File(s)**: `packages/ganko/src/solid/plugin.ts`, `packages/ganko/src/graph.ts`, `packages/ganko/src/runner.ts`
**What the plan says**: PHASE_1.md line 421-428: "**Decision required.** If (1): ... If (2): ..." — presents two options without choosing.
**What's actually wrong**: AGENTS.md says "Do not present mutually exclusive architecture decisions as 'A or B' unless the user explicitly asks for options. Choose one best architecture and execute decisively." The decision on `SolidPlugin.analyze` and `Plugin.analyze` is left open, which blocks implementation of Phase 1. Current code shows `project.run([key])` is called in `runSingleFileDiagnostics` (analyze.ts:119) and by the daemon (via `Runner`). If `SolidPlugin.analyze` is removed, `project.run()` breaks for Solid files.
**What needs to happen**: Choose option (1): `Plugin.analyze(files, emit, context?: { program: ts.Program })`. This preserves the Runner/Plugin architecture. `CSSPlugin.analyze` and `CrossFilePlugin.analyze` ignore the context parameter. `SolidPlugin.analyze` uses `context.program` to get `SourceFile` instances.

---

### P1-G6 — `runSingleFileDiagnostics` in analyze.ts calls `project.run()` — not migrated

**Phase**: 1
**Severity**: High
**File(s)**: `packages/lsp/src/core/analyze.ts:107-141`
**What the plan says**: PHASE_1.md line 700-707 says analyze.ts removes parse imports and uses `createSolidInput`. Does not mention `runSingleFileDiagnostics`.
**What's actually wrong**: `runSingleFileDiagnostics` (analyze.ts:107-141) has THREE code paths: (a) `project.run([key])` at line 119 for disk-based files, (b) `analyzeInput(parseWithOptionalProgram(...), emit)` at line 128 for in-memory solid files, (c) `project.run([key])` at line 138 as fallback. Paths (a) and (c) call `Runner.run()` which calls `SolidPlugin.analyze()` which calls `parseFile()` (deleted). Path (b) calls `analyzeInput` which calls `createSuppressionEmit(input.sourceCode, ...)` (migrated). None of these are migrated in PHASE_1.md. This is a critical LSP diagnostic path — every `publishFileDiagnostics` call goes through here.
**What needs to happen**: `runSingleFileDiagnostics` must be fully rewritten. The `project.run()` path needs the program. The `analyzeInput` path must use `createSolidInput` instead of `parseWithOptionalProgram`. Add this function to the Phase 1 migration file list.

---

### P1-G7 — `buildSolidGraphForPath` in analyze.ts calls `parseFile` (deleted)

**Phase**: 1
**Severity**: High
**File(s)**: `packages/lsp/src/core/analyze.ts:84-93`
**What the plan says**: PHASE_1.md line 700-707 says `parseContent` and `parseContentWithProgram` imports are removed. Does not mention `parseFile` in this function.
**What's actually wrong**: `buildSolidGraphForPath` at line 91 calls `parseFile(path, logger)` as a fallback when no program/sourceFile is available. `parseFile` is deleted in Phase 1. This is the cross-file graph builder used by `rebuildGraphsAndRunCrossFileRules` and `getSolidGraph` in `connection.ts:171`. It will throw at runtime.
**What needs to happen**: Replace with `createSolidInput(path, program)` where program is obtained from the project. The fallback case (no program, no sourceFile) should throw an error rather than silently degrade.

---

### P1-G8 — `eslint-config.ts` runtime import of ESLint — not addressed

**Phase**: 6
**Severity**: High
**File(s)**: `packages/lsp/src/core/eslint-config.ts`
**What the plan says**: PHASE_6.md line 92-93: "@typescript-eslint/parser — Used by eslint-config.ts to load ESLint config — verify. If loadESLintConfig uses ESLint's calculateConfigArray which needs the parser registered, keep it." PHASE_6.md line 182-184: "eslint — only needed if eslint-config.ts uses the ESLint API. If it does, keep `eslint` in BUNDLED_DEPS."
**What's actually wrong**: Reading eslint-config.ts reveals it uses custom Zod parsing of the flat config export, NOT ESLint's `calculateConfigArray`. It does `import()` of the config file directly (line 30 area). It does NOT import from `eslint` or `@typescript-eslint/parser` at runtime. However, PHASE_6.md leaves both decisions as "verify" — unresolved at implementation time.
**What needs to happen**: Confirm: `@typescript-eslint/parser` can be removed from LSP dependencies. `eslint` can be removed from `BUNDLED_DEPS`. Make this explicit in the plan, not conditional.

---

### P1-G9 — Phase 2 worker pool: `onError` handler pushes crashed worker back to idle pool

**Phase**: 2
**Severity**: High
**File(s)**: `packages/lsp/src/cli/worker-pool.ts` (new)
**What the plan says**: PHASE_2.md line 93-98: On worker error, `idle.push(worker)` puts the crashed worker back in the idle pool.
**What's actually wrong**: When a `Worker` emits an `"error"` event, the worker process may be in a broken state (especially for OOM). Pushing it back to `idle` means it will be reused for the next job — which may crash immediately again. Node.js `Worker` stays alive after unhandled errors (unlike `"exit"` events), but its internal state is unreliable.
**What needs to happen**: On error, destroy the worker (`worker.terminate()`) and either: (a) create a replacement worker and push that to idle, or (b) do not push to idle and let the pool degrade gracefully (fewer workers). Option (a) is more resilient.

---

### P1-G10 — Phase 2 worker: `!options.noDaemon` condition is inverted

**Phase**: 2
**Severity**: High
**File(s)**: `packages/lsp/src/cli/lint.ts`
**What the plan says**: PHASE_2.md line 288: `if (solidFilesToLint.length > WORKER_THRESHOLD && !options.noDaemon)` enables the parallel path when NOT using `--no-daemon`.
**What's actually wrong**: `--no-daemon` means "run analysis in-process" (bypassing the daemon). Workers are an in-process parallelization strategy. The condition should be the opposite — workers should be used when `noDaemon` IS true (because we're running in-process). When `noDaemon` is false, the code tries the daemon first (line 458-464 in current lint.ts). If the daemon is unavailable, it falls through to in-process analysis. The condition should likely be `solidFilesToLint.length > WORKER_THRESHOLD` regardless of `noDaemon`, or `!options.noDaemon` should be removed from the condition entirely since workers are an optimization of the in-process path.
**What needs to happen**: Remove `&& !options.noDaemon` from the condition. Workers are for in-process execution. The daemon path (line 458-464) already handles the `!noDaemon` case by delegating to the daemon process.

---

### P1-G11 — Phase 3 Tier 1: `createSolidInput` requires `ts.Program` but Tier 1 creates a standalone program — type resolution divergence undocumented

**Phase**: 3
**Severity**: Medium
**File(s)**: `packages/lsp/src/core/tier1-program.ts` (new)
**What the plan says**: PHASE_3.md line 559-568: "Types from other project files are NOT available — the Tier 1 TypeChecker resolves imported symbols to `any` when the exporting file isn't in the program."
**What's actually wrong**: It's worse than "resolves to `any`". When a Solid file imports a type from another project file (e.g., `import type { MyStore } from "./store"`), the TypeChecker may not resolve it to `any` — it may resolve it to `ts.Type` with `flags === TypeFlags.Unknown` or fail entirely, depending on `moduleResolution` settings. This can cause wiring phase type assertions (which are now unconditional per PLAN.md) to produce false positives. For example, `show-truthy-conversion` checks if a value is `boolean | Signal<boolean>` — with an unknown import type, the check may incorrectly warn.
**What needs to happen**: During Tier 1, type-aware rules that depend on cross-module type resolution should be documented as potentially inaccurate. The Tier 1 program should set `compilerOptions.noResolve = false` (already the default) and document that only `node_modules` types are reliable in Tier 1.

---

### P1-G12 — Phase 2: Worker does not receive ESLint global ignores — files may be linted that should be ignored

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/lint-worker.ts` (new), `packages/lsp/src/cli/lint.ts`
**What the plan says**: PHASE_2.md line 199-208 adds `overrides` to `WorkerTask` but does NOT add ESLint global ignores. Line 164-168: worker classifies files by `classifyFile(key)` to skip CSS.
**What's actually wrong**: The current `lint.ts` (line 443-445) applies `effectiveExclude` which merges ESLint global ignores before `filesToLint` is computed. However, PHASE_2.md's `partitionFiles` (line 247-263) works on `solidFilesToLint` which is derived from `filesToLint`. If `filesToLint` already has ESLint ignores applied, this is fine. But if not — for example, if workers receive the full `fileIndex.solidFiles` — then ignored files would be linted. The plan must explicitly confirm that `filesToLint` (after ignore filtering) is what feeds into `partitionFiles`, not the raw file index.
**What needs to happen**: Confirm the data flow: `filesToLint` is computed AFTER ESLint config is loaded and global ignores are applied (which it is in the current code). Document this explicitly in the worker dispatch flow.

---

### P1-G13 — Phase 5: `runSolidRules(graph, sourceFile, emit)` on cached graph — `graph.sourceFile` is stale

**Phase**: 5
**Severity**: High
**File(s)**: `packages/lsp/src/cli/daemon.ts`
**What the plan says**: PHASE_5.md line 97-104: Cache-hit path passes `program.getSourceFile(key)` as `sourceFile` to `runSolidRules`. Line 111: "Passes the CURRENT sourceFile — rules that compute locations use the current file's positions."
**What's actually wrong**: `runSolidRules(graph, sourceFile, emit)` calls `createSuppressionEmit(sourceFile, emit)` which extracts comments from `sourceFile`. But the graph was built with the OLD sourceFile. Rules call `createDiagnostic(file, node, graph.sourceFile, ...)` where `graph.sourceFile` is the OLD sourceFile from when the graph was built. If the current `sourceFile` and `graph.sourceFile` are different objects (different program rebuilds but same content), `graph.sourceFile.getLineAndCharacterOfPosition()` still works (same text). BUT if any rule calls `node.getText(graph.sourceFile)` where `node` is from the old program and `graph.sourceFile` is also from the old program, it works. The issue arises when the rules mix `graph.sourceFile` (old) with the `sourceFile` argument (new/current). The `createSuppressionEmit` uses the passed-in `sourceFile` while rules use `graph.sourceFile` — these are different objects for the same content, which is fine for text operations but confusing architecturally.
**What needs to happen**: Either: (a) make rules use the sourceFile passed to `runSolidRules` instead of `graph.sourceFile`, or (b) document that `graph.sourceFile` and the `sourceFile` argument may be different object references but contain identical text. Option (a) is cleaner but requires refactoring rule signatures.

---

### P1-G14 — Phase 2: Cross-file analysis `serialBatch` variable used but never defined in worker path

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/lint.ts`
**What the plan says**: PHASE_2.md line 364: `const batch = serialBatch ?? createBatchProgram(projectRoot);`. Line 385: "`serialBatch` is set when the serial path was taken."
**What's actually wrong**: In the worker path (PHASE_2.md line 280-316), `serialBatch` is never defined. The variable is only defined in the serial path. The worker path code at line 364 references `serialBatch` which would be `undefined`. The code then creates a new `BatchTypeScriptService`, which works, but this isn't clean code — `serialBatch` either needs to be declared before the `if/else` block, or the cross-file section needs to handle both paths explicitly.
**What needs to happen**: Declare `let serialBatch: BatchTypeScriptService | undefined` before the `if/else` block. Set it in the serial path. The cross-file section uses `serialBatch ?? createBatchProgram(projectRoot)`.

---

### P1-G15 — Phase 3: `ServerContext` interface changes not backward-compatible with existing handlers

**Phase**: 3
**Severity**: Medium
**File(s)**: `packages/lsp/src/server/connection.ts`
**What the plan says**: PHASE_3.md line 143-157 adds `cachedCompilerOptions`, `watchProgramReady`, `workspaceReady` to `ServerContext`.
**What's actually wrong**: The current `ServerContext` interface (connection.ts:290-367) does NOT use `exactOptionalPropertyTypes: true` from the root tsconfig for these new fields. PHASE_3.md line 163 initializes `cachedCompilerOptions: null` — but with `exactOptionalPropertyTypes: true`, a field typed `ts.CompilerOptions | null` and initialized as `null` must be declared with `| null` explicitly (which it is, at line 150). However, `watchProgramReady` and `workspaceReady` at lines 153-156 are `boolean` initialized to `false`. These must be added to the interface declaration. The plan only shows the interface extension but not the full integration — `setProject`, `evictFileCache`, and other methods need to be aware of the new fields.
**What needs to happen**: Add all three fields to the `ServerContext` interface definition. Verify `exactOptionalPropertyTypes` compliance.

---

### P1-G16 — Phase 4: Multiple workers reading `.tsbuildinfo` concurrently while main thread writes — TOCTOU

**Phase**: 4
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/lint-worker.ts` (new), `packages/lsp/src/core/batch-program.ts` (new)
**What the plan says**: PHASE_4.md line 215-217: "Workers READ .tsbuildinfo but do NOT write it... All workers read the same .tsbuildinfo file. Since reads are concurrent and the file is immutable during the lint run, this is safe."
**What's actually wrong**: PHASE_2.md line 396-407 describes overlapping execution: main thread starts building its own program (which reads .tsbuildinfo) CONCURRENTLY with workers that ALSO read .tsbuildinfo. But if the PREVIOUS lint run saved .tsbuildinfo during `batch.saveBuildInfo()`, the file exists. The current run's main thread reads it — fine. Workers read it — fine. BUT if the current run finishes and calls `saveBuildInfo()` while workers from a DIFFERENT concurrent lint invocation are reading, there's a TOCTOU issue. Since `ganko lint` is typically not invoked concurrently, this is unlikely but possible (e.g., CI running parallel lint commands).
**What needs to happen**: Use atomic write (write to temp, rename) for `.tsbuildinfo`. TypeScript's `ts.sys.writeFile` doesn't do this. The custom `writeFile` callback in `saveBuildInfo` should write to a temp file and rename.

---

### P1-G17 — Phase 1: `createTestProgram` with `skipLibCheck: true` won't catch type errors in test fixtures

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/ganko/test/solid/test-utils.ts`
**What the plan says**: PHASE_1.md line 812: "`skipLibCheck: true` avoids resolving full lib chain."
**What's actually wrong**: `skipLibCheck` skips checking `.d.ts` files, not loading them. `ts.createProgram` still resolves and parses lib.d.ts — `skipLibCheck` only skips semantic diagnostics on declaration files. The performance benefit is in type-checking time, not program creation time. More importantly, some type-aware rules depend on correctly resolved types from `solid-js` declarations. `skipLibCheck` doesn't help with creation cost; `skipDefaultLibCheck` might help slightly. The claimed "~10-50ms" per test program needs verification.
**What needs to happen**: Benchmark `createTestProgram` with a single virtual file. If >50ms, consider sharing a single program across tests within a test file (adding virtual files to a shared CompilerHost). The `skipLibCheck` claim about performance should be verified.

---

### P1-G18 — Phase 3: `enrichWorkspace` accesses `state.rootPath!` with non-null assertion

**Phase**: 3
**Severity**: Low
**File(s)**: `packages/lsp/src/server/handlers/lifecycle.ts` (proposed changes)
**What the plan says**: PHASE_3.md line 355: `const rootPath = state.rootPath!;`
**What's actually wrong**: AGENTS.md prohibits `!`. The caller (restructured `handleInitialized`, line 292) already checks `if (!state.rootPath || !context)`, so `rootPath` is guaranteed non-null inside the `if` block. But `enrichWorkspace` is a separate function that doesn't carry the narrowing.
**What needs to happen**: Pass `rootPath: string` as a parameter to `enrichWorkspace` instead of accessing `state.rootPath!`.

---

### P1-G19 — Phase 1: `createHandlerContext` in connection.ts passes `astCache` — but astCache is eliminated

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/lsp/src/server/connection.ts:110-174`
**What the plan says**: PHASE_1.md line 732: "CachedAST interface eliminated. ts.SourceFile cached by the program." Line 736-737: "AST cache invalidation removed."
**What's actually wrong**: `createHandlerContext` (connection.ts:110) accepts `astCache: Map<string, CachedAST>` as a parameter. The `astCache` map is declared at line 441 and passed at line 468. After eliminating `CachedAST`, the `astCache` parameter must be removed from `createHandlerContext`, the map deleted from `createServer`, and all references in `evictFileCache` (line 488) and `rediagnoseAll` (line 515) removed. PHASE_1.md mentions `CachedAST` elimination and AST cache invalidation removal but doesn't list all the wiring sites in `createServer` and `ServerContext`.
**What needs to happen**: Remove `astCache` variable from `createServer`, remove parameter from `createHandlerContext`, remove `astCache.delete(key)` from `evictFileCache`, remove `astCache.clear()` from `rediagnoseAll`.

---

### P1-G20 — Phase 2: `createOverrideEmit` imported from `@drskillissue/ganko` — not currently exported

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/lint-worker.ts` (new)
**What the plan says**: PHASE_2.md line 138: `import { createSolidInput, buildSolidGraph, runSolidRules, createOverrideEmit } from "@drskillissue/ganko";`
**What's actually wrong**: Checking `packages/ganko/src/index.ts`, line 18 shows `export { createRunner, createOverrideEmit } from "./runner"`. So `createOverrideEmit` IS exported. However, `createSolidInput` is NOT yet exported (it's created in Phase 1). PHASE_1.md line 630 says to add `export { createSolidInput } from "./solid"`. This works if Phase 1 is fully complete. But verify the export exists in the `solid/index.ts` barrel file too.
**What needs to happen**: Verify the export chain: `solid/create-input.ts` → `solid/index.ts` → `index.ts` → `@drskillissue/ganko`. The `solid/index.ts` barrel file must re-export `createSolidInput`.

---

### P1-G21 — Phase 5: `contentHash` duplicated in 4+ files instead of shared utility

**Phase**: 5
**Severity**: Low
**File(s)**: `packages/lsp/src/cli/lint.ts`, `packages/lsp/src/cli/daemon.ts`, `packages/lsp/src/core/analyze.ts`, `packages/lsp/src/server/connection.ts`
**What the plan says**: PHASE_5.md line 232-244 creates `packages/shared/src/content-hash.ts` and exports from shared index.
**What's actually wrong**: PHASE_5.md defines `contentHash` in section headings for lint.ts, daemon.ts, and analyze.ts as inline functions BEFORE mentioning the shared utility at line 232. This suggests the inline versions would be written first and then refactored. The plan should specify the shared utility FIRST and have all consumers import from `@drskillissue/ganko-shared`.
**What needs to happen**: Minor editorial fix — implement the shared utility first, then import everywhere. No duplicate function definitions.

---

### P1-G22 — Phase 3: `handleInitialized` restructuring loses ESLint config for Tier 1

**Phase**: 3
**Severity**: High
**File(s)**: `packages/lsp/src/server/handlers/lifecycle.ts`
**What the plan says**: PHASE_3.md line 286-345: Restructured `handleInitialized` calls `resolveReady()` immediately after creating the project. ESLint config loading happens in `enrichWorkspace` (Phase C, line 334-336).
**What's actually wrong**: Tier 1 diagnostics run immediately on `didOpen` (before enrichWorkspace). Without ESLint config, rule overrides are empty — all rules run at their default severity. If the user has `"missing-jsdoc-comments": "off"` in their ESLint config, Tier 1 will show those diagnostics (at default severity "warn"), then Tier 3 will suppress them. This causes diagnostic flicker: diagnostics appear, then disappear seconds later. The current code loads ESLint config BEFORE `resolveReady()` (lifecycle.ts:160-168).
**What needs to happen**: Move ESLint config loading to Phase A (before `resolveReady()`). ESLint config loading is ~50-200ms — fast enough to not significantly delay Tier 1. Apply overrides to both Tier 1 diagnostics and the project.

---

### P1-G23 — Phase 2: Worker result diagnostic `Diagnostic.fix.range` contains absolute positions — but no source file to validate against

**Phase**: 2
**Severity**: Low
**File(s)**: `packages/lsp/src/cli/lint-worker.ts` (new)
**What the plan says**: PHASE_2.md line 10-23 describes `Diagnostic` as fully serializable. Line 26: "No ts.Node references. No ts.SourceFile references. Fully structuredClone-able."
**What's actually wrong**: `Diagnostic.fix` contains `range: readonly [number, number]` (character offsets into the source file). These positions are correct because they're computed from the worker's `ts.SourceFile`. However, if the main thread applies fixes (e.g., `--fix` mode), it reads the file from disk. If the file changed between when the worker read it and when the fix is applied, positions are wrong. This is a general fix-application race condition not specific to workers, but workers exacerbate it because the program build time is longer.
**What needs to happen**: If `--fix` mode is ever added, fixes must validate file content hash matches before applying. For now, diagnostic output only — no action needed, but document the constraint.

---

### P1-G24 — Phase 1 + Phase 3: `Project` interface gains `watchProgramReady()` but CLI lint creates `Project` too

**Phase**: 1, 3
**Severity**: Medium
**File(s)**: `packages/lsp/src/core/project.ts`
**What the plan says**: PHASE_3.md line 396-421 adds `watchProgramReady(): Promise<void>` to the `Project` interface. CLI path returns `Promise.resolve()`.
**What's actually wrong**: The `Project` interface is shared between CLI, daemon, and LSP paths (see project.ts:26-59). Adding `watchProgramReady()` to the interface means CLI code that creates a `Project` via `createProject` must also implement it. `createProject` currently creates a `TypeScriptProjectService` (line 74) which doesn't have this method. After Phase 1, it creates either `BatchTypeScriptService` or `IncrementalTypeScriptService`. The `createProject` factory needs to know which service type to create based on context (CLI vs LSP). This bifurcation is implicit in the plan but not explicitly designed.
**What needs to happen**: Add a `mode: "batch" | "incremental"` parameter to `ProjectConfig` or create separate factory functions: `createBatchProject()` for CLI/daemon and `createIncrementalProject()` for LSP.

---

### P1-G25 — Phase 1: Daemon still calls `project.warmProgram`, `project.openFiles`, `project.closeFile` — all marked for removal

**Phase**: 1
**Severity**: High
**File(s)**: `packages/lsp/src/cli/daemon.ts:224-231`, `packages/lsp/src/cli/daemon.ts:262-269`, `packages/lsp/src/cli/daemon.ts:448-462`, `packages/lsp/src/cli/daemon.ts:639-643`
**What the plan says**: PLAN.md line 30: "The Project interface drops warmProgram, getScriptVersion, openFiles, closeFile."
**What's actually wrong**: The daemon code extensively uses all four methods: `project.warmProgram` (lines 228, 643), `project.openFiles()` (lines 263, 452), `project.closeFile` (lines 265, 456), `project.getScriptVersion` (lines 367-368). The pre-warm code at line 643 does `project.warmProgram(sentinel, readFileSync(sentinel, "utf-8"))`. PHASE_1.md line 720 says daemon changes are "Same as lint.ts" but doesn't address the extensive daemon-specific lifecycle management (file open/close tracking, pre-warm, serialization chain).
**What needs to happen**: Daemon migration must: (a) Remove `warmProgram` calls — replaced by the program already being built in `createBatchProgram`/`createIncrementalProgram`. (b) Remove `openFiles`/`closeFile` lifecycle — no longer needed without ProjectService. The daemon's file tracking at lines 448-462 (closing stale files) is eliminated. (c) Remove `getScriptVersion` — replaced by `contentHash`. (d) Rewrite `prewarmDaemon` to create the TypeScript service directly. This is a significant rewrite of daemon.ts, not "Same as lint.ts".

---

### P1-G26 — Phase 5: Cached graph `runSolidRules` re-runs rules even when rules haven't changed

**Phase**: 5
**Severity**: Low
**File(s)**: `packages/lsp/src/cli/daemon.ts`
**What the plan says**: PHASE_5.md line 109: "Still runs runSolidRules (rules may have changed between runs)."
**What's actually wrong**: This is correct for correctness but suboptimal. Between daemon requests, rules don't change (they're compiled into the binary). Rule OVERRIDES may change (ESLint config reload). But if overrides haven't changed AND the graph is cached, re-running all rules produces identical diagnostics. The daemon could cache `(contentHash, overridesHash) → Diagnostic[]` to skip rule execution entirely.
**What needs to happen**: Low priority optimization. Document as a future improvement in Phase 5. The current design is correct but not maximally efficient for the daemon warm path.

---

### P1-G27 — Phase 6: `@typescript-eslint/scope-manager` is NOT in ganko `package.json` but IS in BUNDLED_DEPS

**Phase**: 6
**Severity**: Low
**File(s)**: `packages/ganko/package.json`, `packages/lsp/tsup.config.ts`
**What the plan says**: PHASE_6.md line 148-151 lists `@typescript-eslint/scope-manager` in `BUNDLED_DEPS` to remove.
**What's actually wrong**: `@typescript-eslint/scope-manager` is NOT listed in `packages/ganko/package.json` (line 79-88). It IS in `packages/lsp/tsup.config.ts` BUNDLED_DEPS (line 12). It's a transitive dependency of `@typescript-eslint/parser`. Removing it from BUNDLED_DEPS is correct, but PHASE_6.md line 33 says to remove `@typescript-eslint/scope-manager` from ganko's `package.json` — it's not there. Minor inaccuracy but could cause confusion.
**What needs to happen**: Remove the reference to ganko's package.json for scope-manager. Only the `tsup.config.ts` BUNDLED_DEPS entry needs removal.

---

### P1-G28 — Phase 1: `graph.ts` `Plugin` interface `analyze()` — `CrossFilePlugin` calls `runCrossFileRules` which needs `LayoutGraph`

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/ganko/src/cross-file/plugin.ts`
**What the plan says**: PHASE_1.md line 462-464 mentions `Plugin.analyze` may take program context.
**What's actually wrong**: `CrossFilePlugin.analyze` (cross-file/plugin.ts) needs `SolidGraph[]`, `CSSGraph`, and `LayoutGraph` — none of which come from a `ts.Program`. The `CrossFilePlugin` is fundamentally different from `SolidPlugin` — it doesn't process individual files; it processes the cross-file graph ensemble. Adding `context?: { program: ts.Program }` to `Plugin.analyze` doesn't help `CrossFilePlugin`. If `SolidPlugin.analyze` changes to require a program, `CrossFilePlugin.analyze` remains unchanged (it builds its own graphs). But `CrossFilePlugin.analyze` currently calls `buildSolidGraph(parseFile(file))` which uses the deleted `parseFile`. This means CrossFilePlugin ALSO needs migration.
**What needs to happen**: Verify `CrossFilePlugin.analyze` internals. If it calls `parseFile`, it must be migrated to use `createSolidInput` with a program. This may require passing a `ts.Program` to `CrossFilePlugin.analyze` or restructuring cross-file analysis to not go through the `Plugin` interface.

---

### P1-G29 — Phase 3: `getOpenDocumentPaths` used at line 327 but not imported in lifecycle.ts restructured code

**Phase**: 3
**Severity**: Low
**File(s)**: `packages/lsp/src/server/handlers/lifecycle.ts`
**What the plan says**: PHASE_3.md line 327: `const openPaths = getOpenDocumentPaths(context.documentState);`
**What's actually wrong**: `getOpenDocumentPaths` is imported in `connection.ts` (line 87) but not currently imported in `lifecycle.ts`. The restructured `handleInitialized` in PHASE_3.md uses it directly. This requires adding the import.
**What needs to happen**: Add `import { getOpenDocumentPaths } from "./document"` to lifecycle.ts.

---

### P1-G30 — Phase 2: tsup worker entry point may not resolve `@drskillissue/ganko` correctly

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/tsup.config.ts`, `packages/lsp/src/cli/lint-worker.ts` (new)
**What the plan says**: PHASE_2.md line 457-467 adds a third tsup entry for the worker script. Line 460-466 uses the same `BUNDLED_DEPS` including `@drskillissue/ganko`.
**What's actually wrong**: The worker script imports from `@drskillissue/ganko` which is a workspace package. `tsup` resolves this via `noExternal: [...BUNDLED_DEPS]` which inlines the package into the bundle. This means the worker bundle (`dist/lint-worker.js`) contains a FULL copy of `@drskillissue/ganko` AND `typescript`. The main entry (`dist/entry.js`) also contains these. Loading both in the same process (main thread + worker) means TypeScript's module-level singleton state (caches, parser) is duplicated, which is correct (workers have isolated V8 contexts) but increases total disk and memory usage. The estimated "~200MB per worker" may undercount because it excludes the bundled JS parse cost.
**What needs to happen**: Consider making the worker import from the same bundle via a shared chunk, or accept the duplication as necessary. At minimum, measure the actual worker bundle size and adjust memory estimates.

---

### P1-G31 — Phase 1: `no-innerhtml.ts` has runtime `ASTUtils` import — PHASE_6 catches it but PHASE_1 doesn't migrate it

**Phase**: 1, 6
**Severity**: High
**File(s)**: `packages/ganko/src/solid/rules/jsx/no-innerhtml.ts:23`
**What the plan says**: PHASE_6.md line 212-218 identifies this runtime import. Says "This is Phase 1's responsibility, not Phase 6's."
**What's actually wrong**: PHASE_1.md line 560-575 describes rule migration patterns (`import type { TSESTree as T }` → `import type ts`) but only addresses TYPE imports. The runtime import `import { ASTUtils } from "@typescript-eslint/utils"` at no-innerhtml.ts:23 is a VALUE import (not `import type`). If Phase 1 migrates all type imports but misses this runtime import, `tsc` will pass (it's a valid import as long as the package is installed) but Phase 6's dependency removal will break at runtime.
**What needs to happen**: Add `no-innerhtml.ts` to the Phase 1 migration list with an explicit note: "Replace `ASTUtils.isIdentifier()` with `ts.isIdentifier()`. This is a runtime import, not type-only."

---

### P1-G32 — Phase 3: `publishTier1Diagnostics` accesses `context.diagCache` and `context.documentState` — may not exist during Tier 1

**Phase**: 3
**Severity**: Low
**File(s)**: `packages/lsp/src/server/connection.ts`
**What the plan says**: PHASE_3.md line 261: `context.diagCache.set(path, diagnostics);`. Line 265-268: accesses `context.documentState.pathIndex` and `context.documentState.openDocuments`.
**What's actually wrong**: `diagCache` and `documentState` are initialized in `createServer` (connection.ts:454-455), which runs before any lifecycle handlers. They exist during Tier 1. No issue. However, `context.serverState.rootPath` (used at line 230) may be null if `handleInitialize` hasn't been called yet. In practice, `didOpen` comes after `initialize` + `initialized`, so `rootPath` should be set. But the code should guard against it.
**What needs to happen**: Add a null check for `context.serverState.rootPath` at the start of `publishTier1Diagnostics`.

---

### P1-G33 — Phase 4: `.tsbuildinfo` file locking on Windows

**Phase**: 4
**Severity**: Low
**File(s)**: `packages/lsp/src/core/batch-program.ts` (new)
**What the plan says**: PHASE_4.md does not mention Windows file locking.
**What's actually wrong**: On Windows, if the daemon is running and reads `.tsbuildinfo`, and the CLI simultaneously tries to write it, the write may fail with `EBUSY` or `EACCES`. Windows locks files during read operations more aggressively than Unix. The daemon doesn't write `.tsbuildinfo` (PHASE_4.md line 174), but the CLI and workers read it concurrently.
**What needs to happen**: The `saveBuildInfo` write callback should catch write errors and log a warning instead of crashing. Missing `.tsbuildinfo` on the next cold start is acceptable.

---

### P1-G34 — Phase 1: `analyzeInput` export from `index.ts` — signature change cascade

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/ganko/src/index.ts`, `packages/ganko/src/solid/plugin.ts`
**What the plan says**: PHASE_1.md line 411-413 migrates `analyzeInput` to use `input.sourceFile` instead of `input.sourceCode`.
**What's actually wrong**: `analyzeInput` is exported from `index.ts` (checking via grep: exported at line 25 area). It's used by `runSingleFileDiagnostics` in analyze.ts:128. After migration, `analyzeInput` takes `SolidInput` with `sourceFile` instead of `sourceCode`. The `createSuppressionEmit(input.sourceCode, emit)` becomes `createSuppressionEmit(input.sourceFile, emit)`. But `runSingleFileDiagnostics` at analyze.ts:128 calls `analyzeInput(parseWithOptionalProgram(key, content, program, log), emit)` — after migration, it calls `analyzeInput(createSolidInput(key, program), emit)`. This requires `program` to be non-null (since `createSolidInput` requires a program). Currently, `runSingleFileDiagnostics` accepts `program: null` and falls through to `parseContent` (no program). After migration, the null-program path must throw or create a minimal program.
**What needs to happen**: In `runSingleFileDiagnostics`, when program is null and kind is "solid", either: (a) throw an error (the program should always be available), or (b) create a single-file program. The plan should explicitly state which.

---

### P1-G35 — Cross-phase: Phase 4 `.tsbuildinfo` location vs Phase 2 worker reads — workers need `rootPath` to find cache

**Phase**: 2, 4
**Severity**: Low
**File(s)**: `packages/lsp/src/cli/lint-worker.ts` (new)
**What the plan says**: PHASE_4.md line 191: `const cacheDir = resolve(task.rootPath, "node_modules/.cache/ganko");` in the worker.
**What's actually wrong**: Workers receive `rootPath` via `WorkerTask` (PHASE_2.md line 45-47). The `.tsbuildinfo` path is `resolve(rootPath, "node_modules/.cache/ganko/.tsbuildinfo")`. This works, but the worker must construct the exact same path as the main thread's `createBatchProgram`. If the main thread uses `dirname(tsconfigPath)` for the tsconfig base directory but `rootPath` for the cache directory, and `tsconfigPath` is in a subdirectory (monorepo), the resolved paths may differ.
**What needs to happen**: Ensure both main thread and workers compute the cache path from the same base. Use `rootPath` consistently, not `dirname(tsconfigPath)`.

---

### P1-G36 — Phase 3: `publishFileDiagnostics` function called from Tier 2 re-diagnosis — but it runs cross-file analysis too

**Phase**: 3
**Severity**: Medium
**File(s)**: `packages/lsp/src/server/handlers/lifecycle.ts`, `packages/lsp/src/server/connection.ts`
**What the plan says**: PHASE_3.md line 327-332: Tier 2 re-diagnosis calls `publishFileDiagnostics(context, project, p)`.
**What's actually wrong**: `publishFileDiagnostics` (connection.ts:970-1013) runs cross-file analysis when `includeCrossFile` defaults to `true`. At Tier 2 (line 332), the workspace is NOT yet enriched (no file index, no Tailwind, no cross-file data). `publishFileDiagnostics` will call `runCrossFileDiagnostics` which needs `context.fileIndex` — which is `null` at Tier 2. The code at connection.ts:986 checks `if (includeCrossFile && context.fileIndex && context.project)` — `context.fileIndex` is null, so cross-file is skipped. This is accidentally correct but fragile.
**What needs to happen**: Tier 2 re-diagnosis should explicitly pass `includeCrossFile = false`. Or restructure `publishFileDiagnostics` to only include cross-file when `context.workspaceReady` is true.

---

### P1-G37 — Phase 1: `missing-jsdoc-comments` and `no-banner-comments` use `getSourceCode(graph).getAllComments()` — needs two separate migrations

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/ganko/src/solid/rules/correctness/no-banner-comments.ts:115`, `packages/ganko/src/solid/rules/correctness/no-ai-slop-comments.ts:135`
**What the plan says**: PHASE_1.md line 568-569: "`sourceCode.getAllComments()` → `graph.comments`."
**What's actually wrong**: These rules call `getSourceCode(graph).getAllComments()` which returns ESTree `Comment[]`. After migration, they use `graph.comments` which returns `CommentEntry[]`. The `Comment` type has fields `{ type, value, loc, range }` while `CommentEntry` has `{ pos, end, value, line, endLine, kind }`. Rules iterating comments access `comment.value` (same), `comment.loc.start.line` (becomes `comment.line`), `comment.loc.end.line` (becomes `comment.endLine`), and `comment.range` (becomes `[comment.pos, comment.end]`). The `missing-jsdoc-comments` rule at line 259 does `const sourceCode = getSourceCode(graph)` and uses `sourceCode.getNodeByRangeIndex()` — this method doesn't exist on `ts.SourceFile`.
**What needs to happen**: Replace `sourceCode.getNodeByRangeIndex()` usage in `missing-jsdoc-comments` with positional lookup via `graph.positionIndex` or `ts.getTokenAtPosition(sourceFile, pos)`. This is a rule-specific migration not covered by the general patterns in PHASE_1.md.

---

### P1-G38 — Phase 2: `WORKER_SCRIPT` path resolution assumes bundled layout

**Phase**: 2
**Severity**: Medium
**File(s)**: `packages/lsp/src/cli/worker-pool.ts` (new)
**What the plan says**: PHASE_2.md line 55: `const WORKER_SCRIPT = resolve(__dirname, "lint-worker.js");`
**What's actually wrong**: During development (`bun run dev`), `__dirname` points to the source directory (`src/cli/`), not the `dist/` directory. `lint-worker.js` only exists in `dist/` after building. Running tests or dev mode will fail to find the worker script. The resolution path works only in production (after tsup bundles everything to `dist/`).
**What needs to happen**: Use `new URL("./lint-worker.js", import.meta.url)` for ESM-compatible resolution, or detect environment and use appropriate path. Since the LSP is CJS (`"type": "commonjs"` in package.json), `__dirname` works after bundling. But add a file-existence check with a clear error message: `if (!existsSync(WORKER_SCRIPT)) throw new Error(...)`.

---

### P1-G39 — Phase 5: `graph.sourceFile` identity assumption — same content hash does NOT mean `sourceFile.text === oldSourceFile.text` across programs with different options

**Phase**: 5
**Severity**: Low
**File(s)**: `packages/ganko/src/cache.ts`
**What the plan says**: PHASE_5.md line 29: "When file content is identical (same hash), the ts.Node tree structure is identical."
**What's actually wrong**: `ts.SourceFile` AST structure depends on `compilerOptions` (specifically `jsx`, `target`, `scriptTarget`). If two programs use different compiler options (e.g., Tier 1 program vs full program in the LSP), the ASTs may differ slightly even for identical content. Content hash matches but the graph built with one set of options may not be valid for another. This is only relevant for the LSP Tier 1→Tier 2 transition.
**What needs to happen**: The LSP should NOT cache Tier 1 graphs in the main `GraphCache`. Tier 1 diagnostics should be cached separately and discarded when Tier 2 arrives. This is already the implicit behavior (Tier 2 re-publishes), but the graph cache should not hold Tier 1 graphs.

---

### P1-G40 — Phase 1: `packages/ganko/src/solid/phases/scopes.ts` complete rewrite — but no implementation specification

**Phase**: 1
**Severity**: High
**File(s)**: `packages/ganko/src/solid/phases/scopes.ts`
**What the plan says**: PHASE_1.md line 484-488: "Complete rewrite per REVIEW.md §6. Single-pass ts.forEachChild walk with checker.getSymbolAtLocation."
**What's actually wrong**: PHASE_1.md defers the scopes rewrite entirely to "REVIEW.md §6" without specifying the implementation. REVIEW.md is not included in the reading list and its content is only referenced. The scopes phase is the most complex phase — it builds `ScopeEntity`, `VariableEntity`, tracks reads/writes, and maintains the scope chain. The current implementation uses ESLint's `ScopeManager` which provides pre-computed scope analysis. Replacing it with manual `ts.Symbol` resolution is a major effort. Key questions unanswered: How are block scopes detected? How are hoisted `var` declarations handled? How are `catch` clause variables scoped? How are destructuring patterns handled for variable declarations?
**What needs to happen**: Include the full scopes phase rewrite specification in PHASE_1.md. Cover: (a) scope boundary detection (function, block, class, module), (b) variable declaration extraction from all forms (var, let, const, function, class, import, parameter, catch), (c) read/write reference classification using `ts.Symbol`, (d) hoisting rules for `var` and function declarations, (e) destructuring pattern traversal.

---

### P1-G41 — Phase 1: Test helper `createTestProgram` doesn't handle JSX pragmas or module aliases

**Phase**: 1
**Severity**: Medium
**File(s)**: `packages/ganko/test/solid/test-utils.ts`
**What the plan says**: PHASE_1.md line 795-809 shows `createTestProgram` with `jsx: ts.JsxEmit.Preserve` and `moduleResolution: ts.ModuleResolutionKind.Bundler`.
**What's actually wrong**: Many tests likely use `import { createSignal } from "solid-js"`. With `ModuleResolutionKind.Bundler` and no `paths` config, the TypeChecker resolves `solid-js` from `node_modules` (if accessible from the test runner's CWD). But if tests run from a different directory or in CI where `node_modules` is structured differently, `solid-js` may not resolve. The current `parseContent` doesn't need `solid-js` because it uses ESLint's parser without type info. After migration, tests that exercise type-aware rules REQUIRE `solid-js` declarations to be resolvable.
**What needs to happen**: Set `compilerOptions.baseUrl` and `compilerOptions.paths` in `createTestProgram` to point at the workspace's `node_modules/solid-js`. Or set `typeRoots` to include the correct `node_modules/@types` path. Test this by running the full test suite from a clean checkout.

---

This completes the gap enumeration. Below is a summary by severity:

| Severity | Count | Key Items |
|----------|-------|-----------|
| **Critical** | 2 | P1-G1 (`.tsbuildinfo` not written), P1-G2 (`createWatchProgram` is sync) |
| **High** | 12 | P1-G3 (CompilerHost caching), P1-G5 (undecided Plugin.analyze), P1-G6 (runSingleFileDiagnostics), P1-G7 (parseFile deleted), P1-G8 (eslint-config.ts), P1-G9 (worker error handling), P1-G10 (inverted condition), P1-G13 (stale sourceFile), P1-G22 (ESLint config timing), P1-G25 (daemon methods removed), P1-G31 (runtime ASTUtils import), P1-G40 (scopes rewrite unspecified) |
| **Medium** | 18 | P1-G4, P1-G11, P1-G12, P1-G14, P1-G15, P1-G17, P1-G19, P1-G20, P1-G24, P1-G28, P1-G30, P1-G34, P1-G35, P1-G36, P1-G37, P1-G38, P1-G39, P1-G41 |
| **Low** | 9 | P1-G16, P1-G18, P1-G21, P1-G23, P1-G26, P1-G27, P1-G29, P1-G32, P1-G33 |

**Total: 41 new gaps** (none duplicating PLAN_GAPS.md's 47).