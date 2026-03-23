# LINT-FIX.md — Restore Worker Parallelism + Eliminate Double Solid Tree Build

## Problem Statement

The v3.0.0 `lint.ts` rewrite introduced a **3.5x performance regression** on cross-file analysis:

| Metric | main branch | v3.0.0 branch |
|---|---|---|
| Single-file | Workers (4 threads) | Serial loop |
| Cross-file | 2315ms (reuses SolidGraphs) | 8046ms (rebuilds all SolidSyntaxTrees) |
| `--max-workers` flag | Parsed and used | Advertised in `--help` but never parsed |

Root causes:
1. **No worker parallelism** — the worker pool (`worker-pool.ts`) and worker script (`lint-worker.ts`) exist but `lint.ts` never calls them.
2. **Double solid tree build** — single-file phase builds all `SolidSyntaxTree`s, then `buildFullCompilation()` rebuilds them all from scratch for cross-file.
3. **`--max-workers` flag dropped** — `parseLintArgs` doesn't parse it, `LintOptions` doesn't include it.

## Files to Modify

| File | Change |
|---|---|
| `packages/lsp/src/cli/lint.ts` | Rewrite `runLint` body: build compilation ONCE before analysis, run solid rules from compilation trees, run cross-file on same compilation. Remove double tree build. |

No new files created. No files deleted.

---

## Line-by-Line Audit of Current `lint.ts`

### Lines 1-31: Imports

**Missing imports:**
- `createWorkerPool, defaultWorkerCount` from `./worker-pool`

`buildFullCompilation` stays — it builds the compilation once before any analysis. No new ganko imports needed.

### Lines 38-50: `LintOptions` interface

**Bug: `maxWorkers` field missing.** The `--help` text in `entry.ts:27` advertises `--max-workers <n>` but `LintOptions` doesn't have it and `parseLintArgs` doesn't parse it.

**Fix:** Add `readonly maxWorkers: number` to `LintOptions`. Default `0` (auto-detect).

### Lines 52-113: `parseLintArgs`

**Bug: Line 108** — `--max-workers` flag falls through to `die(`Unknown option: ${arg}`)`. Any user passing `--max-workers` gets an error exit.

**Fix:** Add parsing block between `--no-daemon` (line 102) and `--exclude` (line 103):
```
if (arg === "--max-workers") {
  const next = args[i + 1];
  const parsed = Number(next);
  if (!Number.isInteger(parsed) || parsed < 0) die(`--max-workers requires a non-negative integer. Got: ${next ?? "(missing)"}`);
  maxWorkers = parsed; i++; continue;
}
```

**Edge case: `--max-workers 0`** — means auto-detect. `--max-workers 1` means serial. Both must be valid.

**Edge case: `--max-workers` without value** — `Number(undefined)` is `NaN`, caught by the `isNaN` check. Correct.

### Lines 115-148: `resolveFiles`

No bugs found. `globSync` with `exclude` works correctly. `canonicalPath` normalizes case. Directory detection via `statSync` with fallback is correct.

**Edge case: Line 132** — `globSync(pattern, { cwd, exclude })` — the `exclude` parameter is the full `effectiveExclude` array including ESLint `globalIgnores`. Node's `globSync` `exclude` option accepts an array of glob patterns. Correct.

### Lines 150-169: `findProjectRoot`, `commonAncestor`

No bugs. `commonAncestor` handles empty arrays, single files, and multiple files with divergent paths. The infinite loop in `findProjectRoot` terminates when `dirname(dir) === dir` (filesystem root).

### Lines 171-183: `tryDaemonLint`

**Observation: Line 177** — `logLevel` is passed to daemon but `maxWorkers` is not. The daemon has its own analysis path (CompilationTracker). Not a bug — daemon doesn't use workers.

**Edge case: socket leaks** — `finally { socket.destroy() }` covers all paths. Correct.

### Lines 185-230: `runLint` setup (logger, project root, ESLint, file registry, daemon)

