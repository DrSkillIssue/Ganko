# TypeScript Diagnostic Push — Implementation Plan

## Goal

Push TypeScript syntactic and semantic diagnostics alongside ganko's own diagnostics through ganko's existing tiered LSP architecture. No `tsserver` wrapper — build directly on the `ts.LanguageService` ganko already owns. The editor sees one unified diagnostic list per file with `source: "ganko"` for ganko diagnostics and `source: "ts"` for TypeScript diagnostics.

---

## Why

TypeScript's `tsserver` uses a pull-based diagnostic model — the editor requests diagnostics, and `tsserver` responds. This means:

1. Diagnostics for file B don't update when file A (which B imports) changes, until B is focused
2. Stale diagnostics persist in inactive tabs until the editor polls
3. Structural changes (adding/removing exports) require a full project re-check that `tsserver` defers lazily

Ganko's LSP already owns a `ts.LanguageService` (via `IncrementalTypeScriptService`) that tracks the full project. The `LanguageService` exposes `getSyntacticDiagnostics(fileName)` and `getSemanticDiagnostics(fileName)`. These methods are never called anywhere in the current codebase. The `LanguageService` uses a plain `ts.Program` internally — each `getSemanticDiagnostics` call runs the per-file diagnostic AST walk (no per-file cache; only `BuilderProgram` has that). But the type checker reuses resolved type information within a single program instance, and the cost per file (~5-50ms) is manageable with async scheduling. Wiring these into ganko's push-based tiered architecture gives us proactive TypeScript diagnostics using the program ganko already owns.

---

## How — Architecture Integration

### Existing Tiered Architecture

Ganko's LSP uses three-phase startup with progressive diagnostic delivery:

| Phase | Trigger | What fires | Ganko diagnostics |
|-------|---------|-----------|-------------------|
| A | `initialized` | ESLint config, Project creation, ready gate | Tier 1: single-file (no type checker) |
| B | `watchProgramReady` | Full `ts.Program` built | Tier 2: single-file with full type checker |
| C | `enrichWorkspace` | File index, Tailwind, external props | Tier 3: cross-file (layout graph, CSS graph) |

### Where TypeScript Diagnostics Slot In

| Tier | When | TS diagnostics | Cost | Why this tier |
|------|------|---------------|------|---------------|
| 1 | Pre-program (keystroke during startup) | `getSyntacticDiagnostics` only | ~0.5ms | Syntactic errors (missing brackets, invalid syntax) are AST-only — no type checker needed. The Tier 1 single-file `ts.Program` can produce these instantly. Semantic diagnostics would be incomplete (cross-module types resolve to `any`), producing false positives. |
| 2 | Post-program (debounce settles) | Syntactic + semantic for changed file | ~5-50ms | The full `LanguageService` is available. `getSemanticDiagnostics` for a single file runs the type checker's per-file diagnostic AST walk. First call after a program rebuild is ~50ms; the cost depends on file complexity. |
| 3 | Post-debounce propagation | Semantic for all open files (async) | ~5-50ms per file | TypeScript's `LanguageService` wraps a plain `ts.Program` with no per-file diagnostic cache (only `BuilderProgram` has that). Each `getSemanticDiagnostics` call runs the full per-file AST walk. Phase 5 uses a `setImmediate`-based async loop to avoid blocking the event loop, yielding between files so keystrokes are processed. Cancellable if a new debounce fires. |

---

## Critical Constraint: `sendDiagnostics` Is Full-Replace

LSP's `textDocument/publishDiagnostics` replaces ALL diagnostics for a URI with the new array. This means TypeScript diagnostics **must** be included in every `sendDiagnostics` call alongside ganko diagnostics. If we publish ganko diagnostics alone, any previously-published TS diagnostics for that file are wiped.

Three functions in `connection.ts` call `sendDiagnostics`:
- `publishFileDiagnostics` (line 1139) — Tier 2/3 main path
- `publishTier1Diagnostics` (line 1076) — Tier 1 startup path
- `republishMergedDiagnostics` (line 1175) — cross-file cache refresh path

All three must merge TS diagnostics into their output.

---

## Detailed Implementation

### 1. Settings Schema — `enableTypeScriptDiagnostics`

**File: `packages/shared/src/config.ts`**

Add to `ServerSettings` interface (line 41):
```typescript
export interface ServerSettings {
  // ... existing fields ...
  readonly enableTypeScriptDiagnostics: boolean
}
```

