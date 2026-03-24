import ts from "typescript";
import { readTsConfig } from "./tsconfig";

export interface BatchTypeScriptService {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  dispose(): void
}

/**
 * Create a batch TypeScript program from tsconfig.
 *
 * When `rootNames` is provided, those files are used as program roots
 * instead of the tsconfig's `files`/`include` patterns. This handles
 * monorepo setups where the root tsconfig has `files: []` and packages
 * have their own tsconfigs — the caller passes FileIndex-discovered
 * files directly.
 *
 * @param rootPath - Project root used to locate tsconfig.json
 * @param rootNames - Optional explicit root files for program creation
 * @returns Batch TypeScript service
 */
export function createBatchProgram(rootPath: string, rootNames?: readonly string[]): BatchTypeScriptService {
  const tsconfig = readTsConfig(rootPath);
  const fileNames = rootNames ?? tsconfig.fileNames;
  const program = ts.createProgram(fileNames, tsconfig.options);
  return {
    program,
    checker: program.getTypeChecker(),
    dispose() { /* no-op for batch */ },
  };
}
