/**
 * Document Handler Routing
 *
 * Wires LSP text document lifecycle events to their handlers:
 * didOpen, didChange (with debounce), didSave, didClose.
 *
 * The debounce flow (processChangesCallback) runs four phases:
 *   1. Evict all caches for changed files
 *   2. Publish single-file diagnostics (fast, no cross-file)
 *   3. Refresh cross-file cache for the batch
 *   4. Merge cross-file results into changed files (republish)
 */

import { canonicalPath, classifyFile, uriToPath, Level } from "@drskillissue/ganko-shared";
import { runCrossFileDiagnostics } from "../../core/analyze";
import { isServerReady } from "../handlers/lifecycle";
import { clearDiagnostics } from "../handlers/diagnostics";
import {
  publishFileDiagnostics,
  publishTier1Diagnostics,
  republishMergedDiagnostics,
  propagateTsDiagnostics,
} from "../diagnostics-push";
import { isRunningOrEnriched } from "../server-state";
import type { ServerContext } from "../connection";
import type { Project } from "../../core/project";
import { evictCachesForPath } from "../change-processor";

/**
 * Rebuild workspace cross-file results once for the current cache state.
 */
function refreshCrossFileCache(
  context: ServerContext,
  project: Project,
  changed: readonly { readonly path: string }[],
): void {
  const phase = context.phase;
  if (phase.tag !== "enriched") return;

  let seedPath: string | null = null;
  for (let i = 0, len = changed.length; i < len; i++) {
    const change = changed[i];
    if (!change) continue;
    seedPath = change.path;
    break;
  }
  if (seedPath === null) return;

  runCrossFileDiagnostics(
    seedPath,
    phase.fileIndex,
    project,
    context.graphCache,
    phase.tailwindValidator,
    context.resolveContent,
    context.serverState.config.ruleOverrides,
    phase.externalCustomProperties,
  );
}

/**
 * Wire document handlers onto the LSP connection.
 */
export function setupDocumentHandlers(context: ServerContext): void {
  const { documents, serverState, docManager } = context;

  function processChangesCallback(): void {
    const phase = context.phase;
    const project = isRunningOrEnriched(phase) ? phase.project : context.serverState.project;
    if (!project) return;

    const changes = docManager.drainPendingChanges();
    if (changes.length === 0) return;

    if (!isRunningOrEnriched(phase)) {
      for (let i = 0, len = changes.length; i < len; i++) {
        const change = changes[i];
        if (!change) continue;
        project.updateFile(change.path, change.content);
        if (classifyFile(change.path) === "solid") {
          publishTier1Diagnostics(context, change.path, change.content);
        }
      }
      return;
    }

    const t0 = performance.now();
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`processChangesCallback: ${changes.length} changes`);
    const paths: string[] = new Array(changes.length);

    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      paths[i] = change.path;
      project.updateFile(change.path, change.content);
      evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, change.path);
    }

    const diagnosed = new Set<string>();
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      publishFileDiagnostics(context, project, change.path, change.content, false);
      diagnosed.add(change.path);
    }

    refreshCrossFileCache(context, project, changes);
    context.changeProcessor.processChanges(
      paths.filter((p): p is string => p !== undefined).map(p => ({ path: p, kind: "changed" as const })),
      diagnosed,
    );

    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      republishMergedDiagnostics(context, change.path);
    }

    context.connection.tracer.log(
      `processChangesCallback: ${changes.length} changes, ${diagnosed.size} diagnosed in ${(performance.now() - t0).toFixed(1)}ms`,
    );
    propagateTsDiagnostics(context, project, diagnosed);
  }

  docManager.onDebouncedChanges(() => processChangesCallback());

  documents.onDidOpen(async (event) => {
    const path = docManager.open(event);
    if (!path) return;
    await context.ready;

    const key = canonicalPath(path);
    const openPhase = context.phase;
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(
      `didOpen: uri=${event.document.uri} path=${key} phase=${openPhase.tag} `
      + `version=${event.document.version} openDocs=${docManager.openCount}`,
    );

    if (!isRunningOrEnriched(openPhase)) {
      const kind = classifyFile(key);
      if (kind === "solid") {
        publishTier1Diagnostics(context, key, event.document.getText());
      }
      return;
    }

    publishFileDiagnostics(context, openPhase.project, key, event.document.getText());
  });

  documents.onDidChangeContent(async (event) => {
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didChange: uri=${event.document.uri} version=${event.document.version}`);
    await context.ready;
    const queued = docManager.change(event);
    if (!queued || !isRunningOrEnriched(context.phase)) return;
    context.tsPropagationCancel?.();
  });

  documents.onDidSave(async (event) => {
    await context.ready;
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didSave ENTER: uri=${event.document.uri} version=${event.document.version}`);
    if (!isServerReady(serverState)) return;

    const savePhase = context.phase;
    const project = isRunningOrEnriched(savePhase) ? savePhase.project : context.serverState.project;
    if (!project) return;

    docManager.save(event);

    if (!isRunningOrEnriched(savePhase)) {
      const changes = docManager.drainPendingChanges();
      for (let i = 0, len = changes.length; i < len; i++) {
        const change = changes[i];
        if (!change) continue;
        project.updateFile(change.path, change.content);
      }
      return;
    }

    docManager.flush();
    const changes = docManager.drainPendingChanges();
    const savedPath = uriToPath(event.document.uri);

    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      project.updateFile(change.path, change.content);
      evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, change.path);
    }
    evictCachesForPath(context.diagCache, context.diagManager, context.graphCache, savedPath);

    const savedContent = event.document.getText();
    const diagnosed = new Set<string>();
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      if (change.path !== savedPath) {
        publishFileDiagnostics(context, project, change.path);
        diagnosed.add(change.path);
      }
    }
    publishFileDiagnostics(context, project, savedPath, savedContent);
    diagnosed.add(savedPath);

    const paths: string[] = new Array(changes.length + 1);
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      paths[i] = change.path;
    }
    paths[changes.length] = savedPath;

    context.changeProcessor.processChanges(
      paths.filter((p): p is string => p !== undefined).map(p => ({ path: p, kind: "changed" as const })),
      diagnosed,
    );
    propagateTsDiagnostics(context, project, new Set([savedPath]));
  });

  documents.onDidClose((event) => {
    const path = docManager.close(event);
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didClose: uri=${event.document.uri} path=${path}`);
    if (path) {
      clearDiagnostics(context.connection, event.document.uri);
      const key = canonicalPath(path);
      context.diagCache.delete(key);
      context.diagManager.onClose(key);
    }
  });
}
