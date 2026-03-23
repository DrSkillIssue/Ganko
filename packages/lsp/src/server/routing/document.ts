/**
 * Document Handler Routing
 *
 * Wires LSP text document lifecycle events to their handlers:
 * didOpen, didChange (coalesced), didSave, didClose.
 *
 * Uses DocumentTracker (pure state machine) + DiagnosticPipeline
 * with CancellationToken. No manual cache eviction ordering.
 */

import { canonicalPath, classifyFile, uriToCanonicalPath, Level } from "@drskillissue/ganko-shared";
import { isServerReady } from "../handlers/lifecycle";
import { clearDiagnostics } from "../handlers/diagnostics";
import { runDiagnosticPipeline, propagateTsDiagnosticsAsync, publishTier1Diagnostics } from "../diagnostic-pipeline";
import { createCancellationSource } from "../cancellation";
import { buildSolidTreeForFile } from "../../core/compilation-builder";
import type { SolidSyntaxTree } from "@drskillissue/ganko";
import type { ServerContext } from "../server";

export function setupDocumentHandlers(context: ServerContext): void {
  const { documents, docManager } = context;

  // ── Coalesced change callback ──

  function processChangesCallback(): void {
    const phase = context.phase;
    if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`processChangesCallback.enter: phase=${phase.tag}`);
    const project = phase.tag === "running" || phase.tag === "enriched" ? phase.project : context.serverState.project;
    if (!project) { if (context.log.isLevelEnabled(Level.Trace)) context.log.trace("processChangesCallback: no project"); return; }

    const changes = docManager.drainPendingChanges();
    if (changes.length === 0) { if (context.log.isLevelEnabled(Level.Trace)) context.log.trace("processChangesCallback: no pending changes"); return; }

    // Cancel any in-flight diagnostic pipeline
    context.diagnosticCancellation?.cancel();
    const cancellation = createCancellationSource();
    context.diagnosticCancellation = cancellation;
    const token = cancellation.token;

    // Before running/enriched: Tier 1 only
    if (phase.tag !== "running" && phase.tag !== "enriched") {
      for (let i = 0; i < changes.length; i++) {
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

    // Sync TS service, build solid trees, evict diagnostic caches.
    // Then apply all changes as a single batch to the tracker.
    // applyBatch: CSS parsed internally via CSSSourceProvider,
    // solid trees provided externally (need ts.Program to parse).
    // One dependency graph rebuild for the entire batch.
    const solidTrees = new Map<string, SolidSyntaxTree>();
    const batchChanges: { path: string; content: string; version: string }[] = [];
    const getProgram = () => project.getProgram();
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      project.updateFile(change.path, change.content);
      context.diagManager.evict(change.path);
      batchChanges.push({ path: change.path, content: change.content, version: String(change.version) });
      if (classifyFile(change.path) === "solid") {
        const tree = buildSolidTreeForFile(change.path, getProgram);
        if (tree) solidTrees.set(change.path, tree);
      }
    }
    context.graphCache = context.graphCache.applyBatch(batchChanges, solidTrees);

    // Run pipeline for each changed file
    const diagnosed = new Set<string>();
    for (let i = 0; i < changes.length; i++) {
      if (token.isCancelled) break;
      const change = changes[i];
      if (!change) continue;
      runDiagnosticPipeline({ context, project, path: change.path, content: change.content, includeCrossFile: true, token });
      diagnosed.add(change.path);
    }

    if (!token.isCancelled) {
      context.connection.tracer.log(
        `processChangesCallback: ${changes.length} changes, ${diagnosed.size} diagnosed in ${(performance.now() - t0).toFixed(1)}ms`,
      );
      propagateTsDiagnosticsAsync(context, project, diagnosed, token);
    }
  }

  docManager.onCoalescedChanges(() => processChangesCallback());

  // ── didOpen ──

  documents.onDidOpen(async (event) => {
    const uri = event.document.uri;
    if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`didOpen.enter: uri=${uri}`);
    const path = context.identity.uriToPath(uri);
    const result = docManager.open(uri, path, event.document.version, event.document.getText());
    if (!result) { if (context.log.isLevelEnabled(Level.Trace)) context.log.trace("didOpen: docManager.open returned null"); return; }
    await context.ready;

    const key = canonicalPath(result.path);
    const openPhase = context.phase;
    if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`didOpen: path=${key} phase=${openPhase.tag} version=${event.document.version} openDocs=${docManager.openCount}`);

    if (openPhase.tag !== "running" && openPhase.tag !== "enriched") {
      if (context.log.isLevelEnabled(Level.Trace)) context.log.trace("didOpen: phase not ready, tier1 only");
      if (classifyFile(key) === "solid") {
        publishTier1Diagnostics(context, key, event.document.getText());
      }
      return;
    }

    openPhase.project.updateFile(key, event.document.getText());

    try {
      runDiagnosticPipeline({
        context,
        project: openPhase.project,
        path: key,
        content: event.document.getText(),
        includeCrossFile: true,
        token: createCancellationSource().token,
      });
    } catch (err) {
      context.log.error(`didOpen pipeline error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  });

  // ── didChange ──

  documents.onDidChangeContent(async (event) => {
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didChange: uri=${event.document.uri} version=${event.document.version}`);
    await context.ready;
    const queued = docManager.change(event.document.uri, event.document.version, event.document.getText());
    if (!queued) return;

    // Sync TS service IMMEDIATELY on every keystroke (no coalescing delay).
    // Feature requests (hover, completion) during the coalescing window must
    // see current content. Only the diagnostic pipeline trigger is coalesced.
    const phase = context.phase;
    if (phase.tag === "running" || phase.tag === "enriched") {
      const path = context.identity.uriToPath(event.document.uri);
      phase.project.updateFile(path, event.document.getText());
      context.tsPropagationCancel?.();
    }
  });

  // ── didSave ──

  documents.onDidSave(async (event) => {
    await context.ready;
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didSave ENTER: uri=${event.document.uri} version=${event.document.version}`);
    if (!isServerReady(context.serverState)) return;

    const savePhase = context.phase;
    const project = savePhase.tag === "running" || savePhase.tag === "enriched" ? savePhase.project : context.serverState.project;
    if (!project) return;

    docManager.save(event.document.uri);

    if (savePhase.tag !== "running" && savePhase.tag !== "enriched") {
      docManager.flush();
      const changes = docManager.drainPendingChanges();
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (!change) continue;
        project.updateFile(change.path, change.content);
      }
      return;
    }

    docManager.flush();
    const changes = docManager.drainPendingChanges();
    const savedPath = uriToCanonicalPath(event.document.uri);
    if (savedPath === null) return;

    // Sync TS + build solid trees + evict diagnostic caches, then batch apply.
    const saveSolidTrees = new Map<string, SolidSyntaxTree>();
    const saveBatch: { path: string; content: string; version: string }[] = [];
    const getSaveProgram = () => project.getProgram();
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      project.updateFile(change.path, change.content);
      context.diagManager.evict(change.path);
      saveBatch.push({ path: change.path, content: change.content, version: String(change.version) });
      if (classifyFile(change.path) === "solid") {
        const tree = buildSolidTreeForFile(change.path, getSaveProgram);
        if (tree) saveSolidTrees.set(change.path, tree);
      }
    }
    if (saveBatch.length > 0) {
      context.graphCache = context.graphCache.applyBatch(saveBatch, saveSolidTrees);
    }
    context.diagManager.evict(savedPath);

    // Re-diagnose via pipeline
    const saveToken = createCancellationSource().token;
    const diagnosed = new Set<string>();
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      if (change.path !== savedPath) {
        runDiagnosticPipeline({ context, project, path: change.path, includeCrossFile: true, token: saveToken });
        diagnosed.add(change.path);
      }
    }
    runDiagnosticPipeline({ context, project, path: savedPath, content: event.document.getText(), includeCrossFile: true, token: saveToken });
    diagnosed.add(savedPath);

    propagateTsDiagnosticsAsync(context, project, new Set([savedPath]), createCancellationSource().token);
  });

  // ── didClose ──

  documents.onDidClose((event) => {
    const path = docManager.close(event.document.uri);
    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`didClose: uri=${event.document.uri} path=${path}`);
    if (path) {
      clearDiagnostics(context.connection, event.document.uri);
      const key = canonicalPath(path);
      context.diagManager.onClose(key);
    }
  });
}
