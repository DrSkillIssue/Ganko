## Phased Implementation Plan: ganko ESTree → TypeScript Native AST Migration + High-Performance Linting Architecture

### 1. Decision

**Six phases**, each independently valuable, building toward the target of **4-6s CLI cold lint** (from 44s), **sub-second daemon warm lint**, and **<100ms LSP first diagnostics**. The ESTree→TS AST migration (REVIEW.md) is the foundation. The existing PHASE_1-6.md documents are superseded — their content is reorganized below with REVIEW.md as the architectural core, not a separate phase.

**Effort**: `XL` (4-6 weeks calendar time for a single developer working full-time)

---

### 2. Implementation Plan

## Phase 1: Direct `ts.Program` + SDK AST Migration (Foundation)

**Effort**: `XL` — 8-12 days  
**Independent value**: Eliminates 8.4-17.5s of the 44s cold lint. Per-file cost drops from 21-41ms to 5-13ms.  
**Unlocks**: Phases 2-6 (all require `ts.Node` API surface and direct `ts.Program`)

This phase performs two logically atomic changes simultaneously. They cannot be separated: replacing `ProjectService` with `ts.Program` changes how `SourceFile` instances are obtained, and REVIEW.md's `SolidInput` requires `ts.SourceFile` directly (not via `parseForESLint`). Doing one without the other creates an intermediate state with two parse paths that must both be maintained.

#### What changes:

**A. Replace `@typescript-eslint/project-service` with direct `ts.Program` (LSP: `packages/lsp/src/`)**

| File | Change |
|------|--------|
| `core/project-service.ts` | **Deleted.** Replaced by two new modules. |
| `core/batch-program.ts` | **New.** CLI/daemon path: `ts.createProgram` from tsconfig. Single call, all files immediately available. Interface: `{ program, checker, getSourceFileText, dispose }`. |
| `core/incremental-program.ts` | **New.** LSP path: `ts.createWatchCompilerHost` + `ts.createWatchProgram`. Custom `CompilerHost` with in-memory overlay for unsaved buffers. Interface: `{ getProgram(), getLanguageService(), updateFile(), dispose() }`. |
| `core/project.ts` | Rewired: `TypeScriptProjectService` → `BatchTypeScriptService` or `IncrementalTypeScriptService`. The `Project` interface drops `warmProgram`, `getScriptVersion`, `openFiles`, `closeFile`. Gains `getProgram(): ts.Program`. |
| `core/analyze.ts` | `parseWithOptionalProgram` → `createSolidInput`. `buildSolidGraphForPath` uses `program.getSourceFile()` directly. `parseContent`, `parseContentWithProgram`, `parseFile` imports removed. |
| `cli/lint.ts` | Instantiates `BatchTypeScriptService`. The per-file loop becomes: `program.getSourceFile(path)` → `createSolidInput` → `buildSolidGraph` → `runSolidRules`. No `warmProgram`, no `openClientFile`. |
| `cli/daemon.ts` | Same. Bug at lines 383-401 (re-parse on cache hit) is eliminated — no `parseWithOptionalProgram` call on cache hit path. Uses `BatchTypeScriptService` with `ts.createIncrementalProgram` for warm reuse. |
| `server/connection.ts` | `createHandlerContext.getAST` returns `ts.SourceFile.statements` (or migrated handler structure). `parseContent` call replaced by direct `ts.SourceFile` access. AST cache changes from ESTree `T.Program` to `ts.SourceFile` reference (which is already cached by the program). |
| `server/handlers/handler-context.ts` | `getAST` return type: `T.Program` → `ts.SourceFile`. Downstream handlers migrated. |
| `tsup.config.ts` | Remove `@typescript-eslint/parser`, `@typescript-eslint/project-service`, `@typescript-eslint/utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/scope-manager`, `@typescript-eslint/types`, `@typescript-eslint/visitor-keys` from `BUNDLED_DEPS`. |

**B. Migrate SDK from ESTree to TypeScript native AST (`packages/ganko/src/`)**

