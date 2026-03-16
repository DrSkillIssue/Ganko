# Phase 3: LSP Three-Tier Diagnostics

**Effort**: L (2-3 days)
**Depends on**: Phase 1 (`IncrementalTypeScriptService` with `createWatchProgram`)
**Independent value**: First diagnostics in <100ms instead of 8-13s

---

## Problem

Current `handleInitialized` (lifecycle.ts:151-227) blocks on:

1. `loadESLintConfig` (async, ~50-200ms)
2. `createFileIndex` (sync, ~10ms)
3. `readCSSFilesFromDisk` + `resolveTailwindValidator` (async, ~50-500ms)
4. `scanDependencyCustomProperties` (sync, ~100-500ms)
5. `createProject` → `createTypeScriptProjectService` → `createProjectService` (sync, ~200ms)
6. `warmProgram` via `setTimeout(0)` → triggers full TS program build (~3-8s)

Only after step 6 does `resolveReady()` fire. All `didOpen`/`didChange` handlers await `context.ready`, so no diagnostics appear until the full program is built.

Post-Phase 1, the blocking point shifts. `createProject` creates either `IncrementalTypeScriptService` (watch program) or `BatchTypeScriptService`. The watch program itself takes 3-8s to build. The readiness gate still blocks all diagnostics.

---

## Three-tier strategy (no typeless mode)

Every tier has full `ts.TypeChecker`. No degraded paths.

### Tier 1: Single-file program (<100ms from `didOpen`)

On `didOpen`, BEFORE `ready` resolves, create a minimal `ts.Program` for just the opened file. This gives a real `ts.TypeChecker` scoped to the file's direct imports.

### Tier 2: Full program available (3-8s after startup)

Background `createWatchProgram` completes. Re-diagnose open files with the full program's `TypeChecker`.

### Tier 3: Workspace enrichment (5-10s after startup)

ESLint config, file index, CSS/Tailwind, cross-file analysis complete. Cross-file diagnostics merged and republished.

---

## `packages/lsp/src/core/tier1-program.ts` (NEW)

```typescript
import ts from "typescript";
import { resolve, dirname } from "node:path";

export interface Tier1Result {
  readonly program: ts.Program
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
}

/**
 * Build a minimal ts.Program for a single file with full type info.
 *
 * Resolves the file's imports (including node_modules) so the
 * TypeChecker can resolve types from solid-js, DOM libs, etc.
 * Cost: ~50-100ms (dominated by lib.d.ts parsing on first call,
 * cached by TS internally thereafter).
 */
export function createTier1Program(
  filePath: string,
  content: string,
  compilerOptions?: ts.CompilerOptions,
  cachedHost?: ts.CompilerHost,
): Tier1Result | null {
  const options: ts.CompilerOptions = compilerOptions ?? inferCompilerOptions(filePath);

  const defaultHost = cachedHost ?? ts.createCompilerHost(options);

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      if (fileName === filePath) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      return defaultHost.getSourceFile(fileName, languageVersion);
    },
    fileExists(fileName) {
      if (fileName === filePath) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      if (fileName === filePath) return content;
      return defaultHost.readFile(fileName);
    },
  };

  const program = ts.createProgram({
    rootNames: [filePath],
    options,
    host,
  });

  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return null;

  return {
    program,
    sourceFile,
    checker: program.getTypeChecker(),
  };
}

/**
 * Infer minimal CompilerOptions from the nearest tsconfig.json.
 * Falls back to reasonable defaults if no tsconfig is found.
 */
function inferCompilerOptions(filePath: string): ts.CompilerOptions {
  const dir = dirname(filePath);
  const tsconfigPath = ts.findConfigFile(dir, ts.sys.fileExists, "tsconfig.json");

  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(tsconfigPath),
    );
    return parsed.options;
  }

  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
}
```

The `inferCompilerOptions` reads the project's tsconfig once. The result should be cached in `ServerContext` for subsequent Tier 1 calls (multiple files can be opened before the full program is ready).

---

## `packages/lsp/src/server/connection.ts` changes

### New state fields on `ServerContext`

All three fields must be added to the `ServerContext` interface definition in connection.ts:290-367. With `exactOptionalPropertyTypes: true` from root tsconfig, `boolean` fields must be explicitly initialized to `false`, and `| null` fields initialized to `null`.

