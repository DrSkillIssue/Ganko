/**
 * Tier 1 Program — Minimal single-file ts.Program for instant diagnostics.
 *
 * Creates a real ts.Program with full TypeChecker scoped to a single file
 * and its direct imports (including node_modules). Types from other project
 * files are NOT available — imported symbols resolve to `any`.
 *
 * Cost: ~50-100ms (dominated by lib.d.ts parsing on first call,
 * cached by TS internally within a CompilerHost instance).
 */
import ts from "typescript";
import { dirname } from "node:path";

export interface Tier1Result {
  readonly program: ts.Program
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
}

/**
 * Build a minimal ts.Program for a single file with full type info.
 *
 * Resolves the file's imports (including node_modules) so the
 * TypeChecker can resolve types from solid-js, DOM libs, etc.
 *
 * @param filePath - Absolute path to the file
 * @param content - Current in-memory content
 * @param compilerOptions - Pre-parsed tsconfig options (cached by caller)
 * @param cachedHost - Reusable CompilerHost (caches lib.d.ts across calls)
 * @returns Tier1Result or null if the file couldn't be parsed
 */
export function createTier1Program(
  filePath: string,
  content: string,
  compilerOptions?: ts.CompilerOptions,
  cachedHost?: ts.CompilerHost,
): Tier1Result | null {
  const options: ts.CompilerOptions = compilerOptions ?? inferCompilerOptions(filePath);

  const defaultHost = cachedHost ?? ts.createCompilerHost(options);

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      if (fileName === filePath) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      return defaultHost.getSourceFile(fileName, languageVersion);
    },
    fileExists(fileName) {
      if (fileName === filePath) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      if (fileName === filePath) return content;
      return defaultHost.readFile(fileName);
    },
  };

  const program = ts.createProgram({
    rootNames: [filePath],
    options,
    host,
  });

  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return null;

  return {
    program,
    sourceFile,
    checker: program.getTypeChecker(),
  };
}

/**
 * Infer minimal CompilerOptions from the nearest tsconfig.json.
 * Falls back to reasonable defaults if no tsconfig is found.
 */
function inferCompilerOptions(filePath: string): ts.CompilerOptions {
  const dir = dirname(filePath);
  const tsconfigPath = ts.findConfigFile(dir, ts.sys.fileExists, "tsconfig.json");

  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(tsconfigPath),
    );
    return parsed.options;
  }

  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
}
