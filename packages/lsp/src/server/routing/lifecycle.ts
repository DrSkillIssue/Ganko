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
import { isRunningOrEnriched } from "../server-state";
import type { LifecyclePhase } from "../server-state";
import type { ServerContext } from "../connection";
import type { LifecycleHandlerContext } from "../handlers/handler-context";
import { evictCachesForPath } from "../change-processor";

export function setupLifecycleHandlers(context: ServerContext): void {
  const { connection, serverState } = context;

  const lifecycleCtx: LifecycleHandlerContext = {
    connection: context.connection,
    log: context.log,
    transitionPhase(phase: LifecyclePhase) {
      context.phase = phase;
    },
  };

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
    const watchPhase = context.phase;
    if (!isRunningOrEnriched(watchPhase)) return;
    let eslintConfigChanged = false;
    const changes = params.changes;
    const paths: string[] = new Array(changes.length);
    const fileIndex = watchPhase.tag === "enriched" ? watchPhase.fileIndex : watchPhase.fileIndex;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      const path = uriToPath(change.uri);
      paths[i] = path;

      if (path.endsWith("eslint.config.mjs") || path.endsWith("eslint.config.js") || path.endsWith("eslint.config.cjs")) {
        eslintConfigChanged = true;
      }

      if (change.type === FileChangeType.Created) {
        fileIndex?.add(path);
        evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, path);
      }
      if (change.type === FileChangeType.Changed) {
        evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, path);
      }
      if (change.type === FileChangeType.Deleted) {
        fileIndex?.remove(path);
        clearDiagnostics(connection, change.uri);
        evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, path);
      }
    }

    if (eslintConfigChanged) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        const newFileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
        const curPhase = context.phase;
        if (curPhase.tag === "enriched") {
          lifecycleCtx.transitionPhase({ ...curPhase, fileIndex: newFileIndex });
        } else if (curPhase.tag === "running") {
          lifecycleCtx.transitionPhase({ ...curPhase, fileIndex: newFileIndex });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) {
        context.changeProcessor.processWorkspaceChange();
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

    const rediagPhase = context.phase;
    if (isRunningOrEnriched(rediagPhase)) {
      const project = rediagPhase.project;
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

    if (!isRunningOrEnriched(context.phase)) return;

    const result = handleConfigurationChange(params, serverState);
    if (!result.rebuildIndex && !result.reloadEslint && !result.rediagnose) return;

    let needRediagnose = result.rediagnose || result.rebuildIndex;

    if (result.rebuildIndex && serverState.rootPath) {
      const excludes = effectiveExclude(serverState);
      const newIdx = createFileIndex(serverState.rootPath, excludes, context.log);
      const cfgPhase = context.phase;
      if (cfgPhase.tag === "enriched") {
        lifecycleCtx.transitionPhase({ ...cfgPhase, fileIndex: newIdx });
      } else if (cfgPhase.tag === "running") {
        lifecycleCtx.transitionPhase({ ...cfgPhase, fileIndex: newIdx });
      }
      if (context.log.isLevelEnabled(Level.Info)) context.log.info(`file index rebuilt: ${newIdx.solidFiles.size} solid, ${newIdx.cssFiles.size} css (exclude: ${excludes.length} patterns)`);
    }

    if (result.reloadEslint) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        const newIdx = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
        const eslintPhase = context.phase;
        if (eslintPhase.tag === "enriched") {
          lifecycleCtx.transitionPhase({ ...eslintPhase, fileIndex: newIdx });
        } else if (eslintPhase.tag === "running") {
          lifecycleCtx.transitionPhase({ ...eslintPhase, fileIndex: newIdx });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) needRediagnose = true;
    }

    if (needRediagnose) context.changeProcessor.processWorkspaceChange(result.rediagnose);
  });
}