```typescript
export interface ServerContext {
  // ... existing fields ...

  /** Compiler options cached from tsconfig for Tier 1 programs */
  cachedCompilerOptions: ts.CompilerOptions | null

  /** Cached CompilerHost for Tier 1 programs (avoids re-parsing lib.d.ts) */
  cachedTier1Host: ts.CompilerHost | null

  /** Whether the full watch program is ready */
  watchProgramReady: boolean

  /** Whether workspace-level enrichment (ESLint, Tailwind, cross-file) is ready */
  workspaceReady: boolean
}
```

Initialize in `createServer`:

```typescript
cachedCompilerOptions: null,
cachedTier1Host: null,
watchProgramReady: false,
workspaceReady: false,
```

### `didOpen` handler changes

Current (connection.ts:762-774):

```typescript
documents.onDidOpen(async (event) => {
  const path = handleDidOpen(event, documentState);
  await context.ready;
  // ... publishFileDiagnostics
});
```

Post-Phase 3:

```typescript
documents.onDidOpen(async (event) => {
  const path = handleDidOpen(event, documentState);
  if (!path) return;

  const key = canonicalPath(path);
  const kind = classifyFile(key);
  if (kind !== "solid") {
    // Non-solid files wait for full readiness
    await context.ready;
    const project = context.project;
    if (project) publishFileDiagnostics(context, project, path, event.document.getText());
    return;
  }

  if (context.watchProgramReady) {
    // Tier 2/3: full program available
    await context.ready;
    const project = context.project;
    if (project) publishFileDiagnostics(context, project, path, event.document.getText());
    return;
  }

  // Tier 1: single-file program, no waiting
  const content = event.document.getText();
  publishTier1Diagnostics(context, key, content);

  // When full program becomes ready, re-diagnose with Tier 2
  context.ready.then(() => {
    const project = context.project;
    if (project) publishFileDiagnostics(context, project, key, content);
  });
});
```

### `publishTier1Diagnostics` (NEW function in connection.ts)

```typescript
import { createTier1Program } from "../../core/tier1-program";
import { createSolidInput, buildSolidGraph, runSolidRules } from "@drskillissue/ganko";

function publishTier1Diagnostics(
  context: ServerContext,
  path: string,
  content: string,
): void {
  if (!context.serverState.rootPath) return;

  const t0 = performance.now();

  if (context.cachedCompilerOptions === null) {
    const tsconfigPath = ts.findConfigFile(
      context.serverState.rootPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(tsconfigPath),
      );
      context.cachedCompilerOptions = parsed.options;
    }
  }

  // Cache the CompilerHost across Tier 1 calls to avoid re-parsing lib.d.ts
  // for each opened file. lib.d.ts parsing is cached within a single CompilerHost
  // instance, NOT globally — so reusing the host saves ~50-100ms per subsequent file.
  if (context.cachedTier1Host === null && context.cachedCompilerOptions) {
    context.cachedTier1Host = ts.createCompilerHost(context.cachedCompilerOptions);
  }

  const tier1 = createTier1Program(
    path,
    content,
    context.cachedCompilerOptions ?? undefined,
    context.cachedTier1Host ?? undefined,
  );
  if (!tier1) {
    if (context.log.enabled) context.log.warning(`Tier 1: failed to create program for ${path}`);
    return;
  }

  const input = createSolidInput(path, tier1.program, context.log);
  const graph = buildSolidGraph(input);

  const diagnostics: Diagnostic[] = [];
  const emit = (d: Diagnostic) => diagnostics.push(d);
  runSolidRules(graph, tier1.sourceFile, emit);

  // Cache single-file diagnostics
  context.diagCache.set(path, diagnostics);

  // Publish
  const converted = convertDiagnostics(diagnostics);
  const uri = context.documentState.pathIndex.get(path) ?? pathToUri(path);
  const docInfo = context.documentState.openDocuments.get(uri);
  const params: PublishDiagnosticsParams = { uri, diagnostics: converted };
  if (docInfo?.version !== undefined) params.version = docInfo.version;
  context.connection.sendDiagnostics(params);

  if (context.log.enabled) {
    context.log.info(`Tier 1: ${path} → ${diagnostics.length} diagnostics in ${(performance.now() - t0).toFixed(0)}ms`);
  }
}
```

---

## `packages/lsp/src/server/handlers/lifecycle.ts` changes