Add to `ServerSettingsSchema` (line 57):
```typescript
export const ServerSettingsSchema = z.object({
  // ... existing fields ...
  enableTypeScriptDiagnostics: z.boolean().default(false),
})
```

**Why default `false`:** Most VS Code users already have the built-in TypeScript extension providing diagnostics. Enabling TS diagnostics in ganko by default would show duplicates. Users who disable the built-in TS extension (or use a different editor) can opt in.

---

### 2. VS Code Extension Setting

**File: `packages/vscode/package.json`**

Add under `contributes.configuration.properties`:
```json
"solid.enableTypeScriptDiagnostics": {
  "type": "boolean",
  "default": false,
  "description": "Push TypeScript diagnostics alongside ganko diagnostics. Disable VS Code's built-in TypeScript extension to avoid duplicates."
}
```

**File: `packages/vscode/src/config.ts`**

In `getInitializationOptions` (line 31), add:
```typescript
enableTypeScriptDiagnostics: config.get<boolean>("enableTypeScriptDiagnostics", false),
```

No changes needed to `registerConfigHandler` (line 55) — it already forwards the full settings object to the server via `workspace/didChangeConfiguration`.

---

### 3. Server State Threading

**File: `packages/lsp/src/server/handlers/lifecycle.ts`**

Add to `ServerState` interface (line 32):
```typescript
enableTsDiagnostics: boolean
```

Initialize in `createServerState()` (line 66):
```typescript
enableTsDiagnostics: false,
```

In `handleInitialize` (line 96), after existing option extraction:
```typescript
state.enableTsDiagnostics = options?.enableTypeScriptDiagnostics ?? false;
```

In `handleConfigurationChange` (line 363), the existing return type `ConfigChangeResult` is a flat string union (`"none" | "rediagnose" | "reload-eslint" | "rebuild-index"`). This collapses multiple independent actions into a single winner — if ESLint settings and the TS toggle both change in the same update, only `"reload-eslint"` propagates. The caller handles ESLint reload but silently drops the TS rediagnosis if ESLint overrides/ignores didn't actually change (line 683 early return in `connection.ts`).

Replace `ConfigChangeResult` with a structured result that captures all required actions independently:

```typescript
export interface ConfigChangeResult {
  readonly rebuildIndex: boolean
  readonly reloadEslint: boolean
  readonly rediagnose: boolean
}

const NO_CHANGE: ConfigChangeResult = { rebuildIndex: false, reloadEslint: false, rediagnose: false };
```

Rewrite `handleConfigurationChange`:
```typescript
export function handleConfigurationChange(
  payload: ConfigurationChangePayload,
  state: ServerState,
): ConfigChangeResult {
  const settings = payload?.settings?.solid;
  if (!settings) return NO_CHANGE;

  const eslintSettingChanged =
    settings.useESLintConfig !== state.useESLintConfig ||
    settings.eslintConfigPath !== state.eslintConfigPath;

  const excludeChanged = !arraysEqual(settings.exclude ?? [], state.exclude);
  const tsDiagsChanged = (settings.enableTypeScriptDiagnostics ?? false) !== state.enableTsDiagnostics;

  // Unconditional state updates — all fields mutated regardless of which actions fire
  state.vscodeOverrides = settings.rules;
  state.useESLintConfig = settings.useESLintConfig;
  state.eslintConfigPath = settings.eslintConfigPath;
  state.exclude = settings.exclude ?? [];
  state.enableTsDiagnostics = settings.enableTypeScriptDiagnostics ?? false;
  setActivePolicy(settings.accessibilityPolicy);

  const next = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
  const overridesChanged = applyOverridesIfChanged(state, next);

  return {
    rebuildIndex: excludeChanged,
    reloadEslint: eslintSettingChanged,
    rediagnose: overridesChanged || tsDiagsChanged,
  };
}
```

Update the caller in `connection.ts` (line 664) to handle the structured result:
```typescript
const result = handleConfigurationChange(params, serverState);
if (!result.rebuildIndex && !result.reloadEslint && !result.rediagnose) return;

let needRediagnose = result.rediagnose || result.rebuildIndex;

if (result.rebuildIndex && serverState.rootPath) {
  const excludes = effectiveExclude(serverState);
  context.fileIndex = createFileIndex(serverState.rootPath, excludes, context.log);
}

if (result.reloadEslint) {
  const outcome = await reloadESLintConfig(serverState, context.log);
  if (outcome.ignoresChanged && serverState.rootPath) {
    context.fileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
  }
  if (outcome.overridesChanged || outcome.ignoresChanged) needRediagnose = true;
}

if (needRediagnose) context.rediagnoseAll();
```