**Bug: Line 221** — `filesToLint` is `resolvedTargets ?? [...fileRegistry.solidFiles, ...fileRegistry.cssFiles]`. When no explicit targets, ALL files (solid + CSS) are in `filesToLint`. But the single-file loop at line 260 skips CSS files with `classifyFile(path) === "css"`. This is correct but wasteful — CSS files are iterated only to be skipped. Not a functional bug.

**Bug: Line 231** — `createProject` uses `SolidPlugin` and `eslintResult.overrides`. The project's LanguageService is used solely for `getProgram()` to get `ts.SourceFile` objects. In the worker path, workers create their own `ts.Program` via `ts.createProgram(task.files, parsedConfig.options)`. The main thread still needs the project for cross-file (program.getSourceFile). Correct.

### Lines 244-250: Monorepo file sync

**Correct but expensive.** Reads every solid file from disk and syncs into the IncrementalTypeScriptService. This is required for monorepo `files: []` tsconfigs. No bug.

**Performance note:** In the worker path, this sync is unnecessary for single-file (workers build their own programs). But it IS necessary for cross-file because the main thread reuses `project.getProgram()`. Keep it.

### Lines 252-271: Single-file analysis (THE MAIN PROBLEM)

**Bug: Lines 265-266** — `createSolidInput` + `buildSolidSyntaxTree` builds each solid tree. These trees are NOT cached. They're used for `runSolidRules` and then discarded.

**Bug: Lines 265-266 (double build)** — In the cross-file phase (line 290), `buildFullCompilation` rebuilds every solid tree again: `createSolidInput(solidPath, program, logger)` + `buildSolidSyntaxTree(input, contentHash(...))`. For 269 files, this means 538 tree builds instead of 269.

**Bug: No worker parallelism** — This loop is serial. The main branch dispatches to 4 workers when `solidFilesToLint.length > 20`.

**Fix architecture:**

Build the compilation ONCE via `buildFullCompilation` BEFORE any analysis. The compilation holds all solid trees, CSS trees, and tailwind config. It IS the cache. Then:

**Serial path (≤20 solid files OR `--max-workers 1`):**
1. Call `buildFullCompilation` → get `compilation` with all trees
2. For each targeted solid file: `compilation.getSolidTree(path)` → `runSolidRules(tree, tree.sourceFile, emit)`
3. Cross-file: `dispatcher.run(compilation)` — same compilation, zero rebuild