This is the REVIEW.md migration in its entirety. Touch points enumerated precisely:

| File/Area | Count | Change |
|-----------|-------|--------|
| `solid/input.ts` | 1 | `SolidInput` rewrite per REVIEW.md §1 |
| `solid/impl.ts` | 1 | `SolidGraph`: `sourceCode` → `sourceFile` + `checker`. All map key types from `T.*` → `ts.*`. `eslintScopeMap` deleted. `addScope` signature drops `eslintScope` param. `positionIndex.nodeAtOffset` type: `T.Node` → `ts.Node`. `comments` property added. `extractInlineStyleClassNames` migrated to `ts.*` checks. |
| `solid/parse.ts` | 1 | **Deleted.** Replaced by `createSolidInput(filePath, program, logger?)` function (inline in `plugin.ts` or new `create-input.ts`). |
| `solid/plugin.ts` | 1 | `buildSolidGraph`: takes `SolidInput` (now requires `ts.SourceFile`). `analyzeInput`: suppression uses `extractAllComments(sourceFile)`. `runSolidRules` signature: `(graph, sourceFile, emit)` — drops `TSESLint.SourceCode`. `SolidPlugin.analyze` uses `ts.createProgram` for test fixture files. |
| `solid/phases/prepare.ts` | 1 | Parent validation: `sourceFile.statements[0].parent !== sourceFile` check per REVIEW.md §5. |
| `solid/phases/scopes.ts` | 1 | Complete rewrite per REVIEW.md §6. Single-pass `ts.forEachChild` walk with `checker.getSymbolAtLocation`. Symbol→Variable map. Scope stack. `isDeclarationName`, `isWriteReference`, `isReadReference` helpers. |
| `solid/phases/entities.ts` | 1 | Merged with scopes phase into `runCombinedScopeAndEntitiesPhase` per REVIEW.md §12. All entity extraction: `ts.is*` guards, property access per §4. |
| `solid/phases/entities/handlers/*.ts` | ~12 | Every handler: node type discriminants, property access per REVIEW.md §4. `call.callee` → `call.expression`. `func.params` → `func.parameters`. `decl.init` → `decl.initializer`. etc. |
| `solid/phases/entities/visitors/*.ts` | ~4 | `visitProgram` becomes `ts.forEachChild`-based. All `node.type ===` checks → `ts.is*()`. |
| `solid/phases/context.ts` | 1 | Node type migrations. |
| `solid/phases/wiring.ts` | 1 | Direct `checker` access. Unconditional type-aware execution. Node type migrations. |
| `solid/phases/reactivity.ts` | 1 | Node type migrations. `first.value.type === "MemberExpression"` → `ts.isPropertyAccessExpression(first.value) \|\| ts.isElementAccessExpression(first.value)`. |
| `solid/phases/reachability.ts` | 1 | Node type migrations. |
| `solid/phases/exports.ts` | 1 | `T.ExportNamedDeclaration` → `ts.ExportDeclaration`. Node type migrations. |
| `solid/phases/dependencies.ts` | 1 | Node type migrations. |
| `solid/phases/index.ts` | 1 | Phase array: merge scopes+entities into single combined phase. Reduce from 9 phases to 8. |
| `solid/entities/*.ts` | 18 | Every entity type: `node` field from `T.*` → `ts.*` per REVIEW.md §3. |
| `solid/queries/*.ts` | 13 | All query functions: node type migrations, parent chain walks. `getSourceCode` → `getSourceFile`. |
| `solid/rules/**/*.ts` | ~90 | All rule files: `import type { TSESTree as T }` → `import type ts`. All node type discriminants. `sourceCode.getText(node)` → `node.getText(sourceFile)`. `sourceCode.getAllComments()` → `graph.comments`. `sourceCode.getTokenBefore` → `findPrecedingToken`. |
| `solid/rules/util.ts` | 1 | Node type migrations. |
| `solid/util/*.ts` | ~10 | All utilities: node type migrations. |
| `solid/typescript/index.ts` | 1 | `TypeResolver` rewrite: class → `createTypeResolver(checker, logger)` factory. Drop `initialize()`. Drop `esTreeNodeToTSNodeMap`. All methods take `ts.Node`. `hasTypeInfo()` → always `true`. `typeCache`: `WeakMap<T.Node>` → `WeakMap<ts.Node>`. |
| `suppression.ts` | 1 | `createSuppressionEmit(sourceFile, emit)`. Uses `extractAllComments(sourceFile)` scanner-based extraction per REVIEW.md §7. |
| `cache.ts` | 1 | `SolidGraph` type changes propagate. No structural change. |
| `graph.ts` | 1 | `Plugin.analyze` may take `AnalysisContext` with program. |
| `eslint-adapter.ts` | 1 | `buildSolidInputFromContext`: extracts `ts.Program` from `context.sourceCode.parserServices.program`, gets `sourceFile` and `checker`. `RuleModule` type kept (ESLint integration surface). |
| `solid/eslint-plugin.ts` | 1 | Graph builder: extracts `ts.SourceFile` from `parserServices.program`. |
| `index.ts` | 1 | Remove `parseContent`, `parseContentWithProgram`, `parseFile` exports. Add `createSolidInput`. |

