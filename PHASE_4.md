# Phase 4: Decouple LSP Initial Diagnostics from Workspace Warmup

**Estimated Impact**: First diagnostics in <100ms instead of 13s
**Files touched**: `lifecycle.ts`, `connection.ts`, `project.ts`
**Risk**: Medium (changes the LSP initialization contract, must handle race conditions between lazy warmup and eager requests)
**Depends on**: Phase 1 (direct `ts.Program` with `WatchProgram`)

## Problem

`handleInitialized` (`lifecycle.ts:151`) blocks on a serial pipeline before declaring readiness:

1. Load ESLint config (async disk I/O)
2. `createFileIndex` (sync disk scan)
3. `readCSSFilesFromDisk` (sync reads of all CSS files)
4. `resolveTailwindValidator` (async, may download/resolve)
5. `scanDependencyCustomProperties` (sync scan of node_modules)
6. `createProject` (constructs `ProjectService`, allocates TS infrastructure)
7. `setTimeout(() => warmProgram(...), 0)` (deferred but still blocks first diagnostic)

Only after all of this does `resolveReady()` fire. Every `didOpen` handler awaits `context.ready` — so the first file opened sits waiting for the entire workspace to be prepared.

This is the wrong model. Fast tools (VS Code ESLint, typescript-language-server, rust-analyzer) return **something useful for the current file first**, then fill in workspace knowledge later.

## Solution: Three-Tier Diagnostics

### Tier 1: Immediate File-Local Diagnostics (target: <100ms)

On `didOpen`, before the workspace is warm:
- Parse the file with `parseContent` (no `ts.Program`, no type info)
- Build `SolidGraph` from the parse result
- Run single-file rules (non-type-aware rules cover ~95% of diagnostics)
- Publish diagnostics immediately

No workspace scan. No Tailwind. No cross-file. No TS program.

### Tier 2: Typed Diagnostics for Open Files (target: as TS program becomes available)

Once the background `ts.Program` build completes:
- Re-parse open files with `parseContentWithProgram` (full type info)
- Re-run single-file rules (type-aware rules now fire)
- Publish updated diagnostics

### Tier 3: Background Workspace Diagnostics (target: within 5-10s of startup)

Background tasks that run after Tier 2:
- File index scan
- CSS/Tailwind/dependency resolution
- Cross-file graph building
- Cross-file rule execution
- Publish cross-file diagnostics merged with Tier 2 results

## Implementation

### `lifecycle.ts` Changes

```typescript
export async function handleInitialized(
  _params: InitializedParams,
  state: ServerState,
  connection: Connection,
  context?: ServerContext,
): Promise<void> {
  if (!state.rootPath || !context) {
    state.initialized = true;
    context?.resolveReady();
    return;
  }

  // Resolve ready IMMEDIATELY — Tier 1 diagnostics don't need workspace state
  state.initialized = true;
  context.resolveReady();

  // Background: kick off workspace warmup (non-blocking)
  context.startBackgroundWarmup(state);
}
```

### `connection.ts` Changes

New state on `ServerContext`:

```typescript
interface ServerContext {
  // ... existing ...

  /** Whether the TS program is available for type-aware analysis */
  readonly programReady: Promise<void>

  /** Whether cross-file analysis infrastructure is available */
  readonly workspaceReady: Promise<void>

  /** Start background warmup (called from handleInitialized) */
  startBackgroundWarmup(state: ServerState): void
}
```

New `didOpen` flow:

```typescript
documents.onDidOpen(async (event) => {
  const path = handleDidOpen(event, documentState);
  await context.ready; // fires immediately now

  if (!path || !context.project) return;

  // Tier 1: file-local diagnostics, no type info
  publishFileDiagnosticsLocal(context, path, event.document.getText());

  // Tier 2: once program is ready, re-diagnose with type info
  context.programReady.then(() => {
    if (documentState.openDocuments.has(event.document.uri)) {
      publishFileDiagnostics(context, context.project!, path, event.document.getText());
    }
  });

  // Tier 3: once workspace is ready, add cross-file diagnostics
  context.workspaceReady.then(() => {
    if (documentState.openDocuments.has(event.document.uri)) {
      publishFileDiagnostics(context, context.project!, path, event.document.getText(), true);
    }
  });
});
```

### Background Warmup Pipeline

```typescript
async function backgroundWarmup(context: ServerContext, state: ServerState): Promise<void> {
  const { log, rootPath } = state;

  // Step 1: ESLint config (fast, needed for overrides)
  const eslintResult = await loadESLintConfig(rootPath, state.eslintConfigPath, log);
  state.eslintOverrides = eslintResult.overrides;
  state.ruleOverrides = mergeOverrides(eslintResult.overrides, state.vscodeOverrides);

  // Step 2: Build ts.Program (the expensive part — 3-8s)
  // Uses WatchProgram from Phase 1
  const project = createProject({ rootPath, plugins: [...], rules: state.ruleOverrides, mode: "incremental" });
  state.project = project;
  context.setProject(project);
  context.resolveProgramReady(); // Tier 2 diagnostics can now fire

  // Step 3: File index + CSS + Tailwind + dependencies (parallel where possible)
  const [fileIndex, tailwind, externalProps] = await Promise.all([
    Promise.resolve(createFileIndex(rootPath, effectiveExclude(state), log)),
    resolveTailwindValidator(readCSSFilesFromDisk(fileIndex.cssFiles)).catch(() => null),
    Promise.resolve(scanDependencyCustomProperties(rootPath)),
  ]);
  context.fileIndex = fileIndex;
  context.tailwindValidator = tailwind;
  context.externalCustomProperties = externalProps;
  context.resolveWorkspaceReady(); // Tier 3 diagnostics can now fire
}
```

### Race Condition Handling

Key invariant: **no handler should crash if the program/workspace isn't ready yet**.

- `getLanguageService()` returns `null` before `programReady` resolves → handlers already handle this
- `runCrossFileDiagnostics()` requires `fileIndex` → skip if `null`, caller uses cached results (empty on first open)
- `didChange` during warmup: queue changes, process after `programReady`
- `didSave` during warmup: same queuing strategy

### Feature Handlers (hover, definition, etc.)

These already return `null`/fallback when `HandlerContext` isn't available. With the new model:
- Before `programReady`: return `null` (no IntelliSense until program builds)
- After `programReady`: full functionality
- This is the same UX as VS Code's TypeScript: IntelliSense isn't instant on workspace open, it loads progressively

## Verification

- LSP in VS Code: open a file, see diagnostics within 100ms
- Wait 5-10s, see additional type-aware and cross-file diagnostics appear
- Hover/definition/completion: unavailable briefly, then functional
- No duplicate diagnostics (each tier replaces previous, not appends)
- `bun run test` — all tests pass
- Close and reopen a file during warmup — no crash
