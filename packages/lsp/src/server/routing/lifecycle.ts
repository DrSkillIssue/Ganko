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
  uriToCanonicalPath,
  acceptProjectRoot,
  buildWorkspaceLayout,
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
import { createFileRegistry } from "../../core/file-registry";
import { clearDiagnostics } from "../handlers/diagnostics";
import { publishFileDiagnostics, propagateTsDiagnostics } from "../diagnostics-push";
import type { LifecyclePhase } from "../server-state";
import type { ServerContext } from "../connection";
import type { LifecycleHandlerContext } from "../handlers/handler-context";
import { evictCachesForPath } from "../change-processor";
import type { FileChange } from "../../core/change-pipeline";

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
    if (watchPhase.tag !== "running" && watchPhase.tag !== "enriched") return;

    let eslintConfigChanged = false;
    const fileChanges: FileChange[] = [];
    const deletedUris: string[] = [];

    for (let i = 0; i < params.changes.length; i++) {
      const change = params.changes[i];
      if (!change) continue;
      const path = uriToCanonicalPath(change.uri);
      if (path === null) continue;

      if (path.endsWith("eslint.config.mjs") || path.endsWith("eslint.config.js") || path.endsWith("eslint.config.cjs")) {
        eslintConfigChanged = true;
      }

      if (change.type === FileChangeType.Created) {
        fileChanges.push({ path, type: "created" });
      } else if (change.type === FileChangeType.Changed) {
        fileChanges.push({ path, type: "changed" });
      } else if (change.type === FileChangeType.Deleted) {
        fileChanges.push({ path, type: "deleted" });
        deletedUris.push(change.uri);
      }
    }

    for (let i = 0; i < deletedUris.length; i++) {
      const uri = deletedUris[i];
      if (uri) clearDiagnostics(connection, uri);
    }

    if (watchPhase.tag === "enriched") {
      watchPhase.changePipeline.processFileChanges(fileChanges);
    } else {
      for (let i = 0; i < fileChanges.length; i++) {
        const fc = fileChanges[i];
        if (!fc) continue;
        evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, fc.path);
      }
    }

    if (eslintConfigChanged) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        const curPhase = context.phase;
        if (curPhase.tag === "enriched") {
          const root = acceptProjectRoot(serverState.rootPath);
          const newLayout = buildWorkspaceLayout(root, context.log);
          const newRegistry = createFileRegistry(newLayout, effectiveExclude(serverState), context.log);
          curPhase.changePipeline.processRegistryRebuild(newRegistry);
          lifecycleCtx.transitionPhase({ ...curPhase, registry: newRegistry, layout: newLayout });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) {
        context.changeProcessor.processWorkspaceChange();
        return;
      }
    }

    const paths = fileChanges.map(fc => fc.path);
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
        const open = context.docManager.openPaths();
        for (let i = 0, len = open.length; i < len; i++) {
          const p = open[i];
          if (!p) continue;
          if (needed.has(classifyFile(p))) alreadyDiagnosed.add(p);
        }
      }
    }

    context.changeProcessor.processChanges(
      paths.map(p => ({ path: p, kind: "changed" as const })),
    );

    const rediagPhase = context.phase;
    if (rediagPhase.tag === "running" || rediagPhase.tag === "enriched") {
      const project = rediagPhase.project;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (!path) continue;
        const key = canonicalPath(path);
        if (alreadyDiagnosed.has(key)) continue;
        const uri = context.docManager.uriForPath(key);
        if (uri === undefined) continue;
        if (context.docManager.getByUri(uri) === null) continue;

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

    if (context.phase.tag !== "running" && context.phase.tag !== "enriched") return;

    const result = handleConfigurationChange(params, serverState);
    if (!result.rebuildIndex && !result.reloadEslint && !result.rediagnose) return;

    let needRediagnose = result.rediagnose || result.rebuildIndex;

    if (result.rebuildIndex && serverState.rootPath) {
      const cfgPhase = context.phase;
      if (cfgPhase.tag === "enriched") {
        const excludes = effectiveExclude(serverState);
        const root = acceptProjectRoot(serverState.rootPath);
        const newLayout = buildWorkspaceLayout(root, context.log);
        const newRegistry = createFileRegistry(newLayout, excludes, context.log);
        cfgPhase.changePipeline.processRegistryRebuild(newRegistry);
        lifecycleCtx.transitionPhase({ ...cfgPhase, registry: newRegistry, layout: newLayout });
        if (context.log.isLevelEnabled(Level.Info)) context.log.info(`file registry rebuilt: ${newRegistry.solidFiles.size} solid, ${newRegistry.cssFiles.size} css`);
      }
    }

    if (result.reloadEslint) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        const eslintPhase = context.phase;
        if (eslintPhase.tag === "enriched") {
          const root = acceptProjectRoot(serverState.rootPath);
          const newLayout = buildWorkspaceLayout(root, context.log);
          const newRegistry = createFileRegistry(newLayout, effectiveExclude(serverState), context.log);
          eslintPhase.changePipeline.processRegistryRebuild(newRegistry);
          lifecycleCtx.transitionPhase({ ...eslintPhase, registry: newRegistry, layout: newLayout });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) needRediagnose = true;
    }

    if (needRediagnose) context.changeProcessor.processWorkspaceChange(result.rediagnose);
  });
}
