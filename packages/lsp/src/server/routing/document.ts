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

import { canonicalPath, classifyFile, uriToPath } from "@drskillissue/ganko-shared";
import { runCrossFileDiagnostics } from "../../core/analyze";
import type { PendingChange } from "../handlers/document";
import {
  handleDidOpen,
  handleDidChange,
  handleDidClose,
  handleDidSave,
  flushPendingChanges,
} from "../handlers/document";
import { isServerReady } from "../handlers/lifecycle";
import { clearDiagnostics } from "../handlers/diagnostics";
import {
  publishFileDiagnostics,
  publishTier1Diagnostics,
  republishMergedDiagnostics,
  propagateTsDiagnostics,
} from "../diagnostics-push";
import type { ServerContext } from "../connection";
import type { Project } from "../../core/project";

/** Debounce delay for document changes in milliseconds. */
const DEBOUNCE_MS = 150;

/**
 * Rebuild workspace cross-file results once for the current cache state.
 *
 * The debounce flow publishes changed files with single-file diagnostics first,
 * then merges fresh cross-file results. That merge must not depend on some
 * other open file triggering a cross-file run as a side effect.
 */
function refreshCrossFileCache(
  context: ServerContext,
  project: Project,
  changed: readonly PendingChange[],
): void {
  const fileIndex = context.fileIndex;
  if (!fileIndex) return;

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
    fileIndex,
    project,
    context.graphCache,
    context.tailwindValidator,
    context.resolveContent,
    context.serverState.ruleOverrides,
    context.externalCustomProperties,
  );
}

/**
 * Wire document handlers onto the LSP connection.
 */