This eliminates the class of bugs where independent configuration changes interfere through the early-return cascade. Every field is always updated. Every action is always evaluated. The caller tracks whether actual rediagnosis is needed — an ESLint reload that finds no changes does not trigger a wasteful `rediagnoseAll`.

---

### 4. New File: `ts-diagnostics.ts`

**New file: `packages/lsp/src/server/handlers/ts-diagnostics.ts`**

This file contains the TS-to-LSP diagnostic converter and collection utilities.

#### `convertTsDiagnostic` — Single `ts.Diagnostic` → LSP `Diagnostic`

```typescript
import ts from "typescript";
import type {
  Diagnostic as LSPDiagnostic,
  DiagnosticRelatedInformation as LSPRelatedInfo,
} from "vscode-languageserver";
import { DiagnosticSeverity } from "vscode-languageserver";
import { pathToUri } from "@drskillissue/ganko-shared";

function tsCategoryToSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error: return DiagnosticSeverity.Error;
    case ts.DiagnosticCategory.Warning: return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Suggestion: return DiagnosticSeverity.Hint;
    case ts.DiagnosticCategory.Message: return DiagnosticSeverity.Information;
    default: return DiagnosticSeverity.Error;
  }
}

export function convertTsDiagnostic(d: ts.Diagnostic): LSPDiagnostic | null {
  // Global diagnostics (no source file) have no location — skip
  if (d.file === undefined || d.start === undefined || d.length === undefined) return null;

  const file = d.file;
  const start = file.getLineAndCharacterOfPosition(d.start);
  const end = file.getLineAndCharacterOfPosition(d.start + d.length);

  const result: LSPDiagnostic = {
    range: {
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
    },
    severity: tsCategoryToSeverity(d.category),
    code: d.code,
    source: "ts",
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  };

  // Preserve related information (e.g., "Did you mean 'foo'?" with a pointer to the definition)
  if (d.relatedInformation !== undefined && d.relatedInformation.length > 0) {
    const related: LSPRelatedInfo[] = [];
    for (let i = 0, len = d.relatedInformation.length; i < len; i++) {
      const ri = d.relatedInformation[i];
      if (!ri || ri.file === undefined || ri.start === undefined || ri.length === undefined) continue;
      const riStart = ri.file.getLineAndCharacterOfPosition(ri.start);
      const riEnd = ri.file.getLineAndCharacterOfPosition(ri.start + ri.length);
      related.push({
        location: {
          uri: pathToUri(ri.file.fileName),
          range: {
            start: { line: riStart.line, character: riStart.character },
            end: { line: riEnd.line, character: riEnd.character },
          },
        },
        message: ts.flattenDiagnosticMessageText(ri.messageText, "\n"),
      });
    }
    if (related.length > 0) result.relatedInformation = related;
  }

  return result;
}
```

**Why `source: "ts"` instead of `source: "typescript"`:** Concise, matches convention. The editor uses `source` for filtering — users can distinguish ganko rules from TS errors at a glance.

**Why skip global diagnostics:** Global diagnostics (e.g., "Cannot find module 'react'") have no source file or position. They can't be attributed to a URI. LSP has no mechanism for file-less diagnostics.

#### `collectTsDiagnosticsForFile` — Syntactic + semantic for one file

```typescript
export function collectTsDiagnosticsForFile(
  ls: ts.LanguageService,
  fileName: string,
  includeSemantic: boolean,
): LSPDiagnostic[] {
  const result: LSPDiagnostic[] = [];

  const syntactic = ls.getSyntacticDiagnostics(fileName);
  for (let i = 0, len = syntactic.length; i < len; i++) {
    const d = syntactic[i];
    if (!d) continue;
    const converted = convertTsDiagnostic(d);
    if (converted !== null) result.push(converted);
  }

  if (includeSemantic) {
    const semantic = ls.getSemanticDiagnostics(fileName);
    for (let i = 0, len = semantic.length; i < len; i++) {
      const d = semantic[i];
      if (!d) continue;
      // Filter compiler-option diagnostics (codes 5000-5999). These report
      // things like "Cannot write file 'foo.js' because it would overwrite
      // input file" which are irrelevant for an LSP that never emits output.
      // Do NOT filter 6000-6999 — that range includes useful diagnostics
      // like 6133 "declared but never read" and 6192 "unused imports".
      if (d.code >= 5000 && d.code < 6000) continue;
      const converted = convertTsDiagnostic(d);
      if (converted !== null) result.push(converted);
    }
  }

  return result;
}
```