### Restructured `handleInitialized`

Split into three phases with readiness gates.

**Import required**: Add `import { getOpenDocumentPaths } from '../document'` to lifecycle.ts.

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
    connection.console.log("Solid LSP ready (no workspace root)");
    return;
  }

  const { log } = context;
  const rootPath = state.rootPath;

  // Phase A: Load ESLint config BEFORE resolveReady() so Tier 1 diagnostics
  // have rule overrides applied. ESLint config loading is ~50-200ms — fast enough
  // to run synchronously before the readiness gate. Without this, Tier 1 diagnostics
  // would run without overrides, then flicker when Tier 3 applies them.
  if (state.useESLintConfig) {
    const eslintResult = await loadESLintConfig(rootPath, state.eslintConfigPath, log)
      .catch((err: unknown) => {
        if (log.enabled) log.warning(`Failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
        return EMPTY_ESLINT_RESULT;
      });
    state.eslintOverrides = eslintResult.overrides;
    state.ruleOverrides = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
  }

  // Create project with IncrementalTypeScriptService
  // NOTE: createProject does NOT call createWatchProgram yet — that is deferred below
  const project = createProject({
    rootPath,
    plugins: [SolidPlugin, CSSPlugin],
    rules: state.ruleOverrides ?? {},
    log,
  });
  state.project = project;
  context.setProject(project);
  state.initialized = true;

  // resolveReady fires NOW — didOpen can proceed with Tier 1
  // Feature handlers (definition, hover, etc.) still check isServerReady()
  // which returns true once initialized=true
  context.resolveReady();

  // Phase B: Wait for watch program to be ready
  // NOTE: createWatchProgram is SYNCHRONOUS — it blocks the event loop for 3-8s.
  // The setImmediate inside createIncrementalProgram defers the blocking call by
  // one event loop tick, which allows any pending didOpen events (queued during
  // initialization) to be processed first and get Tier 1 treatment. The 3-8s block
  // is deferred, NOT eliminated — after the first tick, the event loop is blocked
  // until afterProgramCreate fires synchronously during the build.
  await project.watchProgramReady();
  context.watchProgramReady = true;
  if (log.enabled) log.info("Tier 2: full program ready");

  // Re-diagnose open files with full program (Tier 2)
  // NOTE: Tier 2 re-diagnosis must NOT include cross-file analysis — workspace
  // enrichment (file index, Tailwind, etc.) is not yet complete.
  const openPaths = getOpenDocumentPaths(context.documentState);
  for (let i = 0, len = openPaths.length; i < len; i++) {
    const p = openPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p, undefined, false);
  }

  // Phase C: Workspace enrichment (background)
  // rootPath is passed explicitly — enrichWorkspace must not use state.rootPath!
  await enrichWorkspace(rootPath, state, context);
  context.workspaceReady = true;
  if (log.enabled) log.info("Tier 3: workspace enrichment complete");

  // Re-diagnose with cross-file results (Tier 3)
  for (let i = 0, len = openPaths.length; i < len; i++) {
    const p = openPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p);
  }
}
```

### `enrichWorkspace` helper (NEW in lifecycle.ts)

```typescript
async function enrichWorkspace(
  rootPath: string,
  state: ServerState,
  context: ServerContext,
): Promise<void> {
  const log = context.log;

  // ESLint config is already loaded in Phase A (before resolveReady).
  // Here we only reload ignores and re-apply overrides if ESLint is enabled,
  // since Phase A only loaded overrides for Tier 1 diagnostic accuracy.
  if (state.useESLintConfig) {
    const eslintResult = await loadESLintConfig(rootPath, state.eslintConfigPath, log)
      .catch((err: unknown) => {
        if (log.enabled) log.warning(`Failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
        return EMPTY_ESLINT_RESULT;
      });
    state.eslintOverrides = eslintResult.overrides;
    state.eslintIgnores = eslintResult.globalIgnores;
    state.ruleOverrides = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
    state.project?.setRuleOverrides(state.ruleOverrides);
  }

  // File index
  const fileIndex = createFileIndex(rootPath, effectiveExclude(state), log);
  context.fileIndex = fileIndex;

  // Tailwind
  if (fileIndex.cssFiles.size > 0) {
    const cssFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
    context.tailwindValidator = await resolveTailwindValidator(cssFiles).catch(() => null);
  }

  // External custom properties
  const externalProps = scanDependencyCustomProperties(rootPath);
  if (externalProps.size > 0) {
    context.externalCustomProperties = externalProps;
  }
}
```

---

## `packages/lsp/src/core/project.ts` changes

Post-Phase 1, `Project` wraps `IncrementalTypeScriptService` for LSP. The service must expose a readiness signal.

Add to `Project` interface:

```typescript
export interface Project {
  // ... existing ...