**C. Tests (1476 tests)**

Every test constructing `SolidInput` via `parseContent`/`parseFile`/`parseContentWithProgram` must be migrated. New test helper:

```typescript
function createTestInput(code: string, filePath?: string): SolidInput {
  const fileName = filePath ?? "/test.tsx";
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // For tests needing type info: build a ts.Program from virtual files
  const program = createTestProgram({ [fileName]: code });
  return {
    file: fileName,
    sourceFile: program.getSourceFile(fileName)!,
    checker: program.getTypeChecker(),
  };
}
```

Tests that verify type-aware rules need a real `ts.Program`. Tests that verify structural rules can use a minimal program.

**D. LSP Handler Migration**

Handlers using `T.Program` (ESTree) must migrate to `ts.SourceFile`:

| Handler | Current usage | Migration |
|---------|--------------|-----------|
| `folding-ranges.ts` | `T.Program` statement iteration | `ts.SourceFile.statements` |
| `selection-range.ts` | ESTree node structure | `ts.Node` with `ts.forEachChild` |
| `linked-editing.ts` | JSX tag matching via ESTree | `ts.JsxElement.openingElement.tagName` + `closingElement.tagName` |
| `document-symbol.ts` | ESTree traversal | `ts.SourceFile` traversal |
| `semantic-tokens.ts` | ESTree node types | `ts.SyntaxKind` |
| `inlay-hint.ts` | ESTree node types | `ts.Node` types |

The AST cache (`Map<string, CachedAST>`) in `connection.ts` is eliminated — `ts.SourceFile` is already cached by the program.

#### Migration safety net:

Run `ganko lint` on the 230-file target project before AND after. Diff outputs. Zero diagnostic regressions.

---

## Phase 2: Worker Parallelism

**Effort**: `L` — 2-3 days  
**Independent value**: 4-6x speedup on CLI cold lint (the serial per-file loop). 6-10s after Phase 1 → 1.5-3s.  
**Depends on**: Phase 1 (workers need `ts.Node` API — no ESTree serialization boundary)  
**Unlocks**: Phase 5 (cache architecture interacts with worker boundaries)

#### Worker parallelism strategy:

**Each worker builds its own `ts.Program`.** Not shared memory. Not typeless mode. Not main-thread enrichment.

**Justification:**

1. `ts.Program` is not transferable across `worker_threads` (contains closures, host references, caches). Shared memory (`SharedArrayBuffer`) cannot represent TypeScript's object graph.

2. The "typeless workers" strategy is rejected by constraint: "No degraded execution paths. No typeless mode. No 'skip type-aware rules' fallback." Every path has full type checking.

