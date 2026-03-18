/**
 * Lint Worker — Runs in a worker_threads Worker
 *
 * Each worker builds its own ts.Program from the tsconfig compiler options,
 * using the assigned file list as rootNames (not tsconfig file discovery).
 * Uses ts.createIncrementalProgram to benefit from .tsbuildinfo caching
 * (reads only — workers do NOT write .tsbuildinfo to avoid corruption
 * from concurrent writes).
 * Returns Diagnostic[] via postMessage.
 */
import { parentPort } from "node:worker_threads";
import ts from "typescript";
import { buildSolidGraph, runSolidRules, createSolidInput, createOverrideEmit, setActivePolicy } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { WorkerTask, WorkerResult } from "./worker-pool";
import { buildInfoPath } from "../core/batch-program";

const port = parentPort;
if (!port) {
  throw new Error("lint-worker must be run as a worker_threads Worker");
}

port.on("message", (task: WorkerTask) => {
  const results = runLintTask(task);
  port.postMessage(results);
});

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

  /* Use task.files as rootNames — the main thread already discovered
     the actual files via FileIndex. The tsconfig may have `files: []`
     in monorepo setups where packages have their own tsconfigs. */
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
    const graph = buildSolidGraph(input);

    fileDiags.length = 0;
    runSolidRules(graph, input.sourceFile, emit);

    results.push({ file: key, diagnostics: fileDiags.slice() });
  }

  return results;
}
