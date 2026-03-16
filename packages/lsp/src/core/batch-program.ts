import ts from "typescript";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";

export interface BatchTypeScriptService {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  /** Save .tsbuildinfo to disk for future warm starts.
   *  Atomic write (write-to-temp + rename) prevents corruption from
   *  concurrent CLI invocations reading during write. */
  saveBuildInfo(): void
  dispose(): void
}

const CACHE_DIR = "node_modules/.cache/ganko";
const BUILD_INFO_FILE = ".tsbuildinfo";

/**
 * Compute the .tsbuildinfo cache path for a project root.
 * Exported so workers can read (but not write) the same file.
 */
export function buildInfoPath(rootPath: string): string {
  return resolve(rootPath, CACHE_DIR, BUILD_INFO_FILE);
}

/**
 * Create an incremental batch TypeScript program from tsconfig.
 *
 * Uses `ts.createIncrementalProgram` to benefit from `.tsbuildinfo` caching.
 * On warm starts (`.tsbuildinfo` exists and matches current source versions),
 * program creation drops from ~3-8s to ~200ms.
 *
 * When `rootNames` is provided, those files are used as program roots
 * instead of the tsconfig's `files`/`include` patterns. This handles
 * monorepo setups where the root tsconfig has `files: []` and packages
 * have their own tsconfigs — the caller passes FileIndex-discovered
 * files directly.
 */
export function createBatchProgram(rootPath: string, rootNames?: readonly string[]): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath);
  const fileNames = rootNames ?? parsedConfig.fileNames;

  const tsBuildInfoFile = buildInfoPath(rootPath);

  const incrementalOptions: ts.CompilerOptions = {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile,
    /* Do NOT set noEmit — it prevents .tsbuildinfo from being written.
       Instead, disable all other output types explicitly. */
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    emitDeclarationOnly: false,
  };

  const host = ts.createIncrementalCompilerHost(incrementalOptions, ts.sys);
  const builderProgram = ts.createIncrementalProgram({
    rootNames: [...fileNames],
    options: incrementalOptions,
    host,
  });

  const program = builderProgram.getProgram();

  return {
    program,
    checker: program.getTypeChecker(),

    saveBuildInfo() {
      const cacheDir = resolve(rootPath, CACHE_DIR);
      try {
        mkdirSync(cacheDir, { recursive: true });
      } catch { /* exists */ }

      builderProgram.emit(
        undefined,
        (fileName, data) => {
          /* Only write .tsbuildinfo — discard any other output. */
          if (fileName.endsWith(".tsbuildinfo")) {
            try {
              /* Atomic write: write-to-temp + rename prevents corruption if
                 concurrent CLI invocations read .tsbuildinfo during write. */
              const tmpFile = `${fileName}.${randomBytes(4).toString("hex")}.tmp`;
              writeFileSync(tmpFile, data);
              renameSync(tmpFile, fileName);
            } catch {
              /* On Windows, concurrent reads may lock the file. Missing
                 .tsbuildinfo on the next cold start is acceptable — it just
                 means a full rebuild. */
            }
          }
        },
        undefined,
        false,
      );
    },

    dispose() { /* no-op for batch */ },
  };
}