3. Main-thread enrichment requires serializing partial graphs across threads, then deserializing, mutating, and re-associating. The serialization cost for `ts.Node` references (which are object references into the program's AST) is prohibitive — you'd effectively re-parse.

4. Per-worker `ts.Program` from the same tsconfig: each worker pays the `ts.createProgram` cost (~3-8s on cold start, ~200ms with `.tsbuildinfo`). But workers build programs concurrently with the main thread, and Phase 4's incremental cache means this cost is amortized to near-zero on warm paths. The memory overhead is ~50-100MB per worker for a 230-file project — acceptable on modern machines for N=`min(4, os.availableParallelism() - 1)` workers.

5. With Phase 1's migration to `ts.Node`, the worker's output is `{ path: string, diagnostics: Diagnostic[] }` — `Diagnostic` uses `{ line, column }` location info, not AST node references. Fully serializable via `structuredClone`.

#### Architecture:

```
Main thread:
  1. Parse tsconfig
  2. Partition files into N chunks
  3. Spawn N workers, each receiving: tsconfig path + file chunk
  4. Each worker: ts.createProgram → for each file: createSolidInput → buildSolidGraph → runSolidRules → postMessage({ path, diagnostics })
  5. Main thread collects results, runs cross-file analysis

Worker lifetime: per-invocation (CLI) or pooled (daemon).
```

| File | Change |
|------|--------|
| `cli/worker-pool.ts` | **New.** Generic worker pool: spawn, dispatch, collect, terminate. |
| `cli/lint-worker.ts` | **New.** Worker entry: receives `{ tsconfigPath, files }`, builds program, runs per-file analysis, posts results. |
| `cli/lint.ts` | Serial loop replaced with `workerPool.dispatch(chunks)`. Falls back to serial for ≤4 files. |
| `cli/daemon.ts` | Serial loop replaced with worker dispatch for initial warm, serial for incremental (where only a few files changed). |

#### Graph cache interaction:

Workers cannot share `GraphCache`. For cross-file analysis, the main thread re-builds graphs for the files it needs (using its own `ts.Program`). With Phase 1's zero-parse architecture, this is ~5-13ms per file — rebuilding all 230 graphs takes ~1.5-3s. Workers handle the dominant single-file rule execution cost.

For the daemon warm path (few files changed): the serial path with cached graphs is faster than worker dispatch overhead. Use workers only when `filesToLint.length > threshold` (e.g., 20).

---

## Phase 3: LSP Three-Tier Diagnostics

**Effort**: `L` — 2-3 days  
**Independent value**: First diagnostics in <100ms instead of 13s.  
**Depends on**: Phase 1 (needs `IncrementalTypeScriptService` with `createWatchProgram`)  
**Unlocks**: Phase 4 (incremental cache piggybacks on the same watch program)

#### How tiered diagnostics works without typeless mode:

The constraint says `SolidInput` REQUIRES `ts.TypeChecker` (no null). There is no typeless tier. Instead, the three tiers are:

**Tier 1: Immediate single-file diagnostics with full type info (<100ms)**

The key insight: `handleInitialized` currently blocks on workspace scanning before `resolveReady()`. But `ts.createWatchProgram` is called during initialization and completes parsing all files before returning. The problem is not that type info is unavailable — it's that workspace-level work (ESLint config, file index, CSS/Tailwind, cross-file analysis) blocks the readiness gate.

Fix: `resolveReady()` fires immediately after `createWatchProgram` succeeds. `didOpen` can then do:
1. `watchProgram.getProgram().getSourceFile(path)` — O(1)
2. `createSolidInput` → `buildSolidGraph` → `runSolidRules` — 5-13ms
3. Publish diagnostics

Total: <20ms for the first file. No workspace scan needed.

But wait — `createWatchProgram` itself takes 3-8s (it builds the full program). The solution:

**Tier 1 (actual <100ms):** On `didOpen` BEFORE `ready` resolves, parse the single file with `ts.createSourceFile` (standalone, no program) + `ts.createProgram` for just that one file's imports. This is fast (~50-100ms) and provides a real `TypeChecker` — just scoped to the open file's immediate dependencies, not the full project.

```typescript
// Tier 1: single-file program
const singleFileProgram = ts.createProgram({
  rootNames: [openFilePath],
  options: compilerOptions,
  host: compilerHost, // reads from disk
});
```

This gives full type info for the one file. All rules run. Diagnostics published in <100ms.

**Tier 2: Full program available (3-8s after startup)**

Background `createWatchProgram` completes. Re-diagnose open files with the full program's `TypeChecker` (which resolves cross-project types more completely). Republish diagnostics.

**Tier 3: Workspace enrichment (5-10s after startup)**

ESLint config, file index, CSS/Tailwind, cross-file analysis run in the background. Cross-file diagnostics merged and republished.

| File | Change |
|------|--------|
| `server/handlers/lifecycle.ts` | `handleInitialized`: call `resolveReady()` immediately after creating the watch program host (before program builds). Start background warmup chain. |
| `server/connection.ts` | `didOpen` handler: Tier 1 if `!watchProgramReady`, Tier 2 if `watchProgramReady && !workspaceReady`, full if `workspaceReady`. |
| `core/incremental-program.ts` | Expose `isReady(): boolean` gate. |

---

## Phase 4: Persistent Incremental Cache (`.tsbuildinfo`)

**Effort**: `M` — 1-2 days  
**Independent value**: Cold start program build from ~3-8s → ~200ms.  
**Depends on**: Phase 1 (direct `ts.Program` with `CompilerHost`)  
**Unlocks**: Workers in Phase 2 become cheap (each worker loads `.tsbuildinfo` instead of full parse)

#### What changes:

Replace `ts.createProgram` in `BatchTypeScriptService` with `ts.createIncrementalProgram`:

```typescript
const program = ts.createIncrementalProgram({
  rootNames: parsedConfig.fileNames,
  options: {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile: resolve(rootPath, "node_modules/.cache/ganko/.tsbuildinfo"),
  },
  host: incrementalHost,
});
```

After each lint run, save the builder state:

```typescript
program.emit(undefined, host.writeFile, undefined, true); // emitOnlyDts=true saves .tsbuildinfo
```

| File | Change |
|------|--------|
| `core/batch-program.ts` | `ts.createProgram` → `ts.createIncrementalProgram` with `.tsbuildinfo`. |
| `cli/lint.ts` | Save `.tsbuildinfo` after successful lint. |
| `cli/daemon.ts` | Load `.tsbuildinfo` on startup if available. Save after each request. |

---

## Phase 5: Content-Addressed `SolidGraph` Cache

**Effort**: `M` — 1-2 days  
**Independent value**: Skip graph building for unchanged files. Daemon warm lint drops to sub-second.  
**Depends on**: Phase 1 (graph is now pure `ts.Node`-based, no ESTree overhead)

#### Caching strategy:

**What is cached:**

| Cache layer | Key | Value | Scope |
|-------------|-----|-------|-------|
| `ts.SourceFile` | file path | TypeScript's internal cache | Within `ts.Program` — free |
| `SolidGraph` | `(path, contentHash)` | Full graph instance | In-memory (`GraphCache`), per CLI invocation / daemon lifetime / LSP lifetime |
| `.tsbuildinfo` | disk file | Incremental program state | On disk, persists across process restarts |
| Cross-file results | `(solidGeneration, cssGeneration)` | `Map<path, Diagnostic[]>` | In-memory (`GraphCache`) |

**What is NOT cached:**

- `ts.SourceFile` on disk: TypeScript's `.tsbuildinfo` handles this. No separate SourceFile cache.
- ESTree anything: eliminated.
- Serialized `SolidGraph` on disk: the graph holds `ts.Node` references (pointers into the program's AST tree). These cannot be serialized/deserialized across program instances. Graph caching is in-memory only, keyed by content hash.

**Content hash for version key:**

Replace the daemon's `project.getScriptVersion` (which relied on `ProjectService` internals) with a content hash:

```typescript
import { createHash } from "node:crypto";
function contentVersion(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
```

The `GraphCache` already uses path+version keys. Change the version source from `ProjectService.getScriptVersion` to `contentVersion(sourceFile.text)`.

**Daemon fix (lines 383-401):** With Phase 1, the cache hit path never calls `parseWithOptionalProgram`. It retrieves the cached `SolidGraph`, and since `runSolidRules` now takes `(graph, sourceFile, emit)` where `sourceFile` is obtained via `program.getSourceFile()` (O(1)), there is zero redundant work on cache hit.

| File | Change |
|------|--------|
| `cache.ts` | Version key: accept content hash. No structural change. |
| `cli/lint.ts` | Version computed from `sourceFile.text` hash. |
| `cli/daemon.ts` | Version computed from `sourceFile.text` hash. Cache-hit path: `runSolidRules(cachedGraph, sourceFile, emit)` — no re-parse. |

---

## Phase 6: Bundle Size + Cold Start Optimization

**Effort**: `S` — half day  
**Independent value**: 2-4MB smaller bundle. ~200ms faster worker/CLI cold start (less to load).  
**Depends on**: Phase 1 (ESTree deps removed from code)

#### What changes:

| File | Change |
|------|--------|
| `packages/ganko/package.json` | Remove `@typescript-eslint/parser`, `@typescript-eslint/scope-manager`, `@typescript-eslint/utils`, `@typescript-eslint/typescript-estree` from dependencies. Retain `typescript`. |
| `packages/lsp/package.json` | Remove `@typescript-eslint/project-service` from dependencies. Keep `@typescript-eslint/parser` only if ESLint config loading path requires it (verify via `eslint-config.ts`). |
| `packages/lsp/tsup.config.ts` | Remove all `@typescript-eslint/*` from `BUNDLED_DEPS`. |

---

### 3. Rationale

**Why Phase 1 combines ProjectService replacement + ESTree migration:**

These two changes have a 1:1 dependency. `ProjectService` provides `ts.Program` via `openClientFile` ceremony. The migration replaces this with direct `ts.createProgram`. Simultaneously, the ESTree migration changes `SolidInput` to require `ts.SourceFile` from the program. Attempting to do ProjectService replacement alone would require keeping `parseForESLint` (which needs a program to produce ESTree), creating a pointless intermediate state. Attempting ESTree migration alone would require `parseForESLint` to be the SourceFile provider, defeating the purpose.

**Why per-worker `ts.Program` over typeless workers:**

The constraint forbids degraded execution paths. Typeless workers skip ~5% of rules. The "hybrid enrichment" approach requires serializing `ts.Node` references across threads, which is impossible — `ts.Node` objects contain parent pointers into the program's tree. Per-worker programs are the only correct approach.

**Why Phase ordering 1→2→3→4→5→6:**

- Phase 1 is the foundation. Nothing works without it.
- Phase 2 (workers) depends on Phase 1's `ts.Node` API surface (workers need `ts.createProgram` + `ts.Node`-based graph building).
- Phase 3 (LSP tiers) depends on Phase 1's `createWatchProgram`.
- Phase 4 (`.tsbuildinfo`) depends on Phase 1's `CompilerHost` architecture but is otherwise independent. Can be done concurrently with Phases 2-3.
- Phase 5 (graph cache) depends on Phase 1's content-hash versioning.
- Phase 6 (bundle cleanup) depends on Phase 1's dependency removal.

Phases 2, 3, 4 can be worked on concurrently after Phase 1. Phase 5 requires Phase 1 only. Phase 6 is a cleanup pass.

**Why not keeping ESTree for any transition period:**

The constraint is explicit: "No ESTree anywhere." Beyond that, maintaining two AST representations doubles testing surface, introduces type confusion, and prevents performance gains (every ESTree path reintroduces the 15-30ms/file conversion cost).

---

### 4. Risks and Guardrails

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Diagnostic regression** (rules produce different results after migration) | High | Snapshot test: capture `ganko lint` output on target project BEFORE migration. Diff after. Zero regressions allowed. Run this check on every commit during Phase 1. |
| **JSX structural differences** (ESTree `JSXElement` vs TS `JsxElement + JsxSelfClosingElement`) | Medium | The union type `ts.JsxElement \| ts.JsxSelfClosingElement` in `JSXElementEntity.node` is explicit. Every JSX handler must check both. Grep for `JsxElement` and verify every site handles self-closing. |
| **Scope resolution divergence** (TS symbols vs ESLint scope manager may classify references differently) | Medium | Cross-reference: for each test that exercises variable tracking, verify the TS-based scope resolution produces identical `VariableEntity.reads` and `VariableEntity.assignments`. |
| **Per-worker `ts.Program` memory pressure** | Medium | Cap worker count at `min(4, availableParallelism - 1)`. Each program is ~50-100MB for 230 files. 4 workers = ~200-400MB extra. Monitor and add a `--max-workers` CLI flag. |
| **`ts.createSourceFile` standalone (Tier 1 LSP) provides incomplete types** | Low | The single-file program has `compilerOptions.noResolve = false`, so it resolves imports. Types from `solid-js` are available if `node_modules` is accessible. Monitor false-positive rates on Tier 1 diagnostics. |
| **ESLint adapter breakage** | Medium | The ESLint adapter gets `ts.Program` from `@typescript-eslint/parser`'s `parserServices.program`. This continues to work — the parser still provides a program. The adapter extracts `sourceFile` from it. Test with `eslint --rule ganko/signal-call` on a test file. |
| **Handler migration bugs** (folding, selection, linked-editing use ESTree AST) | Low | These handlers have existing test coverage via the VS Code extension's integration tests. Run them. |

---

### 5. Validation

**Phase 1:**
- `bun run tsc` — zero errors across all 4 packages
- `bun run test` — all 1476 tests pass
- `bun run lint` — zero warnings (max-warnings=0)
- Diagnostic equivalence: `ganko lint` on target project → diff vs pre-migration snapshot → zero delta
- Performance: profile target project. Verify `parseForESLint` absent from flamechart. Per-file graph build ≤13ms.
- Bundle: verify no `@typescript-eslint/*` in `dist/` (except ESLint adapter's use of `@typescript-eslint/utils` types)

**Phase 2:**
- CLI: `ganko lint --no-daemon` on target project with `--log-level debug`. Verify `worker_threads` messages in log.
- Timing: measure wall-clock time. Expect 1.5-3s vs 6-10s serial.
- Determinism: run 5 times, verify identical diagnostic output.

**Phase 3:**
- LSP: open a SolidJS file in VS Code. Measure time from `didOpen` to first diagnostic squiggly. Target: <100ms.
- Verify Tier 2 re-diagnosis occurs (diagnostics may change slightly as full program types resolve).
- Verify Tier 3 cross-file diagnostics appear within 10s.

**Phase 4:**
- Cold start with `.tsbuildinfo`: measure `ts.createIncrementalProgram` time. Target: <300ms.
- Delete `.tsbuildinfo`, run again. Verify it's regenerated.

**Phase 5:**
- Daemon: run `ganko lint` twice in succession (via daemon). Second run should show ~0 graph rebuilds in log.
- Verify content hash matches prevent unnecessary rebuilds.

**Phase 6:**
- `du -sh dist/` before and after. Expect 2-4MB reduction.
- `bun run ci` passes.

---

### 6. Unresolved Questions

None.

The architecture is decided (REVIEW.md). The worker strategy is decided (per-worker `ts.Program`). The LSP tiering strategy is decided (single-file `ts.createProgram` for Tier 1, not typeless). The cache architecture is decided (content-hash-keyed in-memory `SolidGraph` + on-disk `.tsbuildinfo`). The phase ordering is decided. Every touch point is enumerated. Execution can begin.