**Why `includeSemantic` parameter:** Tier 1 calls this with `false` (syntactic only). Tier 2+ calls with `true`. Single function, two modes.

#### `tsDiagsEqual` — Shallow equality check for republish gating

```typescript
export function tsDiagsEqual(
  a: readonly LSPDiagnostic[] | undefined,
  b: readonly LSPDiagnostic[],
): boolean {
  if (a === undefined) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) {
    const da = a[i];
    const db = b[i];
    if (!da || !db) return false;
    if (da.code !== db.code) return false;
    if (da.severity !== db.severity) return false;
    if (da.message !== db.message) return false;
    if (da.range.start.line !== db.range.start.line) return false;
    if (da.range.start.character !== db.range.start.character) return false;
    if (da.range.end.line !== db.range.end.line) return false;
    if (da.range.end.character !== db.range.end.character) return false;
  }
  return true;
}
```

**Why compare `message`:** Same diagnostic code + position can have different messages when a dependency's type changes (e.g., "Type 'string' is not assignable to type 'number'" becomes "...to type 'boolean'"). Without `message` comparison, the stale message persists until something else triggers a republish.

---

### 5. TS Diagnostic Cache on ServerContext

**File: `packages/lsp/src/server/connection.ts`**

Add to `ServerContext` interface (line 267):
```typescript
/** Cache of TypeScript diagnostics (already in LSP format) per file.
 *  Separate from diagCache which stores ganko's internal Diagnostic type. */
readonly tsDiagCache: Map<string, readonly LSPDiagnostic[]>
/** Cancellation handle for in-flight Phase 5 async propagation.
 *  Called before starting a new propagation cycle and during shutdown. */
tsPropagationCancel: (() => void) | null
```

In `createServer` (line 403), initialize alongside `diagCache`:
```typescript
const tsDiagCache = new Map<string, readonly LSPDiagnostic[]>();
```

Add to the context object literal:
```typescript
tsDiagCache,
```

**Why a separate cache:** `diagCache` stores ganko's internal `Diagnostic` type (with `loc`, `rule`, `messageId`). TS diagnostics are `ts.Diagnostic` with a completely different shape (`start`, `length`, `messageText`, `category`). Rather than creating an adapter type that bloats both pipelines, we cache already-converted `LSPDiagnostic[]` and merge at the publication boundary. This keeps the ganko diagnostic pipeline untouched.

When setting TS diagnostic cache entries, only store non-empty results to avoid unbounded memory growth from files with zero diagnostics:
```typescript
// Use throughout — stores only non-empty, deletes on empty
if (tsDiags.length > 0) {
  context.tsDiagCache.set(key, tsDiags);
} else {
  context.tsDiagCache.delete(key);
}
```

Update `evictFileCache` (line 328) to also clear TS cache:
```typescript
evictFileCache(path) {
  const key = canonicalPath(path);
  diagCache.delete(key);
  tsDiagCache.delete(key);  // NEW
  graphCache.invalidate(key);
},
```

Update `rediagnoseAll` to accept an optional flag indicating whether TS cache should be cleared:
```typescript
rediagnoseAll(clearTsCache = false) {
  diagCache.clear();
  if (clearTsCache) tsDiagCache.clear();
  // ... existing rediagnose logic (publishFileDiagnostics per open file) ...
  // publishFileDiagnostics with content=undefined merges cached TS diags.
  // When clearTsCache is false, cached TS diags are preserved — no flicker
  // during non-TS rediagnosis (rule overrides, ESLint config).
  // When clearTsCache is true (TS toggle changed), the cache is cleared to
  // prevent stale diagnostics from a previous toggle state. Consider:
  // toggle ON → user edits files → toggle OFF → user edits more → toggle ON.
  // Without clearing, the cache serves stale diagnostics from the first ON
  // period. propagateTsDiagnostics then refills with fresh results.
  if (context.project) {
    propagateTsDiagnostics(context, context.project, new Set());
  }
},
```

The caller in `connection.ts` passes `clearTsCache: true` when the TS toggle changed:
```typescript
if (needRediagnose) context.rediagnoseAll(result.rediagnose);
```
`result.rediagnose` is true when `overridesChanged || tsDiagsChanged`. This is a superset of `tsDiagsChanged` — it also clears TS cache on pure override changes. This is acceptable: override changes are infrequent, and the flicker is brief (~200ms until `propagateTsDiagnostics` refills). The alternative (threading `tsDiagsChanged` separately) adds complexity for a negligible UX difference.

