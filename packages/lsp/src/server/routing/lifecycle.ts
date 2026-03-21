/**
 * Lifecycle Handler Routing
 *
 * Wires LSP lifecycle events to their handlers:
 * initialize, initialized, shutdown, exit, didChangeWatchedFiles,
 * didChangeConfiguration.
 */

import { FileChangeType } from "vscode-languageserver/node";
import {
  canonicalPath,
  classifyFile,
  uriToPath,
  parseLogLevel,
  CROSS_FILE_DEPENDENTS,
  Level,
} from "@drskillissue/ganko-shared";
import type { FileKind } from "@drskillissue/ganko-shared";
import {
  handleInitialize,
  handleInitialized,
  handleShutdown,
  handleExit,
  handleConfigurationChange,
  reloadESLintConfig,
  effectiveExclude,
} from "../handlers/lifecycle";
import { createFileIndex } from "../../core/file-index";
import { clearDiagnostics } from "../handlers/diagnostics";
import { publishFileDiagnostics, propagateTsDiagnostics } from "../diagnostics-push";
import type { ServerContext } from "../connection";

function evictCachesForPath(context: ServerContext, path: string): void {
  const key = canonicalPath(path);
  context.diagCache.delete(key);
  context.diagManager.evict(key);
  context.graphCache.invalidate(key);
}

function rediagnoseAll(context: ServerContext, clearTsCache = false): void {
  const project = context.project;
  if (!project) return;

  context.graphCache.invalidateAll();
  context.diagCache.clear();
  context.diagManager.clear();
  const paths = context.docManager.openPaths();
  if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`rediagnoseAll: re-diagnosing ${paths.length} open files (clearTsCache=${clearTsCache})`);
  for (let i = 0, len = paths.length; i < len; i++) {
    const p = paths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p);
  }
  propagateTsDiagnostics(context, project, new Set());
}

export function setupLifecycleHandlers(context: ServerContext): void {
  const { connection, serverState } = context;

  connection.onInitialize((params) => {
    const rawLevel = params.initializationOptions?.logLevel;
    if (typeof rawLevel === "string") {
      context.log.setLevel(parseLogLevel(rawLevel, "info"));
    }
    return handleInitialize(params, serverState, context.log);
  });

  connection.onInitialized(async (params) => {
    const t0 = performance.now();
    await handleInitialized(params, serverState, connection, context);
    context.memoryWatcher.start();
    context.log.debug("Memory watcher started");
    connection.tracer.log(`initialized: project setup completed in ${(performance.now() - t0).toFixed(1)}ms`);
  });

  connection.onShutdown(() => {
    context.gcTimer.dispose();
    context.memoryWatcher.stop();
    handleShutdown(serverState, context.log, context);
  });

  connection.onExit(() => {
    const exitCode = handleExit(serverState);
    process.exit(exitCode);
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    await context.ready;
    if (!context.watchProgramReady) return;
    let eslintConfigChanged = false;
    const changes = params.changes;
    const paths: string[] = new Array(changes.length);

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      const path = uriToPath(change.uri);
      paths[i] = path;

      if (path.endsWith("eslint.config.mjs") || path.endsWith("eslint.config.js") || path.endsWith("eslint.config.cjs")) {
        eslintConfigChanged = true;
      }

      if (change.type === FileChangeType.Created) {
        context.fileIndex?.add(path);
        evictCachesForPath(context, path);
      }
      if (change.type === FileChangeType.Changed) {
        evictCachesForPath(context, path);
      }
      if (change.type === FileChangeType.Deleted) {
        context.fileIndex?.remove(path);
        clearDiagnostics(connection, change.uri);
        evictCachesForPath(context, path);
      }
    }

    if (eslintConfigChanged && context.project) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        context.fileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) {
        rediagnoseAll(context);
        return;
      }
    }

    const alreadyDiagnosed = new Set<string>();
    {
      const needed = new Set<FileKind>();
      for (let i = 0, len = paths.length; i < len; i++) {
        const p = paths[i];
        if (!p) continue;
        const deps = CROSS_FILE_DEPENDENTS[classifyFile(p)];
        for (const dep of deps) needed.add(dep);
      }
      if (needed.size > 0) {
        const open = context.docManager.openPaths() as string[];
        for (let i = 0, len = open.length; i < len; i++) {
          const p = open[i];
          if (!p) continue;
          if (needed.has(classifyFile(p))) alreadyDiagnosed.add(p);
        }
      }
    }

    context.changeProcessor.processChanges(
      paths.filter((p): p is string => p !== undefined).map(p => ({ path: p, kind: "changed" as const })),
    );

    if (context.project) {
      const project = context.project;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (!path) continue;
        const key = canonicalPath(path);
        if (alreadyDiagnosed.has(key)) continue;
        const uri = context.docManager.uriForPath(key);
        if (uri === undefined) continue;
        if (!context.docManager.getByUri(uri) !== null) continue;

        const doc = context.documents.get(uri);
        const content = doc !== undefined ? doc.getText() : undefined;
        if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didChangeWatchedFiles: re-diagnosing open file ${key}`);
        publishFileDiagnostics(context, project, key, content);
      }
      propagateTsDiagnostics(context, project, new Set());
    }
  });

  connection.onDidChangeConfiguration(async (params) => {
    const rawLevel = params?.settings?.solid?.logLevel;
    if (typeof rawLevel === "string") {
      context.log.setLevel(parseLogLevel(rawLevel, "info"));
    }

    if (!context.watchProgramReady) return;

    const result = handleConfigurationChange(params, serverState);
    if (!result.rebuildIndex && !result.reloadEslint && !result.rediagnose) return;

    let needRediagnose = result.rediagnose || result.rebuildIndex;

    if (result.rebuildIndex && serverState.rootPath) {
      const excludes = effectiveExclude(serverState);
      const fileIndex = createFileIndex(serverState.rootPath, excludes, context.log);
      context.fileIndex = fileIndex;
      if (context.log.isLevelEnabled(Level.Info)) context.log.info(`file index rebuilt: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css (exclude: ${excludes.length} patterns)`);
    }

    if (result.reloadEslint) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        context.fileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) needRediagnose = true;
    }

    if (needRediagnose) rediagnoseAll(context, result.rediagnose);
  });
}