export function setupDocumentHandlers(context: ServerContext): void {
  const { documents, documentState, serverState } = context;

  /**
   * Process pending document changes after debounce.
   *
   * Two-phase approach: first evict all caches, then diagnose all
   * changed files. This ensures cross-file diagnostics use the
   * latest state even when CSS and Solid files change in the same batch.
   */
  function processChangesCallback(): void {
    documentState.debounceTimer = null;
    const project = context.project;
    if (!project) return;

    if (!context.watchProgramReady) {
      /* Tier 1 path: program not built yet. Update the project's file buffers
         (so the eventual program build uses current content) and publish
         Tier 1 diagnostics for solid files. */
      const changes = flushPendingChanges(documentState);
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
    const changes = flushPendingChanges(documentState);
    if (context.log.enabled) context.log.debug(`processChangesCallback: ${changes.length} changes`);
    const paths: string[] = new Array(changes.length);

    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      paths[i] = change.path;
      if (context.log.enabled) context.log.debug(`processChangesCallback: evicting ${change.path}`);
      project.updateFile(change.path, change.content);
      context.evictFileCache(change.path);
    }

    const diagnosed = new Set<string>();
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      if (context.log.enabled) context.log.debug(`processChangesCallback: diagnosing ${change.path} (includeCrossFile=false)`);
      publishFileDiagnostics(context, project, change.path, change.content, false);
      diagnosed.add(change.path);
    }

    if (context.log.enabled) context.log.debug("processChangesCallback: refreshing cross-file cache for changed batch");
    refreshCrossFileCache(context, project, changes);

    context.rediagnoseAffected(paths, diagnosed);

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

  documents.onDidOpen(async (event) => {
    const path = handleDidOpen(event, documentState);
    if (!path) return;
    await context.ready;

    const key = canonicalPath(path);
    if (context.log.enabled) context.log.debug(
      `didOpen: uri=${event.document.uri} path=${key} hasProject=${!!context.project} `
      + `version=${event.document.version} openDocs=${documentState.openDocuments.size} `
      + `watchReady=${context.watchProgramReady}`,
    );

    if (!context.watchProgramReady) {
      /* Tier 1: single-file program, no waiting for full build.
         Only solid files get Tier 1 — CSS and unknown files wait for Tier 2/3. */
      const kind = classifyFile(key);
      if (kind === "solid") {
        publishTier1Diagnostics(context, key, event.document.getText());
      }
      return;
    }

    /* Tier 2+: full program available. */
    const project = context.project;
    if (project) {
      if (context.log.enabled) context.log.debug(`didOpen: calling publishFileDiagnostics for ${key}`);
      publishFileDiagnostics(context, project, key, event.document.getText());
    }
  });

  documents.onDidChangeContent(async (event) => {
    if (context.log.enabled) context.log.debug(`didChange: uri=${event.document.uri} version=${event.document.version}`);
    await context.ready;
    const queued = handleDidChange(event, documentState);
    if (context.log.enabled) context.log.debug(`didChange: queued=${queued} hasProject=${!!context.project} pendingChanges=${documentState.pendingChanges.size}`);
    if (!queued || !context.project) return;

    context.tsPropagationCancel?.();

    const timer = documentState.debounceTimer;
    if (timer !== null) {
      clearTimeout(timer);
    }

    documentState.debounceTimer = setTimeout(processChangesCallback, DEBOUNCE_MS);
  });

  documents.onDidSave(async (event) => {
    await context.ready;
    if (context.log.enabled) context.log.debug(`didSave ENTER: uri=${event.document.uri} version=${event.document.version}`);
    if (!isServerReady(serverState)) {
      context.log.debug("didSave: server not ready, returning");
      return;
    }

    const project = context.project;
    if (!project) {
      context.log.debug("didSave: no project, returning");
      return;
    }

    handleDidSave(event, documentState);

    if (!context.watchProgramReady) {
      /* During Tier 1: flush pending changes to project file buffers so the
         eventual program build uses current content. Skip diagnosis — Tier 2
         re-diagnosis in handleInitialized Phase B will pick this up. */
      const changes = flushPendingChanges(documentState);
      for (let i = 0, len = changes.length; i < len; i++) {
        const change = changes[i];
        if (!change) continue;
        project.updateFile(change.path, change.content);
      }
      return;
    }

    const changes = flushPendingChanges(documentState);
    const savedPath = uriToPath(event.document.uri);
    if (context.log.enabled) context.log.debug(`didSave: ${changes.length} pending changes, savedPath=${savedPath}`);

    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      if (context.log.enabled) context.log.debug(`didSave: evicting pending change ${change.path}`);
      project.updateFile(change.path, change.content);
      context.evictFileCache(change.path);
    }
    if (context.log.enabled) context.log.debug(`didSave: evicting saved file ${savedPath}`);
    context.evictFileCache(savedPath);

    /* Use the current document text for the saved file to avoid the
       debounce-timer race: if the timer fired between the save event
       arriving and this handler running, the TS service has pre-save
       content. Explicitly passing the document text ensures diagnostics
       match what is on disk (or what the editor holds post-format). */
    const savedContent = event.document.getText();

    const diagnosed = new Set<string>();
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      if (change.path !== savedPath) {
        if (context.log.enabled) context.log.debug(`didSave: diagnosing pending change ${change.path}`);
        publishFileDiagnostics(context, project, change.path);
        diagnosed.add(change.path);
      }
    }
    if (context.log.enabled) context.log.debug(`didSave: diagnosing saved file ${savedPath}`);
    publishFileDiagnostics(context, project, savedPath, savedContent);
    diagnosed.add(savedPath);

    const paths: string[] = new Array(changes.length + 1);
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      paths[i] = change.path;
    }
    paths[changes.length] = savedPath;

    context.rediagnoseAffected(paths, diagnosed);
    if (project) propagateTsDiagnostics(context, project, new Set([savedPath]));
    context.log.debug("didSave EXIT");
  });

  documents.onDidClose((event) => {
    const path = handleDidClose(event, documentState);
    if (context.log.enabled) context.log.debug(`didClose: uri=${event.document.uri} path=${path}`);
    if (path) {
      clearDiagnostics(context.connection, event.document.uri);
      /* Do NOT call evictFileCache here. Closing a tab does not change file
         content — the SolidGraph, LayoutGraph, and cross-file results remain
         valid. Calling invalidate() would null the LayoutGraph causing a
         ~240ms rebuild on the next didOpen. The per-file AST and diagnostic
         caches are harmless stale entries that get overwritten on reopen.
         The SolidGraph is version-keyed and self-invalidates when the
         file's script version changes (e.g. on disk modification). */
      const key = canonicalPath(path);
      context.diagCache.delete(key);
      context.tsDiagCache.delete(key);
      if (context.log.enabled) context.log.debug(`didClose: cleared diag cache for ${key} (graph preserved)`);
    }
  });
}
