# Phase 5: Persistent `.tsbuildinfo` Cache for Cold Start

**Estimated Impact**: Cold start program build from ~3-8s → ~200ms
**Files touched**: `batch-program.ts` (from Phase 1), `incremental-program.ts` (from Phase 1), `daemon.ts`
**Risk**: Low-Medium (TypeScript's incremental API is stable and well-documented)
**Depends on**: Phase 1 (direct `ts.Program`)

## Problem

Every cold start (fresh CLI invocation, new daemon, LSP restart) pays the full `ts.createProgram` cost: parsing tsconfig, resolving module graph, reading all source files, type-checking. For a 230-file SolidJS project, this takes 3-8s.

TypeScript already solved this problem for `tsc --incremental` via `.tsbuildinfo` files. The `ts.createIncrementalProgram` API can read a previously-saved `BuilderProgram` state and skip re-checking files whose content hasn't changed.

## Solution

### Use `ts.createIncrementalProgram` Instead of `ts.createProgram`

Replace the batch `ts.createProgram` call from Phase 1 with `ts.createIncrementalProgram`:

```typescript
const parsedConfig = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, host);

const program = ts.createIncrementalProgram({
  rootNames: parsedConfig.fileNames,
  options: {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile: resolve(rootPath, "node_modules/.cache/ganko/.tsbuildinfo"),
  },
  host: compilerHost,
});
```

### Save `.tsbuildinfo` After Program Build

After building the program, emit the builder state:

```typescript
// Save incremental state for next cold start
const builderProgram = program.getProgram();
ts.emitBuilderProgram(builderProgram, host, /*emitOnlyDts*/ undefined, /*cancellationToken*/ undefined);
```

Or more precisely, use `ts.createEmitAndSemanticDiagnosticsBuilderProgram` which handles `.tsbuildinfo` writing:

```typescript
const builderHost = ts.createIncrementalCompilerHost(parsedConfig.options);
const builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(
  parsedConfig.fileNames,
  parsedConfig.options,
  builderHost,
  ts.readBuilderProgram(parsedConfig.options, builderHost), // reads existing .tsbuildinfo
);
```

### Cache Location

Store in `node_modules/.cache/ganko/.tsbuildinfo`:
- `node_modules/.cache/` is the standard cache directory convention (used by Babel, ESLint, Vite)
- Survives across runs, cleared by `rm -rf node_modules`
- Per-project isolation via the project root's `node_modules`

### What Gets Cached

The `.tsbuildinfo` file contains:
- File version hashes (content → version map)
- Dependency graph between files
- Computed declaration signatures
- Semantic diagnostics cache

On cold start with a warm cache:
- TypeScript reads the `.tsbuildinfo`
- Compares file content hashes against disk
- Only re-parses and re-checks files whose content changed
- Reuses cached type information for unchanged files

### Daemon Integration

The daemon already persists state in memory across requests. With `.tsbuildinfo`:
- **Daemon startup**: reads `.tsbuildinfo` → near-instant program rebuild
- **Daemon shutdown/crash**: `.tsbuildinfo` survives on disk → next daemon starts fast
- **CLI without daemon**: reads same `.tsbuildinfo` → benefits from daemon's previous work

### CLI Integration

For `ganko lint` without daemon:
1. Read `.tsbuildinfo` from cache
2. Build incremental program (validates cached state against current files)
3. Run analysis
4. Write updated `.tsbuildinfo` to cache (captures any new file changes)

Cost of step 4 is ~10-50ms (serializing the builder state).

## Changes

### `batch-program.ts` (from Phase 1)

Replace `ts.createProgram` with `ts.createIncrementalProgram`:

```typescript
function createBatchProgram(rootPath: string, log?: Logger): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath);

  const host = ts.createIncrementalCompilerHost(parsedConfig.options);
  const cacheDir = resolve(rootPath, "node_modules/.cache/ganko");
  const buildInfoPath = resolve(cacheDir, ".tsbuildinfo");

  const options = {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile: buildInfoPath,
  };

  const oldProgram = ts.readBuilderProgram(options, host);

  const builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(
    parsedConfig.fileNames,
    options,
    host,
    oldProgram,
  );

  const program = builder.getProgram();

  return {
    program,
    checker: program.getTypeChecker(),
    getSourceFileText(path) { ... },
    dispose() {
      // Write .tsbuildinfo on dispose (captures state for next run)
      mkdirSync(cacheDir, { recursive: true });
      builder.emit();
    },
  };
}
```

### `daemon.ts`

On daemon startup prewarm:
- Use incremental program (reads `.tsbuildinfo` if exists)
- On daemon shutdown: `.tsbuildinfo` already written by `dispose()`

## Verification

1. Cold `ganko lint` — writes `.tsbuildinfo`
2. Second `ganko lint` — reads `.tsbuildinfo`, significantly faster program build
3. Edit a single file → third `ganko lint` — only re-checks edited file + dependents
4. Delete `.tsbuildinfo` → falls back to full program build (no crash)
5. `bun run test` — all tests pass
6. Measure: cold with cache vs cold without cache