  /** Resolves when the watch program's initial build completes.
   *  For BatchTypeScriptService (CLI), resolves immediately. */
  watchProgramReady(): Promise<void>
}
```

Implementation (LSP path using `IncrementalTypeScriptService`):

```typescript
watchProgramReady() {
  return tsService.ready();
},
```

Implementation (CLI path using `BatchTypeScriptService`):

```typescript
watchProgramReady() {
  return Promise.resolve();
},
```

**Architecture note**: Add a `mode: 'batch' | 'incremental'` parameter to `ProjectConfig`, or create separate factory functions: `createBatchProject()` for CLI/daemon, `createIncrementalProject()` for LSP. The `watchProgramReady()` method returns `Promise.resolve()` for batch mode.

---

## `packages/lsp/src/core/incremental-program.ts` changes

Add readiness signal to `IncrementalTypeScriptService`:

```typescript
export interface IncrementalTypeScriptService {
  // ... existing from Phase 1 ...
  ready(): Promise<void>
}
```

Implementation: the `createWatchProgram` callback fires `afterProgramCreate` on initial build. Wire a `Promise` + resolver.

**IMPORTANT**: `ts.createWatchProgram(host)` is synchronous — it blocks the event loop for 3-8s while building the initial program. The `afterProgramCreate` callback fires synchronously during this call, NOT asynchronously. To allow pending `didOpen` events to be processed with Tier 1 before the block, `createWatchProgram` is wrapped in `setImmediate`. The Tier 1→Tier 2 progression works like this:

1. `resolveReady()` fires immediately (in `handleInitialized` Phase A)
2. `setImmediate(() => { /* create watch program */ })` gives the event loop one tick
3. Any `didOpen` events queued during initialization get Tier 1 treatment
4. Then `createWatchProgram` blocks for 3-8s (unavoidable without worker thread)
5. `afterProgramCreate` fires synchronously during the build, resolving the ready promise

```typescript
export function createIncrementalProgram(rootPath: string): IncrementalTypeScriptService {
  let resolveReady: () => void;
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  let isReady = false;
  let watchProgram: ts.WatchOfConfigFile<ts.SemanticDiagnosticsBuilderProgram> | null = null;

  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);

  // ... setup host, overlay, etc. ...

  const host = ts.createWatchCompilerHost(
    tsconfigPath,
    { /* options */ },
    watchSystem,
    ts.createSemanticDiagnosticsBuilderProgram,
    /* reportDiagnostic */ undefined,
    /* reportWatchStatus */ undefined,
  );

  const origAfterProgramCreate = host.afterProgramCreate;
  host.afterProgramCreate = (program) => {
    origAfterProgramCreate?.(program);
    if (!isReady) {
      isReady = true;
      resolveReady();
    }
  };

  // Defer to allow event loop to process pending didOpen events.
  // createWatchProgram is SYNCHRONOUS and blocks for 3-8s.
  // afterProgramCreate fires synchronously during this call,
  // which calls resolveReady().
  setImmediate(() => {
    watchProgram = ts.createWatchProgram(host);
  });

  return {
    // ... existing methods ...
    ready() { return readyPromise; },
    // getProgram() must handle the case where watchProgram is not yet created
    getProgram() {
      if (!watchProgram) return null;
      const bp = watchProgram.getProgram();
      return bp.getProgram();
    },
  };
}
```

---

## Feature handler behavior during Tier 1

Feature handlers (definition, hover, completion, etc.) are gated by `isServerReady()` which checks `state.initialized`. With the restructured `handleInitialized`, `state.initialized = true` fires early (Phase A), so feature handlers can execute.

However, during Tier 1, the `HandlerContext` methods need the project's language service:
- `getLanguageService(path)` — needs the full program
- `getSourceFile(path)` — needs the full program
- `getSolidGraph(path)` — needs a graph build

During Tier 1, these return `null` because the watch program isn't ready. Feature handlers receive `null` and return their fallback values. This is correct — definition, hover, etc. degrade gracefully to "no result" until the full program is available.

Only diagnostics need the Tier 1 fast path. All other features can wait for Tier 2.

To prevent feature handlers from returning stale results during Tier 1, add a check:

```typescript
function createGuardedHandler<P, R>(
  getCtx: () => HandlerContext | null,
  isReady: () => boolean,
  // ...
): (params: P) => R {
  return (params: P): R => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return fallback;
    // ...
  };
}
```

No change needed — `isReady()` returns `true` (initialized), `ctx` exists (project is set). But the handler methods (`getLanguageService`, etc.) return `null` until the watch program builds. Handlers already handle `null` returns, so no new code is needed.

---

## `didChange` during Tier 1

If the user edits a file before the full program is ready:

1. The debounce timer fires
2. `processChangesCallback` calls `publishFileDiagnostics`
3. `publishFileDiagnostics` calls `runSingleFileDiagnostics`
4. `runSingleFileDiagnostics` calls `project.getProgram()` → returns `null` (program not built yet)

Current code falls through to `project.run([key])` which also fails without a program.

Fix: during Tier 1, `processChangesCallback` should use `publishTier1Diagnostics` instead:

```typescript
function processChangesCallback(): void {
  // ... existing eviction logic ...

  if (!context.watchProgramReady) {
    // Tier 1: use single-file programs for changed files
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      if (classifyFile(change.path) === "solid") {
        publishTier1Diagnostics(context, change.path, change.content);
      }
    }
    return;
  }

  // ... existing Tier 2/3 processing ...
}
```

---

## Timing expectations

| Event | Time from startup | What happens |
|-------|------------------|-------------|
| `initialize` | 0ms | Capabilities negotiated |
| `initialized` Phase A | ~10ms | Project created, `resolveReady()` fires |
| `didOpen` (first file) | ~20ms | Tier 1: single-file `ts.createProgram` + ganko analysis |
| Tier 1 diagnostics published | ~70-120ms | User sees first squiggles |
| Watch program ready (Phase B) | 3-8s | Tier 2: re-diagnose open files with full program |
| Workspace enrichment (Phase C) | 5-10s | Tier 3: cross-file diagnostics added |

---

## Tier 1 accuracy

The Tier 1 single-file program resolves imports from `node_modules` (solid-js types are available). Types from other project files are NOT available — the Tier 1 TypeChecker resolves imported symbols to `any` when the exporting file isn't in the program.

This means:
- Rules checking `solid-js` API usage (signal-call, reactivity rules) work correctly
- Rules checking intra-project types (cross-module type flow) may miss issues or produce false positives
- JSX structure rules work correctly (JSX syntax is fully parsed)

When Tier 2 fires, diagnostics are republished with full type resolution. The transient Tier 1 inaccuracies are replaced. Users may see diagnostics appear, disappear, or change severity — this matches the behavior of TypeScript's own "partial" mode in VS Code.

**Cross-module type resolution caveat**: During Tier 1, imported symbols from other project files may resolve to `ts.TypeFlags.Unknown` rather than `any`, depending on `moduleResolution` settings. Type-aware rules that depend on cross-module type resolution (e.g., `show-truthy-conversion` checking `boolean | Signal<boolean>`) may produce false positives. Only `node_modules` types (solid-js, DOM) are reliably resolved in Tier 1. Set `compilerOptions.noResolve = false` (already default) to ensure imports are followed.

---

## Verification

1. **Tier 1 timing**: Open a SolidJS file in VS Code. Measure time from `didOpen` to first `publishDiagnostics`. Target: <100ms.
2. **Tier 2 re-diagnosis**: Verify diagnostics change after 3-8s as full program types resolve. Check log for "Tier 2: full program ready" + subsequent `publishFileDiagnostics` calls.
3. **Tier 3 cross-file**: Verify cross-file diagnostics appear after workspace enrichment. Check log for "Tier 3: workspace enrichment complete".
4. **Editing during Tier 1**: Type in a file before full program is ready. Verify debounced diagnostics still appear (via Tier 1 path).
5. **Feature handlers during Tier 1**: Hover over a symbol before full program is ready. Should return "no result" (no crash). After Tier 2, hover works.
6. **No typeless mode**: Verify every `SolidInput` has a non-null `checker`. No code path skips type-aware rules.
