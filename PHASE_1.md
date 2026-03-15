# Phase 1: Replace ProjectService with Direct `ts.Program`

**Estimated Impact**: -2-4s (eliminates open/close ceremony, deferred timers, warmup sentinel)
**Files touched**: `project-service.ts`, `project.ts`, `analyze.ts`, `lint.ts`, `daemon.ts`, `lifecycle.ts`, `connection.ts`
**Risk**: High (foundational change, every consumer of `Project` is affected)

## Problem

`@typescript-eslint/project-service` wraps `ts.server.ProjectService` — an editor-oriented API that manages per-file open/close state, schedules deferred graph updates via 250ms timers, and reassigns files between inferred/configured projects. Ganko uses it as a batch program builder, fighting the abstraction at every turn:

- `openClientFile`/`closeClientFile` lifecycle per file (`project-service.ts:122-126`)
- Timer interception and teardown (`project-service.ts:88-101`)
- `warmProgram` sentinel hack (`project-service.ts:164-171`)
- `getCachedProgramForFile` falling through `warmSeed` (`project-service.ts:140-149`)
- Daemon syncing every solid file via `openClientFile` before linting (`daemon.ts:235-258`)

## Solution

Replace the entire `TypeScriptProjectService` abstraction with two concrete implementations:

### 1A. CLI/Daemon: `ts.createProgram` (batch)

```typescript
interface BatchTypeScriptService {
  /** The full program — all source files available immediately */
  readonly program: ts.Program
  /** Type checker from the program */
  readonly checker: ts.TypeChecker
  /** Get source file text (already in program) */
  getSourceFileText(path: string): string | null
  /** Dispose (no-op for batch — no timers, no state) */
  dispose(): void
}
```

Implementation:
1. Read `tsconfig.json` from `rootPath` via `ts.readConfigFile` + `ts.parseJsonConfigFileContent`
2. Call `ts.createProgram(parsedConfig.fileNames, parsedConfig.options)` — one call, done
3. All `SourceFile` instances are immediately available via `program.getSourceFile(path)`
4. No `openClientFile`, no `warmProgram`, no deferred timers

### 1B. LSP: `ts.createWatchProgram` (incremental)

```typescript
interface IncrementalTypeScriptService {
  /** Get the current program (rebuilt incrementally on changes) */
  getProgram(): ts.Program
  /** Get language service for editor features */
  getLanguageService(): ts.LanguageService
  /** Notify that a file's content changed */
  updateFile(path: string, content: string): void
  /** Dispose watchers and services */
  dispose(): void
}
```

Implementation:
1. Create a `ts.WatchCompilerHost` with a custom `readFile` that serves in-memory content for open files
2. Call `ts.createWatchProgram(host)` — builds program, watches for changes
3. On `updateFile`: update the in-memory content map, call `host.onSourceFileChanged(path)` to trigger incremental rebuild
4. `getProgram()` returns the current `WatchProgram.getProgram().getProgram()`
5. `getLanguageService()` wraps the same host in a `ts.LanguageService` for hover/definition/completion

### 1C. Update `Project` interface

The `Project` interface (`project.ts`) currently exposes:
- `getProgram(path)` — returns `ts.Program | null` per file
- `warmProgram(path, content?)` — sentinel hack
- `getLanguageService(path)` — per file
- `getScriptVersion(path)` — per file
- `updateFile(path, content)` — per file
- `closeFile(path)` — per file
- `openFiles()` — tracks open state

New `Project` interface:
- `getProgram()` — returns the single `ts.Program` (no per-file lookup)
- `getChecker()` — returns `ts.TypeChecker`
- `getLanguageService()` — returns single `ts.LanguageService` (LSP only)
- `getSourceFile(path)` — delegates to `program.getSourceFile()`
- `updateFile(path, content)` — LSP only, triggers incremental rebuild
- `dispose()` — clean shutdown

Removed:
- `warmProgram` — unnecessary, program is built in one call
- `closeFile` — no open/close lifecycle
- `openFiles` — no tracking needed
- `getScriptVersion` — replaced by content hashing or program version

### 1D. Update all consumers

**`lint.ts`** (CLI):
- Remove `project.warmProgram(firstSolidFile.value)` sentinel call (line 515)
- Replace `project.getProgram(key)` per-file with `project.getProgram()` once, then `program.getSourceFile(key)`
- Remove `project.updateFile(key, content)` fallback (line 536) — batch program already has all files

**`daemon.ts`**:
- Remove the entire `solidPathsToSync` loop that syncs files via `updateFile` (lines 235-258)
- Remove `project.warmProgram` call (line 228)
- On repeated lint: rebuild program (incremental) or use `WatchProgram` to detect changes
- Remove `project.closeFile` cleanup loop (lines 451-462)

**`lifecycle.ts`** (LSP):
- Remove `setTimeout` warmup scheduling (lines 206-211)
- `createProject` now takes a mode parameter: `"batch"` or `"incremental"`
- `resolveReady()` can fire immediately after project creation (program build happens in background for LSP — see Phase 4)

**`connection.ts`** (LSP):
- `createHandlerContext` updates: `getLanguageService(path)` → `project.getLanguageService()`
- `getSourceFile(path)` → `project.getSourceFile(path)`
- `getScriptVersion` → use program's internal version or content hash
- Remove `project.closeFile` call in `didClose` handler

**`analyze.ts`**:
- `buildSolidGraphForPath`: get program once, then `program.getSourceFile(path)`
- `runSingleFileDiagnostics`: same — no per-file `getProgram` call
- `runCrossFileDiagnostics`: `project.getScriptVersion` replaced with content hash or program version

## Migration Steps

1. Create `packages/lsp/src/core/batch-program.ts` — the `BatchTypeScriptService` implementation
2. Create `packages/lsp/src/core/incremental-program.ts` — the `IncrementalTypeScriptService` implementation
3. Update `project.ts` to accept either service via a discriminated union or factory parameter
4. Update `lint.ts` to use batch mode
5. Update `daemon.ts` to use batch mode (rebuild program per request, fast with incremental)
6. Update `lifecycle.ts` and `connection.ts` to use incremental mode
7. Update `analyze.ts` consumers
8. Delete `project-service.ts`
9. Remove `@typescript-eslint/project-service` from `package.json` dependencies
10. Run full test suite, fix breakage

## Verification

- `bun run test` — all 1476 tests pass
- `bun run lint` — zero warnings
- `bun run tsc` — type-checks clean
- Manual: `ganko lint` on bor-web/web — measure cold and warm times
- Manual: LSP in VS Code — hover, definition, completion still work