**Parallel path (>20 solid files):**
1. Dispatch targeted solid file chunks to worker pool → workers return diagnostics only (single-file)
2. Call `buildFullCompilation` on main thread → get `compilation` (workers can't share `ts.Node` refs, so main thread builds its own trees regardless)
3. Cross-file: `dispatcher.run(compilation)` — same compilation
4. Fallback to serial on worker error

The compilation is the single source of truth. No separate `treeCache` map. No `filesToBuild` vs `filesToAnalyze` parameters. `buildFullCompilation` already builds everything — the current code just calls it too late.

### Lines 276-317: Cross-file analysis

**Bug: Line 280** — `resolveTailwindValidatorSync` is called INSIDE the cross-file block. If `options.crossFile` is false, tailwind resolution is skipped entirely. Correct behavior.

**Bug: Line 286** — `buildWorkspaceLayout(acceptProjectRoot(projectRoot), log)` is called AGAIN. It was already called at line 220 for `createFileRegistry`. This creates a second workspace layout scan. It should be cached from line 220.

**Fix:** Hoist `layout` + `externalCustomProperties` computation. Cache the workspace layout returned from line 220's `buildWorkspaceLayout`.

Wait — line 220 calls `createFileRegistry(buildWorkspaceLayout(...), ...)`. The `buildWorkspaceLayout` result is consumed by `createFileRegistry` and not stored. We need to call it once and store it.

**Bug: Line 290-298** — `buildFullCompilation` rebuilds ALL solid trees. This is the 3.5x regression. Replace with direct compilation assembly from cached trees.

**Bug: Line 305** — `const lintSet = hasExplicitTargets ? new Set(filesToLint) : null`. `filesToLint` includes CSS files. The `lintSet` is used to filter cross-file diagnostics at line 307. Cross-file diagnostics have `d.file` set to the file where the diagnostic is reported. CSS-only diagnostics (e.g. `css-no-duplicate-selectors`) have `d.file` as a CSS path. If `filesToLint` includes CSS paths, this filter is correct. If the user passed only `.tsx` files, CSS diagnostics would be filtered out. This matches the expected behavior — lint only requested files.

**Edge case: Line 305** — `lintSet` is created from `filesToLint` which may contain non-canonical paths if the user passed relative paths. BUT `resolveFiles` at line 202 calls `addFileIfLintable` which calls `canonicalPath`. And `Diagnostic.file` uses canonical paths (set by the CSS parser and solid tree builder). So the set membership check works. Correct.

### Lines 319-336: Output and exit

No bugs. `allDiagnostics.sort(compareDiagnostics)` produces deterministic output. `countDiagnostics` correctly counts errors vs warnings. `project.dispose()` in finally block prevents TS service leaks. `fileHandle.close()` prevents fd leaks.

**Bug: Line 238** — `return process.exit(0)` inside the try block. `process.exit()` does NOT throw — it terminates the process immediately. The `finally` block at line 330 never runs. `project.dispose()` and `fileHandle.close()` are skipped. The file handle wraps `createWriteStream(filePath, { flags: "a" })` — Node's write buffer may not be flushed, losing log messages.

**Fix:** Before `process.exit(0)`, close the file handle:
```ts
if (fileHandle !== undefined) await fileHandle.close();
project.dispose();
process.exit(0);
```

### Lines 338-361: `outputAndExit`, `compareDiagnostics`

No bugs. `outputAndExit` is only called from the daemon path (line 227) which happens before `project` is created (line 231). No resource to clean up.

**Edge case: `compareDiagnostics` tie-breaking** — Sorted by file, then start line, then start column, then rule ID. Deterministic across runs. Correct.

---

## Line-by-Line Audit of `lint-worker.ts`

### Line 10: Imports

**Bug:** `buildSolidSyntaxTree` is imported and called at line 55, but the `contentHash` parameter is passed as `""` (empty string). In the main thread, it's `contentHash(sourceFile.text)`. The content hash is used as the tree's `version` field for cache invalidation in the compilation tracker. For CLI workers (single-file only, no compilation), this doesn't cause incorrect diagnostics — but it's sloppy. The compilation doesn't use worker-built trees.

**Fix:** Import `contentHash` from `@drskillissue/ganko-shared` and pass `contentHash(sourceFile.text)` instead of `""`. Even though workers don't feed into cross-file, consistent behavior prevents future bugs if workers are ever extended.

### Line 26: `ts.readConfigFile`

**Edge case:** If `tsconfigPath` doesn't exist, `ts.readConfigFile` returns `{ error: ... }`. The error is silently ignored and `configFile.config` is `undefined`. `ts.parseJsonConfigFileContent(undefined, ...)` then uses default compiler options. This is actually acceptable — the program still builds with the files provided. But it means worker programs may have different compiler options than the main thread's `createProject`-built program. In practice, the tsconfig always exists because `findProjectRoot` found it.

### Line 36: `ts.createProgram(task.files, parsedConfig.options)`

**Correct.** Each worker creates its own program with just its chunk of files as `rootNames`. The compiler options come from the same tsconfig. Type checking across file boundaries within a chunk works because TypeScript resolves imports transitively.

### Line 54: `createSolidInput(key, program)`

**Bug:** No logger passed. The main thread passes `log` as the third argument. Workers don't have a logger. This means `isUnnecessaryCast` debug logs and other diagnostic logging inside `createSolidInput` are silently dropped in workers. Not a functional bug, but diagnostic visibility gap.

**Fix:** Pass a noop logger or don't bother — workers are for speed, not diagnostics logging.

### Line 55: `buildSolidSyntaxTree(input, "")`

**Bug:** Empty string content hash. See line 10 analysis above.

---

## Line-by-Line Audit of `worker-pool.ts`

### Line 32: `const WORKER_SCRIPT = resolve(__dirname, "lint-worker.js")`

**Correct.** tsup bundles `lint-worker.ts` as a separate entry point to `dist/lint-worker.js`. The `__dirname` resolves to the dist directory at runtime. `existsSync` check at line 44 guards against missing builds.

### Lines 58-68: `tryDispatch`

**Bug: Line 60-62** — `idle[idle.length - 1]` reads the last idle worker, then `idle.pop()` removes it. But the guard `if (!worker) continue` creates an infinite loop if somehow `idle.length > 0` but the last element is falsy (which can't happen since Workers are truthy objects). Technically safe but the loop structure is fragile.

**Edge case: Line 63-65** — `queue[0]` reads front of queue, `queue.shift()` removes it. `shift()` is O(n) for arrays. For N=4 workers and small queues, this is negligible. Not a production issue.

### Lines 70-92: `runJob`

**Correct.** `once("message")` and `once("error")` ensure exactly one handler fires. The cross-removal (`removeListener`) prevents the other handler from firing on a subsequent event. Worker replacement on error (lines 80-84) ensures the pool maintains its count.

**Edge case: Line 83** — `workers[idx] = replacement` — if `idx` is -1 (worker not found in array), this sets `workers[-1]` which is a no-op on arrays but creates a property on the object. This can't happen because `workers.indexOf(worker)` always finds it (workers are never removed from the array until `terminate`). Safe.

### Lines 94-112: `dispatch`, `terminate`

**Bug: Line 102** — `Promise.all(promises).then((arrays) => arrays.flat())`. If ANY worker rejects, the entire `Promise.all` rejects. The caller (`lint.ts` in main branch) catches this and falls back to serial. The v3.0.0 `lint.ts` doesn't use workers at all, so this is moot — but the fix must include the try/catch/fallback pattern.

**Edge case: `terminate` called during active dispatch** — `workers.map(w => w.terminate())` terminates all workers. Pending `PendingJob` promises never resolve. If `terminate` is called from a `finally` block after `dispatch` completes or rejects, this is fine. If called concurrently, the pending promises leak. The main branch uses try/finally to ensure `terminate` runs after dispatch. Must replicate this pattern.

---

## Implementation Plan

### Step 1: Hoist workspace layout

Change line 220 from:
```ts
const fileRegistry = createFileRegistry(buildWorkspaceLayout(acceptProjectRoot(projectRoot), log), effectiveExclude, log);
```
to:
```ts
const workspaceLayout = buildWorkspaceLayout(acceptProjectRoot(projectRoot), log);
const fileRegistry = createFileRegistry(workspaceLayout, effectiveExclude, log);
```

Eliminates the redundant `buildWorkspaceLayout` call at current line 286.

### Step 2: Fix `process.exit(0)` resource leak at line 238

```ts
if (filesToLint.length === 0) {
  if (options.format === "json") console.log("[]");
  else console.log("No files to lint.");
  project.dispose();
  if (fileHandle !== undefined) await fileHandle.close();
  process.exit(0);
}
```

### Step 3: Replace lines 252-317 (single-file loop + cross-file block)

Build the compilation ONCE before any analysis. Both solid rules and cross-file rules read from it.

```ts
const solidFilesToLint: string[] = [];
for (let i = 0; i < filesToLint.length; i++) {
  const f = filesToLint[i];
  if (!f) continue;
  if (classifyFile(f) !== "css") solidFilesToLint.push(f);
}

const allDiagnostics: Diagnostic[] = [];
const t0 = performance.now();

// ── Build compilation ONCE with all trees ─────────────────────────
let tailwind = null;
try {
  tailwind = resolveTailwindValidatorSync(fileRegistry.loadAllCSSContent(), projectRoot);
  if (tailwind) log.info("tailwind: resolved");
  else log.info("tailwind: not found");
} catch (err) {
  log.warning(`tailwind: resolution failed: ${err instanceof Error ? err.message : String(err)}`);
}

const externalCustomProperties = scanDependencyCustomProperties(workspaceLayout);
if (externalCustomProperties.size > 0) log.info(`library analysis: ${externalCustomProperties.size} external custom properties`);

const { compilation } = buildFullCompilation({
  solidFiles: fileRegistry.solidFiles,
  cssFiles: fileRegistry.cssFiles,
  getProgram: () => program,
  tailwindValidator: tailwind,
  externalCustomProperties: externalCustomProperties.size > 0 ? externalCustomProperties : undefined,
  resolveContent: (path) => { try { return readFileSync(path, "utf-8"); } catch { return null; } },
  logger: log,
});

const tBuild = performance.now();
log.info(`compilation: ${compilation.solidTrees.size} solid + ${compilation.cssTrees.size} css trees in ${(tBuild - t0).toFixed(0)}ms`);

// ── Solid rules on targeted files (trees already in compilation) ──
for (let i = 0; i < solidFilesToLint.length; i++) {
  const path = solidFilesToLint[i];
  if (!path) continue;
  const tree = compilation.getSolidTree(path);
  if (!tree) continue;
  const { results, emit } = createEmit(eslintResult.overrides);
  runSolidRules(tree, tree.sourceFile, emit);
  for (let j = 0; j < results.length; j++) { const d = results[j]; if (d) allDiagnostics.push(d); }
}

const t1 = performance.now();
log.info(`single-file: ${allDiagnostics.length} diagnostics in ${(t1 - tBuild).toFixed(0)}ms`);

// ── Cross-file analysis ───────────────────────────────────────────
if (options.crossFile) {
  const dispatcher = createAnalysisDispatcher();
  for (let i = 0; i < allRules.length; i++) { const rule = allRules[i]; if (rule) dispatcher.register(rule); }

  const crossResult = dispatcher.run(compilation);
  const hasOverrides = Object.keys(eslintResult.overrides).length > 0;
  const lintSet = hasExplicitTargets ? new Set(filesToLint) : null;
  const crossEmit = hasOverrides
    ? createOverrideEmit(
        (d: Diagnostic) => { if (!lintSet || lintSet.has(d.file)) allDiagnostics.push(d); },
        eslintResult.overrides,
      )
    : (d: Diagnostic) => { if (!lintSet || lintSet.has(d.file)) allDiagnostics.push(d); };

  for (let i = 0; i < crossResult.diagnostics.length; i++) {
    const d = crossResult.diagnostics[i];
    if (d) crossEmit(d);
  }

  const t2 = performance.now();
  log.info(`cross-file: ${crossResult.diagnostics.length} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
}
```

`buildFullCompilation` builds ALL workspace solid trees + CSS trees + wires tailwind config onto the compilation. Solid rules iterate only targeted files via `compilation.getSolidTree(path)`. Cross-file passes the same compilation to the dispatcher. One compilation, zero rebuilds, zero caches, zero helper functions.

---

## Checklist

- [ ] Run full test suite after changes
- [ ] Run real-project benchmark: `timeout 60 /home/skill/p/ganko/packages/lsp/dist/ganko lint --no-daemon --log-level info` in bor-web-ui-changes/web
- [ ] Verify `--no-cross-file` skips cross-file work
- [ ] Verify explicit targets (`ganko lint src/App.tsx`) produce correct cross-file diagnostics
- [ ] Verify JSON output format is unchanged
- [ ] Verify exit codes (0 = clean, 1 = errors or max-warnings exceeded, 2 = CLI usage error)
