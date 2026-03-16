/**
 * Lint Worker — Runs in a worker_threads Worker
 *
 * Each worker builds its own ts.Program from the tsconfig compiler options,
 * using the assigned file list as rootNames (not tsconfig file discovery).
 * Returns Diagnostic[] via postMessage.
 */
import { parentPort } from "node:worker_threads";
import ts from "typescript";
import { buildSolidGraph, runSolidRules, createSolidInput, createOverrideEmit } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { WorkerTask, WorkerResult } from "./worker-pool";

const port = parentPort;
if (!port) {
  throw new Error("lint-worker must be run as a worker_threads Worker");
}

port.on("message", (task: WorkerTask) => {
  const results = runLintTask(task);
  port.postMessage(results);
});

function runLintTask(task: WorkerTask): readonly WorkerResult[] {
  const configFile = ts.readConfigFile(task.tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    task.rootPath,
  );

  /* Use task.files as rootNames — the main thread already discovered
     the actual files via FileIndex. The tsconfig may have `files: []`
     in monorepo setups where packages have their own tsconfigs. */
  const program = ts.createProgram(task.files, parsedConfig.options);

  const hasOverrides = Object.keys(task.overrides).length > 0;

  const results: WorkerResult[] = [];

  for (let i = 0, len = task.files.length; i < len; i++) {
    const path = task.files[i];
    if (!path) continue;
    const key = canonicalPath(path);
    if (classifyFile(key) === "css") continue;

    const sourceFile = program.getSourceFile(key);
    if (!sourceFile) continue;

    const input = createSolidInput(key, program);
    const graph = buildSolidGraph(input);

    const diagnostics: Diagnostic[] = [];
    const rawEmit = (d: Diagnostic) => diagnostics.push(d);
    const emit = hasOverrides ? createOverrideEmit(rawEmit, task.overrides) : rawEmit;
    runSolidRules(graph, input.sourceFile, emit);

    results.push({ file: key, diagnostics });
  }

  return results;
}