---

### 6. Integration Point: `publishFileDiagnostics`

**File: `packages/lsp/src/server/connection.ts`, line 1095**

After the existing ganko diagnostic merge (line 1121-1123) and before the `sendDiagnostics` call (line 1139):

```typescript
const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;
context.diagCache.set(key, rawDiagnostics);
const diagnostics = convertDiagnostics(rawDiagnostics);

// NEW: Merge TypeScript diagnostics (only for TS-compatible files).
// Only collect FRESH TS diagnostics when the file itself was edited (content
// parameter provided) or opened (didOpen). When publishFileDiagnostics is
// called from rediagnoseAffected (cross-file deps changed but the file's own
// source didn't change), use cached TS diagnostics. This avoids synchronous
// getSemanticDiagnostics calls for every affected file (~50ms each).
if (context.serverState.enableTsDiagnostics && context.watchProgramReady && kind === "solid") {
  let tsDiags: readonly LSPDiagnostic[];
  if (content !== undefined) {
    // File was edited — collect fresh TS diagnostics
    const ls = project.getLanguageService();
    tsDiags = collectTsDiagnosticsForFile(ls, key, /* includeSemantic */ true);
    if (tsDiags.length > 0) {
      context.tsDiagCache.set(key, tsDiags);
    } else {
      context.tsDiagCache.delete(key);
    }
  } else {
    // Cross-file rediagnosis or didSave without content — use cached
    tsDiags = context.tsDiagCache.get(key) ?? [];
  }
  for (let i = 0, len = tsDiags.length; i < len; i++) {
    const td = tsDiags[i];
    if (td) diagnostics.push(td);
  }
}

// ... existing sendDiagnostics call ...
```

**Why after `convertDiagnostics`:** Ganko diagnostics go through `convertDiagnostics` (ganko format → LSP format). TS diagnostics are already in LSP format from `collectTsDiagnosticsForFile`. Both end up as `LSPDiagnostic[]` ready for `sendDiagnostics`.

**Why `watchProgramReady` guard:** Before Phase B, the `LanguageService` hasn't built the program yet. `getSemanticDiagnostics` would trigger a synchronous full build, blocking the event loop for 3-8s during startup. The guard ensures TS diagnostics only fire after the program is available.

---

### 7. Integration Point: `publishTier1Diagnostics`

**File: `packages/lsp/src/server/connection.ts`, line 1012**

Tier 1 creates a single-file `ts.Program` for instant ganko diagnostics during startup. This program has `getSyntacticDiagnostics(sourceFile)` available (AST-only, no type checker).

After line 1070 (`const converted = convertDiagnostics(diagnostics)`) and before line 1074 (`const params`):

```typescript
// NEW: Merge syntactic-only TS diagnostics for Tier 1
// tier1 is the Tier1Result from createTier1Program (line 1048)
// converted is the LSPDiagnostic[] from convertDiagnostics (line 1070)
if (context.serverState.enableTsDiagnostics) {
  const syntactic = tier1.program.getSyntacticDiagnostics(tier1.sourceFile);
  for (let i = 0, len = syntactic.length; i < len; i++) {
    const d = syntactic[i];
    if (!d) continue;
    const lspDiag = convertTsDiagnostic(d);
    if (lspDiag !== null) converted.push(lspDiag);
  }
}
```

