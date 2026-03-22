/**
 * Lifecycle Handler Routing
 *
 * Wires LSP lifecycle events to their handlers:
 * initialize, initialized, shutdown, exit, didChangeWatchedFiles,
 * didChangeConfiguration.
 */

import { FileChangeType } from "vscode-languageserver/node";
import {
  uriToCanonicalPath,
  acceptProjectRoot,
  buildWorkspaceLayout,
  parseLogLevel,
  Level,
} from "@drskillissue/ganko-shared";
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
import { runDiagnosticPipelineBatch } from "../diagnostic-pipeline";
import { createCancellationSource } from "../cancellation";
import { createWorkspaceChangeHandler, type FileChangeEvent } from "../workspace-change-handler";
import type { LifecyclePhase } from "../session";
import type { ServerContext } from "../server";
import type { LifecycleHandlerContext } from "../handlers/handler-context";

export function setupLifecycleHandlers(context: ServerContext): void {
  const { connection, serverState } = context;
  const workspaceHandler = createWorkspaceChangeHandler();

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
    const fileEvents: FileChangeEvent[] = [];
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
        fileEvents.push({ path, kind: "created" });
      } else if (change.type === FileChangeType.Changed) {
        fileEvents.push({ path, kind: "changed" });
      } else if (change.type === FileChangeType.Deleted) {
        fileEvents.push({ path, kind: "deleted" });
        deletedUris.push(change.uri);
      }
    }

    for (let i = 0; i < deletedUris.length; i++) {
      const uri = deletedUris[i];
      if (uri) clearDiagnostics(connection, uri);
    }

    // Process file events via WorkspaceChangeHandler
    await workspaceHandler.processFileEvents(context, fileEvents);

    if (eslintConfigChanged) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        const curPhase = context.phase;
        if (curPhase.tag === "enriched") {
          const root = acceptProjectRoot(serverState.rootPath);
          const newLayout = buildWorkspaceLayout(root, context.log);
          const newRegistry = createFileRegistry(newLayout, effectiveExclude(serverState), context.log);
          workspaceHandler.processRegistryRebuild(context, newRegistry, newLayout);
          lifecycleCtx.transitionPhase({ ...curPhase, registry: newRegistry, layout: newLayout });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) {
        // Workspace-level rediagnose: all open files
        rediagnoseAllOpen(context);
        return;
      }
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
        workspaceHandler.processRegistryRebuild(context, newRegistry, newLayout);
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
          workspaceHandler.processRegistryRebuild(context, newRegistry, newLayout);
          lifecycleCtx.transitionPhase({ ...eslintPhase, registry: newRegistry, layout: newLayout });
        }
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) needRediagnose = true;
    }

    if (needRediagnose) rediagnoseAllOpen(context);
  });
}

/** Re-diagnose all open files via pipeline. Replaces ChangeProcessor.processWorkspaceChange(). */
function rediagnoseAllOpen(context: ServerContext): void {
  const phase = context.phase;
  if (phase.tag !== "running" && phase.tag !== "enriched") return;

  context.graphCache.setCachedCrossFileResults([]);
  const openPaths = context.docManager.openPaths() as string[];
  if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`rediagnoseAllOpen: ${openPaths.length} open files`);

  const token = createCancellationSource().token;
  runDiagnosticPipelineBatch(context, phase.project, openPaths, true, token);
}
