/**
 * Lint Worker — Runs in a Bun Worker (web-style)
 *
 * Each worker builds its own ts.Program from the tsconfig compiler options,
 * using the assigned file list as rootNames (not tsconfig file discovery).
 * Uses ts.createIncrementalProgram to benefit from .tsbuildinfo caching
 * (reads only — workers do NOT write .tsbuildinfo to avoid corruption
 * from concurrent writes).
 *
 * Results are JSON-serialized before posting — Bun's string fast path
 * bypasses structured clone entirely, yielding 500x faster transfers.
 */
declare const self: Worker;

import ts from "typescript";
import { buildSolidSyntaxTree, runSolidRules, createSolidInput, createOverrideEmit, setActivePolicy } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { WorkerTask, WorkerResult } from "./worker-pool";
import { buildInfoPath } from "../core/batch-program";

self.onmessage = (event: MessageEvent<WorkerTask>) => {
  try {
    const results = runLintTask(event.data);
    self.postMessage(JSON.stringify(results));
  } catch {
    self.postMessage(JSON.stringify([]));
  }
};

function runLintTask(task: WorkerTask): readonly WorkerResult[] {
  setActivePolicy(task.accessibilityPolicy);
  const configFile = ts.readConfigFile(task.tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    task.rootPath,
  );

  const tsBuildInfoFile = buildInfoPath(task.rootPath);

  const incrementalOptions: ts.CompilerOptions = {
    ...parsedConfig.options,
    incremental: true,
    tsBuildInfoFile,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    emitDeclarationOnly: false,
  };

  const host = ts.createIncrementalCompilerHost(incrementalOptions, ts.sys);
  const builderProgram = ts.createIncrementalProgram({
    rootNames: [...task.files],
    options: incrementalOptions,
    host,
  });
  const program = builderProgram.getProgram();

  const hasOverrides = Object.keys(task.overrides).length > 0;

  const results: WorkerResult[] = [];
  const fileDiags: Diagnostic[] = [];
  const rawEmit = (d: Diagnostic) => fileDiags.push(d);
  const emit = hasOverrides ? createOverrideEmit(rawEmit, task.overrides) : rawEmit;

  for (let i = 0, len = task.files.length; i < len; i++) {
    const path = task.files[i];
    if (!path) continue;
    const key = canonicalPath(path);
    if (classifyFile(key) === "css") continue;

    const sourceFile = program.getSourceFile(key);
    if (!sourceFile) continue;

    const input = createSolidInput(key, program);
    const graph = buildSolidSyntaxTree(input, "");

    fileDiags.length = 0;
    runSolidRules(graph, input.sourceFile, emit);

    results.push({ file: key, diagnostics: fileDiags.slice() });
  }

  return results;
}
