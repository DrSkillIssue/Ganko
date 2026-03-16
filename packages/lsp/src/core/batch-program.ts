import ts from "typescript";

export interface BatchTypeScriptService {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  dispose(): void
}

export function createBatchProgram(rootPath: string): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath);
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  return {
    program,
    checker: program.getTypeChecker(),
    dispose() { /* no-op for batch */ },
  };
}
