import ts from "typescript";

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
 */
export function createBatchProgram(rootPath: string, rootNames?: readonly string[]): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath);
  const fileNames = rootNames ?? parsedConfig.fileNames;
  const program = ts.createProgram(fileNames, parsedConfig.options);
  return {
    program,
    checker: program.getTypeChecker(),
    dispose() { /* no-op for batch */ },
  };
}
