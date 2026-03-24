import ts from "typescript";
import { readTsConfig } from "./tsconfig";

export interface IncrementalTypeScriptService {
  readonly tsconfigPath: string
  getProgram(): ts.Program
  getLanguageService(): ts.LanguageService
  updateFile(path: string, content: string): void
  /** Resolves when the initial program build completes.
   *  The build is deferred by one event loop tick via setImmediate
   *  to allow pending didOpen events to get Tier 1 treatment. */
  ready(): Promise<void>
  dispose(): void
}

/**
 * Create an incremental TypeScript language service for one project root.
 *
 * @param rootPath - Project root used to locate tsconfig.json
 * @returns Incremental TypeScript service
 */
export function createIncrementalProgram(rootPath: string): IncrementalTypeScriptService {
  const tsconfig = readTsConfig(rootPath);

  const fileContents = new Map<string, string>();
  const fileVersions = new Map<string, number>();

  const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => {
      const base = [...tsconfig.fileNames];
      if (fileContents.size === 0) return base;
      const baseSet = new Set(base);
      const extra: string[] = [];
      for (const key of fileContents.keys()) {
        if (!baseSet.has(key)) extra.push(key);
      }
      return extra.length > 0 ? [...base, ...extra] : base;
    },
    getScriptVersion: (fileName) => String(fileVersions.get(fileName) ?? 0),
    getScriptSnapshot: (fileName) => {
      const content = fileContents.get(fileName);
      if (content !== undefined) return ts.ScriptSnapshot.fromString(content);
      if (!ts.sys.fileExists(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
    },
    getCurrentDirectory: () => rootPath,
    getCompilationSettings: () => tsconfig.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => fileContents.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => fileContents.get(fileName) ?? ts.sys.readFile(fileName),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const languageService = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());

  /* Readiness signal: the initial program build is deferred by one event loop
     tick via setImmediate. This allows pending didOpen events (queued during
     the initialization handshake) to be processed with Tier 1 single-file
     programs before the 3-8s synchronous program build blocks the event loop.

     After setImmediate fires, languageService.getProgram() triggers the full
     build. The ready promise resolves once the build completes.

     If getProgram() is called before setImmediate fires (e.g., by a feature
     handler), it triggers the build synchronously — same as before Phase 3.
     The ready promise will then resolve immediately when setImmediate fires
     (getProgram is cached after first build). */
  let resolveReady: () => void;
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });

  setImmediate(() => {
    languageService.getProgram();
    resolveReady();
  });

  return {
    tsconfigPath: tsconfig.tsconfigPath,
    getProgram(): ts.Program {
      const program = languageService.getProgram();
      if (!program) throw new Error("Failed to get program from language service");
      return program;
    },
    getLanguageService(): ts.LanguageService {
      return languageService;
    },
    updateFile(path: string, content: string): void {
      fileContents.set(path, content);
      fileVersions.set(path, (fileVersions.get(path) ?? 0) + 1);
    },
    ready(): Promise<void> {
      return readyPromise;
    },
    dispose(): void {
      languageService.dispose();
    },
  };
}
