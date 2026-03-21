/**
 * Feature Handler Routing
 *
 * Wires all LSP feature requests to their handlers:
 * definition, references, hover, completion, rename, code actions,
 * signature help, document highlight, folding ranges, selection ranges,
 * linked editing, document symbols, workspace symbols, semantic tokens,
 * inlay hints, reactive graph, memory usage, and pull diagnostics
 * (textDocument/diagnostic — LSP 3.17).
 */

import {
  DocumentDiagnosticReportKind,
  type DocumentDiagnosticParams,
} from "vscode-languageserver/node";
import { canonicalPath, classifyFile, uriToPath, formatSnapshot, Level } from "@drskillissue/ganko-shared";
import type { Diagnostic } from "@drskillissue/ganko";
import { runCrossFileDiagnostics } from "../../core/analyze";
import { runDiagnostics } from "../diagnostics-push";
import { convertDiagnostics } from "../handlers/diagnostics";
import { collectTsDiagnosticsForFile } from "../handlers/ts-diagnostics";
import { isServerReady } from "../handlers/lifecycle";
import { DiagnosticKind } from "../diagnostics-manager";
import type { HandlerContext } from "../handlers/handler-context";
import type { GcTimer } from "../gc-timer";
import type { Logger } from "../../core/logger";
import type { ServerContext } from "../connection";

import { handleDefinition } from "../handlers/definition";
import { handleReferences } from "../handlers/references";
import { handleHover } from "../handlers/hover";
import { handleCompletion } from "../handlers/completion";
import { handlePrepareRename, handleRename } from "../handlers/rename";
import { handleCodeAction } from "../handlers/code-action";
import { handleSignatureHelp } from "../handlers/signature-help";
import { handleDocumentHighlight } from "../handlers/document-highlight";
import { handleLinkedEditingRanges } from "../handlers/linked-editing";
import { handleFoldingRanges } from "../handlers/folding-ranges";
import { handleSelectionRange } from "../handlers/selection-range";
import { handleDocumentSymbol } from "../handlers/document-symbol";
import { handleWorkspaceSymbol } from "../handlers/workspace-symbol";
import { handleSemanticTokens } from "../handlers/semantic-tokens";
import { handleInlayHint } from "../handlers/inlay-hint";
import { handleReactiveGraph } from "../handlers/reactive-graph";

/**
 * Create a guarded handler that checks server readiness.
 *
 * Returns fallback immediately when the server isn't ready or the
 * handler context hasn't been wired yet. Logs elapsed time for
 * handlers that take longer than 1ms.
 */
