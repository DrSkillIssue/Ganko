import { dirname } from "node:path";
import ts from "typescript";

export interface TsConfigData {
  readonly tsconfigPath: string
  readonly directory: string
  readonly fileNames: readonly string[]
  readonly options: ts.CompilerOptions
}

/**
 * Read and parse a tsconfig.json for an LSP project.
 *
 * @param rootPath - Project root used when locating a default tsconfig
 * @param explicitPath - Optional explicit tsconfig path
 * @returns Parsed tsconfig data
 * @throws When no tsconfig is found or parsing fails
 */
export function readTsConfig(rootPath: string, explicitPath?: string): TsConfigData {
  const tsconfigPath = explicitPath ?? ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) {
    throw new Error(`No tsconfig.json found in ${rootPath}`);
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(`Failed to read ${tsconfigPath}: ${flattenDiagnostic(configFile.error)}`);
  }

  const directory = dirname(tsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, directory);
  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    if (!firstError) {
      throw new Error(`Failed to parse ${tsconfigPath}`);
    }
    throw new Error(`Failed to parse ${tsconfigPath}: ${flattenDiagnostic(firstError)}`);
  }

  return {
    tsconfigPath,
    directory,
    fileNames: parsed.fileNames,
    options: parsed.options,
  };
}

function flattenDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
