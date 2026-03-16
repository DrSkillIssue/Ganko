# Phase 4: Persistent Incremental Cache (`.tsbuildinfo`)

**Effort**: M (1-2 days)
**Depends on**: Phase 1 (direct `ts.Program` with `CompilerHost`)
**Independent value**: Cold start program build from ~3-8s → ~200ms. Workers (Phase 2) become cheap.

---

## What `.tsbuildinfo` does

TypeScript's incremental compilation stores the dependency graph, source file versions, and semantic signature hashes in a JSON file. On subsequent invocations, `ts.createIncrementalProgram` reads this file and skips re-parsing/re-checking files whose content hash matches the stored version. For a 230-file project, this reduces program creation from ~3-8s (cold) to ~200ms (warm).

---

## Cache location

```
<projectRoot>/node_modules/.cache/ganko/.tsbuildinfo
```

- `node_modules/.cache/` is the established convention for tool caches (Babel, ESLint, Vite, Next.js)
- `.gitignore` typically covers `node_modules/`
- `npm install` / `bun install` clears `node_modules/.cache/` — fresh cache after dependency changes, which is correct because type declarations may have changed

---

## `packages/lsp/src/core/batch-program.ts` changes

Phase 1 creates `BatchTypeScriptService` with `ts.createProgram`. Replace with `ts.createIncrementalProgram`:

```typescript
import ts from "typescript";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export interface BatchTypeScriptService {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  /** Save .tsbuildinfo to disk for future warm starts */
  saveBuildInfo(): void
  dispose(): void
}

const CACHE_DIR = "node_modules/.cache/ganko";
const BUILD_INFO_FILE = ".tsbuildinfo";

export function createBatchProgram(rootPath: string): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath));

  const cacheDir = resolve(rootPath, CACHE_DIR);
  const tsBuildInfoFile = resolve(cacheDir, BUILD_INFO_FILE);

  const incrementalOptions: ts.CompilerOptions = {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile,
    noEmit: true,
  };

  const host = ts.createIncrementalCompilerHost(incrementalOptions, ts.sys);

  const builderProgram = ts.createIncrementalProgram({
    rootNames: parsedConfig.fileNames,
    options: incrementalOptions,
    host,
  });

  const program = builderProgram.getProgram();

  return {
    program,
    checker: program.getTypeChecker(),

    saveBuildInfo() {
      try {
        mkdirSync(cacheDir, { recursive: true });
      } catch { /* exists */ }
      builderProgram.emit(
        undefined,
        (fileName, data) => {
          ts.sys.writeFile(fileName, data);
        },
        undefined,
        true, // emitOnlyDtsFiles — we only want .tsbuildinfo, not actual .js/.d.ts
      );
    },

    dispose() { /* no-op for batch */ },
  };
}
```

Key details:
- `ts.createIncrementalCompilerHost` creates a host that reads `.tsbuildinfo` from disk if it exists
- `ts.createIncrementalProgram` uses the stored build info to skip unchanged files
- `builderProgram.emit(..., true)` with `emitOnlyDtsFiles=true` writes ONLY the `.tsbuildinfo` file — no `.js` or `.d.ts` output
- `noEmit: true` in options ensures no emit happens during type checking

---

## `packages/lsp/src/cli/lint.ts` changes

Save `.tsbuildinfo` after successful lint:

### Serial path

```typescript
// After serial analysis completes:
batch.saveBuildInfo();
batch.dispose();
```

### Worker path

Workers do NOT save `.tsbuildinfo`. The main thread saves it after cross-file analysis (which builds its own program):

```typescript
if (options.crossFile) {
  const batch = createBatchProgram(projectRoot);
  // ... cross-file analysis ...
  batch.saveBuildInfo();
  batch.dispose();
}
```

If `--no-cross-file` is set with workers, no `.tsbuildinfo` is saved on the worker path. This is acceptable — the next run with cross-file analysis will save it.

Alternative: have the main thread create a `BatchTypeScriptService` purely for saving `.tsbuildinfo` even without cross-file analysis. Cost: ~200ms (warm) to create the incremental program + save. This is worth it because it benefits subsequent runs:

```typescript
// After workers complete, always save .tsbuildinfo
{
  const batch = createBatchProgram(projectRoot);
  batch.saveBuildInfo();
  if (!options.crossFile) {
    batch.dispose();
  } else {
    // Reuse for cross-file analysis
    // ... cross-file analysis using batch.program ...
    batch.dispose();
  }
}
```

---

## `packages/lsp/src/cli/daemon.ts` changes

The daemon uses `IncrementalTypeScriptService` (watch program) post-Phase 1, NOT `BatchTypeScriptService`. The watch program does not use `.tsbuildinfo` — it keeps the program in memory across requests.

However, the daemon's warm state benefits from `.tsbuildinfo` on initial startup. During `prewarmDaemon`, the first program build should use `ts.createIncrementalProgram` to load the cached build info.

Post-Phase 1, the daemon creates an `IncrementalTypeScriptService` which uses `ts.createWatchProgram`. The watch host's `readFile` can serve `.tsbuildinfo`:

```typescript
// In createIncrementalProgram (incremental-program.ts):
// The watch program does NOT use .tsbuildinfo directly.
// But the first program build is what takes 3-8s.
// .tsbuildinfo is for batch (CLI) programs.
```

Actually, `ts.createWatchProgram` already does incremental compilation internally — it tracks source file versions across rebuilds within the same process. But it does NOT persist state to disk between process restarts.

For the daemon specifically:
- The daemon process stays alive between requests (state is in memory)
- The daemon's `prewarmDaemon` builds the program once on startup
- Subsequent requests use the warm program with incremental updates
- `.tsbuildinfo` does not help the daemon because it already keeps the program in memory

The daemon does NOT need `.tsbuildinfo` changes. Phase 4 benefits only the CLI path.

---

## `packages/lsp/src/cli/lint-worker.ts` changes (Phase 2 interaction)

Workers build their own `ts.Program`. They should also use `ts.createIncrementalProgram` to benefit from `.tsbuildinfo`:

```typescript
function runLintTask(task: WorkerTask): readonly WorkerResult[] {
  const configFile = ts.readConfigFile(task.tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    task.rootPath,
  );

  const cacheDir = resolve(task.rootPath, "node_modules/.cache/ganko");
  const tsBuildInfoFile = resolve(cacheDir, ".tsbuildinfo");

  const options: ts.CompilerOptions = {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile,
    noEmit: true,
  };

  const host = ts.createIncrementalCompilerHost(options, ts.sys);
  const builderProgram = ts.createIncrementalProgram({
    rootNames: parsedConfig.fileNames,
    options,
    host,
  });
  const program = builderProgram.getProgram();

  // ... per-file analysis (unchanged) ...

  return results;
}
```

Workers READ `.tsbuildinfo` but do NOT write it (multiple workers writing concurrently would corrupt the file). Only the main thread writes.

All workers read the same `.tsbuildinfo` file. Since reads are concurrent and the file is immutable during the lint run, this is safe.

---

## Cache invalidation

`.tsbuildinfo` is automatically invalidated by TypeScript when:
- Source file content changes (version hash mismatch)
- `tsconfig.json` options change
- TypeScript version changes (format version check)

Manual invalidation:
- `bun install` / `npm install` clears `node_modules/.cache/`
- User can delete `node_modules/.cache/ganko/.tsbuildinfo` manually

No explicit invalidation logic is needed in ganko code.

---

## Verification

1. **Cold start**: Delete `.tsbuildinfo`. Run `ganko lint --no-daemon`. Measure time. Expect ~3-8s for program creation.
2. **Warm start**: Run `ganko lint --no-daemon` again. Measure time. Expect ~200ms for program creation.
3. **`.tsbuildinfo` creation**: Verify `node_modules/.cache/ganko/.tsbuildinfo` exists after first run.
4. **Correctness**: `ganko lint` output identical on cold vs warm starts.
5. **Workers benefit**: `ganko lint --no-daemon --log-level debug` — verify worker program creation time drops from ~3-8s to ~200ms on warm starts.
6. **Dependency change**: Run `bun install`, verify `.tsbuildinfo` is gone, next run rebuilds from scratch.