**Why syntactic only:** The Tier 1 program contains a single file. Cross-module types resolve to `any`. `getSemanticDiagnostics` would produce false positives (e.g., "Cannot find module './types'" because the single-file program doesn't include `./types.ts`). Syntactic diagnostics (missing brackets, invalid syntax, malformed imports) are safe because they're AST-only.

**Why no `tsDiagCache` update:** Tier 1 diagnostics are ephemeral — they're replaced by Tier 2 diagnostics after Phase B. No point caching.

---

### 8. Integration Point: `republishMergedDiagnostics`

**File: `packages/lsp/src/server/connection.ts`, line 1155**

This function merges cached single-file ganko diagnostics with fresh cross-file ganko diagnostics after a cache refresh. It must also include TS diagnostics.

The existing function has an early return `if (crossFile.length === 0) return` that must be modified — without TS diagnostics in the check, files with zero cross-file ganko diagnostics but non-empty TS diagnostics would silently drop their TS diagnostics on republish (since `sendDiagnostics` is full-replace):

```typescript
function republishMergedDiagnostics(context: ServerContext, path: string): void {
  const key = canonicalPath(path);
  const crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
  const hasTsDiags = context.serverState.enableTsDiagnostics && context.tsDiagCache.has(key);

  // Only bail if BOTH cross-file ganko and TS diagnostics are empty
  if (crossFile.length === 0 && !hasTsDiags) return;

  const singleFile = context.diagCache.get(key);
  if (singleFile === undefined) return;

  const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;
  context.diagCache.set(key, rawDiagnostics);
  const diagnostics = convertDiagnostics(rawDiagnostics);

  // Merge cached TS diagnostics
  if (hasTsDiags) {
    const tsDiags = context.tsDiagCache.get(key);
    if (tsDiags !== undefined) {
      for (let i = 0, len = tsDiags.length; i < len; i++) {
        const td = tsDiags[i];
        if (td) diagnostics.push(td);
      }
    }
  }

  // ... existing sendDiagnostics call ...
}
```

**Why cached (not fresh):** `republishMergedDiagnostics` is called during the cross-file refresh flow to update files whose ganko cross-file diagnostics changed. The TS diagnostics for these files haven't changed (no source edit) — reusing the cache avoids redundant `getSemanticDiagnostics` calls.

---

### 9. Integration Point: `processChangesCallback` — Phase 5

**File: `packages/lsp/src/server/connection.ts`, line 705**

After the existing Phase 4 (republish merged diagnostics for changed files), add Phase 5 to propagate TS diagnostic changes to dependent open files.

`ts.LanguageService` wraps a plain `ts.Program`, not a `BuilderProgram`. A plain program has no per-file diagnostic cache — each `getSemanticDiagnostics` call runs the full per-file AST diagnostic walk (~5-50ms per file). Running this synchronously for all open files would block the event loop for 50-500ms+, stalling keystrokes.

The solution: a `setImmediate`-based async loop that yields between files, cancelled immediately on keystroke. Cancellation must fire in `onDidChangeContent` (line 803) — not in `processChangesCallback` (which only fires after the debounce delay). Without this, a keystroke during Phase 5 triggers `synchronizeHostData()` inside the next `getSemanticDiagnostics` call, causing a ~200ms blocking program rebuild before the debounce timer fires and cancels the loop.

In `onDidChangeContent` (line 803), after queuing the change and before setting the debounce timer:
```typescript
context.tsPropagationCancel?.();
```

This ensures Phase 5 is aborted within one `setImmediate` tick of any keystroke, before the `LanguageService` sees the version bump.

Add `tsPropagationCancel` to `ServerContext`:
```typescript
tsPropagationCancel: (() => void) | null
```

Phase 5 implementation:
```typescript
if (context.serverState.enableTsDiagnostics && context.watchProgramReady && project) {
  const ls = project.getLanguageService();
  const allOpen = getOpenDocumentPaths(context.documentState).filter(p =>
    p !== undefined && !diagnosed.has(p) && classifyFile(p) === "solid"
  );

  let cancelled = false;
  context.tsPropagationCancel?.();
  context.tsPropagationCancel = () => { cancelled = true; };

  (async () => {
    for (let i = 0; i < allOpen.length; i++) {
      if (cancelled) break;
      await new Promise<void>(resolve => setImmediate(resolve));
      if (cancelled) break;

      const p = allOpen[i]!;
      const tsDiags = collectTsDiagnosticsForFile(ls, p, true);
      const prev = context.tsDiagCache.get(p);
      if (!tsDiagsEqual(prev, tsDiags)) {
        if (tsDiags.length > 0) {
          context.tsDiagCache.set(p, tsDiags);
        } else {
          context.tsDiagCache.delete(p);
        }
        republishMergedDiagnostics(context, p);
      }
    }
    context.tsPropagationCancel = null;
  })();
}
```

**Why `classifyFile(p) === "solid"`:** `getOpenDocumentPaths` returns all open documents including CSS files. Calling `getSemanticDiagnostics` on a `.css` file wastes the `synchronizeHostData()` call and returns empty. The `"solid"` classification covers `.ts`, `.tsx`, `.js`, `.jsx` — exactly the files in the TypeScript program's root names.

**Why `setImmediate` between files:** Each `getSemanticDiagnostics` call is ~5-50ms. Yielding between files lets the event loop process incoming LSP messages (keystrokes, completion requests). Without this, 10 open files × 20ms = 200ms of unresponsive editor.

**Why cancellable:** If the user types again during Phase 5, the debounce callback fires again. The previous Phase 5 loop is cancelled — its work is stale and will be superseded by the new cycle's Phase 5.

**Why `diagnosed.has(p)` filter:** Files already published in Phase 2 of the debounce callback already have fresh TS diagnostics from `publishFileDiagnostics`. Re-collecting would be redundant.

**Performance:** 10 open files × ~20ms each = ~200ms total, but non-blocking (interleaved with event loop ticks). Unaffected files still take ~5-50ms because the type checker is fresh after a program rebuild — there is no per-file diagnostic cache on a plain `ts.Program`. The `tsDiagsEqual` check prevents unnecessary `sendDiagnostics` calls, not unnecessary type-checking.

Extract the async propagation loop into a reusable `propagateTsDiagnostics` function:

```typescript
/**
 * Propagate TS diagnostic changes to open files that weren't directly edited.
 * Async — yields between files via setImmediate. Cancellable.
 */
function propagateTsDiagnostics(
  context: ServerContext,
  project: Project,
  exclude: ReadonlySet<string>,
): void {
  if (!context.serverState.enableTsDiagnostics || !context.watchProgramReady) return;

  const ls = project.getLanguageService();
  const allOpen = getOpenDocumentPaths(context.documentState).filter(p =>
    p !== undefined && !exclude.has(p) && classifyFile(p) === "solid"
  );
  if (allOpen.length === 0) return;

  let cancelled = false;
  context.tsPropagationCancel?.();
  context.tsPropagationCancel = () => { cancelled = true; };

  (async () => {
    for (let i = 0; i < allOpen.length; i++) {
      if (cancelled) break;
      await new Promise<void>(resolve => setImmediate(resolve));
      if (cancelled) break;

      const p = allOpen[i]!;
      const tsDiags = collectTsDiagnosticsForFile(ls, p, true);
      const prev = context.tsDiagCache.get(p);
      if (!tsDiagsEqual(prev, tsDiags)) {
        if (tsDiags.length > 0) {
          context.tsDiagCache.set(p, tsDiags);
        } else {
          context.tsDiagCache.delete(p);
        }
        republishMergedDiagnostics(context, p);
      }
    }
    context.tsPropagationCancel = null;
  })();
}
```

Call sites:
- **`handleInitialized`** (line 159): `propagateTsDiagnostics(context, project, new Set())` after the Phase C re-diagnosis loop (line 248). Without this, TS diagnostics are never populated on startup — the user would see ganko diagnostics but no TS errors until their first edit.
- **`processChangesCallback`** (line 705): `propagateTsDiagnostics(context, project, diagnosed)` after Phase 4
- **`onDidSave`** (line 818): `propagateTsDiagnostics(context, project, new Set([savedPath]))` after `publishFileDiagnostics` and `rediagnoseAffected`
- **`onDidChangeWatchedFiles`** (line 564): `propagateTsDiagnostics(context, project, new Set())` after `rediagnoseAffected`

This ensures TS diagnostic propagation happens on all four mutation paths: startup, typing (debounce), saving, and external file changes. The `exclude` parameter prevents re-collecting for files that already got fresh TS diagnostics from `publishFileDiagnostics` in the same cycle.

---

### 10. Handle `onDidClose` — Clear TS Cache

**File: `packages/lsp/src/server/connection.ts`**

In the `onDidClose` handler (line 894), after clearing ganko diagnostics:
```typescript
context.tsDiagCache.delete(key);
```

This prevents stale TS diagnostics from being merged if the file is re-opened.

---

### 11. Handle Shutdown — Cancel Async Propagation

**File: `packages/lsp/src/server/handlers/lifecycle.ts`**

In `handleShutdown` (line 292), before disposing the project:
```typescript
context?.tsPropagationCancel?.();
context.tsPropagationCancel = null;
```

Without this, an in-flight Phase 5 async loop continues running after shutdown. The loop captured the `project` parameter by reference — it would call `project.getLanguageService()` on a disposed `LanguageService`, throwing exceptions. Cancelling before disposal ensures the loop exits cleanly on its next `setImmediate` yield.

---

## Files Summary

| File | Type | Changes |
|------|------|---------|
| `packages/shared/src/config.ts` | Modify | Add `enableTypeScriptDiagnostics` to `ServerSettings` interface + `ServerSettingsSchema` |
| `packages/lsp/src/server/handlers/ts-diagnostics.ts` | **New** | `convertTsDiagnostic`, `collectTsDiagnosticsForFile`, `tsDiagsEqual` |
| `packages/lsp/src/server/connection.ts` | Modify | `ServerContext` + `tsDiagCache`, merge in `publishFileDiagnostics`, `publishTier1Diagnostics`, `republishMergedDiagnostics`, Phase 5 in `processChangesCallback`, clear in `evictFileCache`/`rediagnoseAll`/`onDidClose` |
| `packages/lsp/src/server/handlers/lifecycle.ts` | Modify | `ServerState.enableTsDiagnostics`, `handleInitialize`, `handleConfigurationChange` |
| `packages/vscode/package.json` | Modify | Add `solid.enableTypeScriptDiagnostics` setting |
| `packages/vscode/src/config.ts` | Modify | Read `enableTypeScriptDiagnostics` in `getInitializationOptions` |

---

## Performance Profile

| Operation | Cost | When | Blocking? |
|-----------|------|------|-----------|
| `getSyntacticDiagnostics` (Tier 1) | ~0.5ms | Keystroke during startup | Yes (negligible) |
| `getSemanticDiagnostics` changed file (Tier 2) | ~5-50ms | Debounce settles | Yes (acceptable — within debounce) |
| `getSemanticDiagnostics` per file (Phase 5) | ~5-50ms each | Post-debounce propagation | No — `setImmediate` yields between files |
| `tsDiagsEqual` comparison | ~0.01ms | Phase 5 per file | No |
| `convertTsDiagnostic` per diagnostic | ~0.005ms | All tiers | No |

**Tier 2 (synchronous):** 1 changed file at 5-50ms. Runs on the debounce callback alongside ganko diagnostics. Acceptable.

**Phase 5 (async):** N open files × 5-50ms each. Non-blocking — each file gets its own event loop tick via `setImmediate`. For 10 open files at ~20ms each, total wall time ~200ms but the editor remains responsive throughout. Cancellable if the user types again.

---

## Design Decisions

**Why not `SemanticDiagnosticsBuilderProgram`?**

`BuilderProgram` has `getSemanticDiagnosticsOfNextAffectedFile()` which yields only affected files AND caches per-file diagnostic results (`semanticDiagnosticsPerFile`). This would make Phase 5 genuinely O(1) for unaffected files instead of O(file-size). However, the existing `IncrementalTypeScriptService` wraps `ts.createLanguageService`, which uses a plain `ts.Program` internally. A plain program has no per-file diagnostic cache — each `getSemanticDiagnostics` call runs the full AST walk.

Switching to `BuilderProgram` would require restructuring `IncrementalTypeScriptService` to maintain a `ts.createIncrementalProgram` alongside the `LanguageService` (the `LanguageService` is still needed for completions, hover, go-to-definition, etc.). This is the correct long-term architecture but is a larger change. For v1, the `setImmediate`-based async loop with cancellation is sufficient — Phase 5 runs non-blocking and is cancelled when superseded by new edits.

**Why a separate `tsDiagCache` instead of mixing into `diagCache`?**

`diagCache` stores ganko's internal `Diagnostic` type (with `file`, `rule`, `messageId`, `loc`, `severity`). TS diagnostics have a completely different shape (`ts.Diagnostic` with `start`, `length`, `messageText`, `category`, `relatedInformation`). Mixing them would require a discriminated union or adapter type that complicates both pipelines. Storing already-converted LSP diagnostics in a separate cache keeps the ganko pipeline untouched — the merge happens at the `sendDiagnostics` boundary where everything is already in LSP format.

**Why re-check all open files in Phase 5 instead of tracking TS imports?**

Building a TypeScript dependency graph duplicates work the `LanguageService` does internally. The alternative — maintaining a shadow `BuilderProgram` for `getSemanticDiagnosticsOfNextAffectedFile()` — is the correct long-term approach but a larger architectural change (see above). For v1, re-checking all open files with the async loop is acceptable: the `tsDiagsEqual` check prevents unnecessary `sendDiagnostics` calls, and the `setImmediate` yield keeps the editor responsive. The cost is ~5-50ms per open file (the full diagnostic walk), not ~1ms as a cached result would be.

**Why default OFF?**

VS Code's built-in TypeScript extension provides diagnostics via its own `tsserver` integration. Enabling ganko's TS diagnostics by default would show duplicates (two error squiggles for the same type error, one from each source). Users who disable the built-in extension — or use editors without built-in TS support (Vim, Emacs, Helix) — can opt in via `solid.enableTypeScriptDiagnostics: true`.