function createGuardedHandler<P, R>(
  getCtx: () => HandlerContext | null,
  isReady: () => boolean,
  log: Logger,
  handlerName: string,
  handler: (params: P, ctx: HandlerContext) => R,
  fallback: R,
  gc: GcTimer,
): (params: P) => R {
  return (params: P): R => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return fallback;
    const t0 = performance.now();
    try {
      return handler(params, ctx);
    } catch (e) {
      if (log.isLevelEnabled(Level.Warning)) log.warning(`${handlerName} threw (returning fallback): ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    } finally {
      const elapsed = performance.now() - t0;
      if (elapsed > 1) {
        if (log.isLevelEnabled(Level.Debug)) log.debug(`${handlerName}: ${elapsed.toFixed(1)}ms`);
      }
      gc.scheduleCollect();
    }
  };
}

/**
 * Wire all feature handlers onto the LSP connection.
 */
export function setupFeatureHandlers(context: ServerContext): void {
  const { connection } = context;

  function getCtx(): HandlerContext | null {
    return context.handlerCtx;
  }

  function isReady(): boolean {
    return isServerReady(context.serverState) && context.watchProgramReady;
  }

  const { log, gcTimer } = context;
  const gc = gcTimer;

  connection.onDefinition(createGuardedHandler(getCtx, isReady, log, "onDefinition", handleDefinition, null, gc));
  connection.onReferences(createGuardedHandler(getCtx, isReady, log, "onReferences", handleReferences, null, gc));
  connection.onHover(createGuardedHandler(getCtx, isReady, log, "onHover", handleHover, null, gc));
  connection.onPrepareRename(createGuardedHandler(getCtx, isReady, log, "onPrepareRename", handlePrepareRename, null, gc));
  connection.onRenameRequest(createGuardedHandler(getCtx, isReady, log, "onRenameRequest", handleRename, null, gc));
  connection.onCodeAction(createGuardedHandler(getCtx, isReady, log, "onCodeAction", handleCodeAction, null, gc));
  connection.onSignatureHelp(createGuardedHandler(getCtx, isReady, log, "onSignatureHelp", handleSignatureHelp, null, gc));
  connection.onDocumentHighlight(createGuardedHandler(getCtx, isReady, log, "onDocumentHighlight", handleDocumentHighlight, null, gc));
  connection.onFoldingRanges(createGuardedHandler(getCtx, isReady, log, "onFoldingRanges", handleFoldingRanges, null, gc));
  connection.onSelectionRanges(createGuardedHandler(getCtx, isReady, log, "onSelectionRanges", handleSelectionRange, null, gc));
  connection.languages.onLinkedEditingRange(createGuardedHandler(getCtx, isReady, log, "onLinkedEditingRange", handleLinkedEditingRanges, null, gc));
  connection.onDocumentSymbol(createGuardedHandler(getCtx, isReady, log, "onDocumentSymbol", handleDocumentSymbol, null, gc));
  connection.languages.semanticTokens.on((params) => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return { data: [] };
    try {
      return handleSemanticTokens(params, ctx) ?? { data: [] };
    } catch (e) {
      if (log.isLevelEnabled(Level.Warning)) log.warning(`onSemanticTokens threw (returning fallback): ${e instanceof Error ? e.message : String(e)}`);
      return { data: [] };
    } finally {
      gc.scheduleCollect();
    }
  });
  connection.languages.inlayHint.on(createGuardedHandler(getCtx, isReady, log, "onInlayHint", handleInlayHint, null, gc));

  connection.onWorkspaceSymbol((params) => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return null;
    const paths = context.docManager.openPaths();
    const firstPath = paths[0];
    if (paths.length === 0 || !firstPath) return null;
    try {
      return handleWorkspaceSymbol(params, ctx, firstPath);
    } finally {
      gc.scheduleCollect();
    }
  });

  connection.onCompletion((params) => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return null;
    try {
      return handleCompletion(params, ctx);
    } finally {
      gc.scheduleCollect();
    }
  });

  connection.onRequest("solid/showReactiveGraph", (params) => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return null;
    try {
      return handleReactiveGraph(params, ctx);
    } finally {
      gc.scheduleCollect();
    }
  });

  connection.onRequest("solid/memoryUsage", () => {
    const snapshot = context.memoryWatcher.takeSnapshotNow();
    return formatSnapshot(snapshot);
  });

  /**
   * Pull-based diagnostics (LSP 3.17 textDocument/diagnostic).
   *
   * AI agents send this request immediately after editing a file and expect
   * fresh results synchronously — they cannot wait for the push debounce
   * (150ms). We honour the request by:
   *   1. Flushing the current buffer content into the TS project so analysis
   *      uses the latest state, not whatever the debounce last committed.
   *   2. Evicting the per-file cache so stale single-file and cross-file
   *      results are discarded.
   *   3. Running full analysis (single-file + cross-file) inline.
   *
   * The debounce-based push path continues to operate in parallel and will
   * republish after the debounce fires, keeping push-based clients correct.
   */
  connection.languages.diagnostics.on(async (params: DocumentDiagnosticParams) => {
    await context.ready;
    const project = context.project;
    /* Gate on watchProgramReady: before this, runSingleFileDiagnostics would
       call project.getProgram() which triggers a synchronous full-program build
       (3–8s), blocking the entire event loop and stalling all pending LSP
       messages. Return empty; the client will retry once we push results via
       the normal Tier 2 startup path. */
    if (!project || !isServerReady(context.serverState) || !context.watchProgramReady) {
      if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`[PULL-DIAG] EARLY EXIT: project=${!!project} serverReady=${isServerReady(context.serverState)} watchReady=${context.watchProgramReady}`);
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }

    const key = canonicalPath(uriToPath(params.textDocument.uri));
    const kind = classifyFile(key);
    if (kind === "unknown") {
      if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`[PULL-DIAG] UNKNOWN FILE: ${key}`);
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }

    const doc = context.documents.get(params.textDocument.uri);
    const content = doc !== undefined ? doc.getText() : context.resolveContent(key) ?? undefined;

    /* Only update the TS project and evict caches when content actually changed.
       Calling updateFile with identical content triggers a redundant incremental
       TS re-parse. Calling evictFileCache invalidates the graphCache, forcing a
       ~240ms cross-file rebuild — even for consecutive pulls where the file
       content is unchanged (fixing audit issues #8 and #13). */
    const existing = project.getSourceFile(key)?.text;
    if (content !== undefined && content !== existing) {
      project.updateFile(key, content);
      context.evictFileCache(key);
    }

    const contentUnchanged = content === undefined || content === existing;
    const cachedSingle = contentUnchanged ? context.diagCache.get(key) : undefined;
    const singleFile = cachedSingle
      ?? runDiagnostics(project, context.diagCache, key, content, context.serverState.ruleOverrides, context.log);

    const crossFile: readonly Diagnostic[] = context.fileIndex
      ? (contentUnchanged
        ? context.graphCache.getCachedCrossFileDiagnostics(key)
        : runCrossFileDiagnostics(key, context.fileIndex, project, context.graphCache, context.tailwindValidator, context.resolveContent, context.serverState.ruleOverrides, context.externalCustomProperties))
      : [];

    const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;
    const items = convertDiagnostics(rawDiagnostics, context.serverState.warningsAsErrors);

    // Update diagManager so push path stays in sync
    context.diagManager.update(key, DiagnosticKind.Ganko, convertDiagnostics(singleFile, context.serverState.warningsAsErrors));
    if (crossFile.length > 0) {
      context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.warningsAsErrors));
    }

    if (context.log.isLevelEnabled(Level.Info)) context.log.info(`[PULL-DIAG] ${key} | warningsAsErrors=${context.serverState.warningsAsErrors} | singleFile=${singleFile.length} crossFile=${crossFile.length} | fileIndex=${!!context.fileIndex} contentUnchanged=${contentUnchanged} | → ${items.length} LSP items (${items.filter(i => i.severity === 1).length} error, ${items.filter(i => i.severity === 2).length} warn)`);

    if (context.serverState.enableTsDiagnostics && kind === "solid") {
      const ls = project.getLanguageService();
      const tsDiags = collectTsDiagnosticsForFile(ls, key, true);
      context.diagManager.update(key, DiagnosticKind.TypeScript, tsDiags);
      for (let i = 0, len = tsDiags.length; i < len; i++) {
        const td = tsDiags[i];
        if (td) items.push(td);
      }
    }

    if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(`textDocument/diagnostic: ${key} → ${items.length} diagnostics (contentUnchanged=${contentUnchanged})`);
    gc.scheduleCollect();
    return { kind: DocumentDiagnosticReportKind.Full, items };
  });
}
