# Failing Tests Tracker

26 failing tests across 11 test files. Grouped by root cause. **All 26 resolved.**

2 additional failures discovered in `memory-leaks.test.ts`. Resolved.

---

## Group F: memory-leaks.test.ts timeouts (2 tests) ✅ RESOLVED

**File:** `packages/lsp/test/integration/memory-leaks.test.ts`
**Root cause:** `buildCachedFile` creates a `ts.createProgram` per call. Each invocation re-parsed ~100 lib `.d.ts` files from disk. At scale (500+ calls in loops), this exceeded the 30s timeout.

**Fix:** Cached lib `SourceFile` objects in a module-scope `Map`. Lib files are immutable so parsing once and reusing across all `ts.createProgram` invocations is safe. 12x speedup.

- [x] `handles repeated add/remove cycles` (line 39, 10s was 121s)
- [x] `survives many file operations` (line 90, 3.9s was 48s)

---

## Group A: Determinism test timeouts (2 tests) ✅ RESOLVED

**File:** `packages/ganko/test/cross-file/layout-sibling-alignment-determinism.test.ts`
**Root cause:** Tests run 100 randomized CSS permutations through the full cross-file pipeline. Each permutation creates a `ts.Program`. At 50ms+ per program, 100 iterations exceeds the 5000ms default timeout.

**Fix:** Pre-parse TSX once outside the loop via `parseCode()`, then reuse `SolidInput` through a new `runRuleWithInput()` function. Eliminates redundant `ts.Program` creation. 100 permutation test: 338ms (was >5000ms), multimodal test: 285ms (was >5000ms).

- [x] `keeps byte-identical diagnostics across 100 randomized css permutations` (line 207, timeout)
- [x] `keeps conditional multimodal diagnostics stable across permutations` (line 252, timeout)

---

## Group B: signal-call rule not firing through LSP server harness (15 tests) ✅ RESOLVED

**Root cause:** `parseContent` was removed during the architecture overhaul (replaced by `createSolidInput` which requires a `ts.Program`). The test server's `buildCachedFile` imported the nonexistent function, the try/catch silently swallowed the ReferenceError, and all files got empty diagnostic arrays.

**Fix:** Rewrote `buildCachedFile` in `packages/lsp/test/helpers/test-server.ts` to create a `ts.Program` from virtual file content via `ts.createCompilerHost`, then call `createSolidInput` + `analyzeInput`. Updated `CachedFile.ast` to `CachedFile.sourceFile` (now `ts.SourceFile` instead of ESTree `T.Program`).

**File:** `packages/lsp/test/integration/diagnostics.test.ts`
- [x] `reports signal not called in JSX text` (line 35)
- [x] `reports multiple signal errors in same file` (line 72)
- [x] `reports signal in ternary without call` (line 86)
- [x] `reports async function in createEffect` (line 122)
- [x] `reports async function in createMemo` (line 138)
- [x] `clears signal-call diagnostic after fix` (line 230)
- [x] `introduces diagnostics when correct code is broken` (line 280)
- [x] `returns raw ganko diagnostic format` (line 362)

**File:** `packages/lsp/test/integration/code-action.test.ts`
- [x] `provides quickfix for uncalled signal` (line 31)
- [x] `provides separate fixes for multiple uncalled signals` (line 63)
- [x] `quickfix edit replaces signal with signal()` (line 82)
- [x] `code action includes the diagnostic it fixes` (line 101)

**File:** `packages/lsp/test/integration/concurrent-edits.test.ts`
- [x] `diagnostics work after many mutations` (line 111)

**File:** `packages/lsp/test/integration/large-project.test.ts`
- [x] `returns diagnostics for all files` (line 87)

**File:** `packages/lsp/test/integration/path-aliases.test.ts`
- [x] `diagnostics work on aliased paths` (line 71)

---

## Group C: re-export diagnostic pipeline (1 test) ✅ RESOLVED

**Root cause:** Same as Group B.

**File:** `packages/lsp/test/integration/re-exports.test.ts`
- [x] `diagnostics work on files with re-export patterns` (line 71)

---

## Group D: Cross-file diagnostics not produced after file system events (5 tests) ✅ RESOLVED

**Root cause:** `publishFileDiagnostics` in `connection.ts` had a two-step content resolution chain: explicit `content` param, then `handlerCtx.getContent(key)`. When both returned null (as happens for watched file events and saves), `runSingleFileDiagnostics` fell through to `project.run()` which crashes because the runner has no `ts.Program`.

**Fix:** Added `context.resolveContent(key)` as a third fallback in the content resolution chain. `resolveContent` reads from open document text or falls back to `readFileSync` from disk, ensuring content is always available for single-file diagnostics.

**File:** `packages/lsp/test/integration/document-lifecycle.test.ts`
- [x] `FileChangeType.Created adds new file to cross-file analysis` (line 126)
- [x] `FileChangeType.Deleted clears diagnostics for removed file` (line 158)
- [x] `save produces cross-file diagnostics after content change` (line 248)

**File:** `packages/lsp/test/integration/watched-files-rediagnose.test.ts`
- [x] `re-diagnoses open files on didChangeWatchedFiles` (line 113)
- [x] `produces cross-file diagnostics for TSX file after watcher notification` (line 147)

---

## Group E: CLI daemon and lint pipeline efficiency (3 tests) ✅ RESOLVED

**File:** `packages/lsp/test/cli/daemon.test.ts`
**Root cause:** Without `allowJs: true` in tsconfig, TypeScript skips `.jsx` files entirely. The test's JSX fixture content also needed rewriting to produce different diagnostics between V1 and V2.

**Fix:** Added `allowJs: true` to tsconfig and rewrote JSX V1/V2 content to use `createSignal` (V1 omits the call, V2 calls it correctly).

- [x] `detects changes in files outside tsconfig between daemon runs` (line 1920)

**File:** `packages/lsp/test/cli/lint-efficiency.test.ts`
**Root cause:** Tests assert stderr contains `crossFile: rebuilt N/M SolidGraphs` log line. The log format changed during the architecture overhaul and the expected pattern no longer existed.

**Fix:** Added the `crossFile: rebuilt N/M SolidGraphs` log line to `lint.ts` after the SolidGraph collection step, tracking rebuild count (0 when reused from serial path, N when rebuilt).

- [x] `cross-file phase rebuilds zero SolidGraphs when single-file phase pre-populates cache` (line 67)
- [x] `single-file analysis phase completes before cross-file begins` (line 104)

---

## Summary

| Group | Tests | Status |
|-------|-------|--------|
| A | 2 | ✅ Pre-parse TSX once, reuse SolidInput |
| B | 15 | ✅ Rewrote test harness to use createSolidInput + ts.Program |
| C | 1 | ✅ Same as B |
| D | 5 | ✅ Added resolveContent fallback in publishFileDiagnostics |
| E | 3 | ✅ allowJs + log format fix |
| F | 2 | ✅ Cached lib SourceFiles in test CompilerHost |
| **Total** | **28** | **All resolved** |
