/**
 * Diagnostic Push Engine
 *
 * All push-based diagnostic publication:
 * - runDiagnostics: run single-file analysis and cache result
 * - publishTier1Diagnostics: fast startup before full program is built
 * - publishFileDiagnostics: single-file + cross-file after watchProgramReady
 * - republishMergedDiagnostics: merge cached single-file + fresh cross-file
 * - propagateTsDiagnostics: async TS diagnostic propagation across open files
 *
 * All functions write to the LSP connection via connection.sendDiagnostics.
 */

import {
  type PublishDiagnosticsParams,
  type Diagnostic as LSPDiagnostic,
} from "vscode-languageserver/node";
import { createSolidInput, buildSolidGraph, runSolidRules, createOverrideEmit } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
import type { RuleOverrides } from "@drskillissue/ganko-shared";
import { runSingleFileDiagnostics, runCrossFileDiagnostics } from "../core/analyze";
import type { Project } from "../core/project";
import { collectTsDiagnosticsForFile, tsDiagsEqual, convertTsDiagnostic } from "./handlers/ts-diagnostics";
import { convertDiagnostics } from "./handlers/diagnostics";
import type { Logger } from "../core/logger";
import type { ServerContext } from "./connection";
import { DiagnosticKind } from "./diagnostics-manager";
import type { ResourceMap } from "./resource-map";

export function runDiagnostics(
  project: Project,
  diagCache: ResourceMap<readonly Diagnostic[]>,
  path: string,
  content?: string,
  overrides?: RuleOverrides,
  logger?: Logger,
): readonly Diagnostic[] {
  const key = canonicalPath(path);
  if (logger?.isLevelEnabled(Level.Trace)) logger.trace(`runDiagnostics: ${key}`);
  const diagnostics = runSingleFileDiagnostics(project, key, content, overrides, logger);
  diagCache.set(key, diagnostics);
  if (logger?.isLevelEnabled(Level.Trace)) logger.trace(`runDiagnostics: ${key} → ${diagnostics.length} diagnostics`);
  return diagnostics;
}

/**
 * Publish Tier 1 diagnostics for a file using a minimal single-file ts.Program.
 *
 * Used during startup before the full TypeScript program is built. Creates a
 * real ts.Program with full TypeChecker scoped to the file and its direct
 * imports (solid-js types, DOM libs are available). Cross-module project
 * types are NOT available — they resolve to `any`.
 *
 * Cost: ~50-100ms on first call (lib.d.ts parsing), ~20-50ms thereafter
 * (CompilerHost is cached across calls).
 */
export function publishTier1Diagnostics(
  context: ServerContext,
  path: string,
  content: string,
): void {
  if (!context.serverState.rootPath) return;

  const t0 = performance.now();

  const program = context.tsService.createQuickProgram(path, content);
  if (!program) {
    if (context.log.isLevelEnabled(Level.Warning)) context.log.warning(`Tier 1: failed to create program for ${path}`);
    return;
  }

  const sourceFile = program.getSourceFile(path);
  if (!sourceFile) return;

  const input = createSolidInput(path, program, context.log);
  const graph = buildSolidGraph(input);

  const diagnostics: Diagnostic[] = [];
  const rawEmit = (d: Diagnostic) => diagnostics.push(d);
  const hasOverrides = Object.keys(context.serverState.config.ruleOverrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(rawEmit, context.serverState.config.ruleOverrides) : rawEmit;
  runSolidRules(graph, input.sourceFile, emit);

  context.diagCache.set(path, diagnostics);

  const converted = convertDiagnostics(diagnostics, context.serverState.config.warningsAsErrors);
  context.diagManager.update(path, DiagnosticKind.Ganko, converted);

  if (context.serverState.config.enableTsDiagnostics) {
    const tsDiags: LSPDiagnostic[] = [];
    const syntactic = program.getSyntacticDiagnostics(sourceFile);
    for (let i = 0, len = syntactic.length; i < len; i++) {
      const d = syntactic[i];
      if (!d) continue;
      const lspDiag = convertTsDiagnostic(d);
      if (lspDiag !== null) tsDiags.push(lspDiag);
    }
    context.diagManager.update(path, DiagnosticKind.TypeScript, tsDiags);
  }

  const uri = context.docManager.uriForPath(path);
  const tracked = context.docManager.getByUri(uri);

  const allDiags = context.diagManager.getDiagnostics(path);
  const params: PublishDiagnosticsParams = { uri, diagnostics: [...allDiags] };
  if (tracked?.version !== undefined) params.version = tracked.version;
  context.connection.sendDiagnostics(params);

  if (context.log.isLevelEnabled(Level.Info)) {
    context.log.info(`Tier 1: ${path} → ${diagnostics.length} ganko + ${converted.length - diagnostics.length} ts diagnostics in ${(performance.now() - t0).toFixed(0)}ms`);
  }
}

/**
 * Publish diagnostics for a file.
 *
 * @param context - Server context
 * @param project - Project instance
 * @param path - File path
 * @param content - In-memory content for unsaved buffers
 * @param includeCrossFile - Whether to run cross-file analysis.
 *   true on open/save (when file boundaries change), false during
 *   typing (debounced changes) where only single-file rules matter.
 *   Previous cross-file results are preserved when skipped.
 */
export function publishFileDiagnostics(
  context: ServerContext,
  project: Project,
  path: string,
  content?: string,
  includeCrossFile = true,
): void {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  const resolved = content
    ?? (kind !== "unknown" ? context.handlerCtx?.getContent(key) ?? undefined : undefined)
    ?? (kind !== "unknown" ? context.resolveContent(key) ?? undefined : undefined);
  if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`publishFileDiagnostics ENTER: ${key} kind=${kind} content=${resolved !== undefined ? `${resolved.length} chars` : "from disk"} includeCrossFile=${includeCrossFile}`);
  const t0 = performance.now();
  const singleFile = runDiagnostics(project, context.diagCache, key, resolved, context.serverState.config.ruleOverrides, context.log);
  if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`publishFileDiagnostics: ${key} singleFile=${singleFile.length} in ${(performance.now() - t0).toFixed(1)}ms`);

  let crossFile: readonly Diagnostic[];
  if (includeCrossFile && context.fileIndex && context.project) {
    if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`publishFileDiagnostics: running cross-file for ${key} (solidFiles=${context.fileIndex.solidFiles.size} cssFiles=${context.fileIndex.cssFiles.size})`);
    crossFile = runCrossFileDiagnostics(key, context.fileIndex, context.project, context.graphCache, context.tailwindValidator, context.resolveContent, context.serverState.config.ruleOverrides, context.externalCustomProperties);
  } else {
    crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
    if (context.log.isLevelEnabled(Level.Trace)) context.log.trace(`publishFileDiagnostics: using cached cross-file for ${key} (${crossFile.length} diags)`);
  }

  /* diagCache already holds singleFile-only (set by runDiagnostics above).
     Merge cross-file for publication but do NOT write merged back to diagCache —
     that would violate the single-file-only invariant and cause double-counting
     in republishMergedDiagnostics and the pull diagnostic handler. */
  const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;

  context.diagManager.update(key, DiagnosticKind.Ganko, convertDiagnostics(singleFile, context.serverState.config.warningsAsErrors));
  if (crossFile.length > 0) {
    context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.config.warningsAsErrors));
  }

  if (context.serverState.config.enableTsDiagnostics && context.watchProgramReady && kind === "solid") {
    if (content !== undefined) {
      const ls = project.getLanguageService();
      const tsDiags = collectTsDiagnosticsForFile(ls, key, true);
      context.diagManager.update(key, DiagnosticKind.TypeScript, tsDiags);
    }
  }

  const uri = context.docManager.uriForPath(key);
  const tracked = context.docManager.getByUri(uri);

  const elapsed = (performance.now() - t0).toFixed(1);
  if (context.log.isLevelEnabled(Level.Debug)) context.log.debug(
    `publishFileDiagnostics: ${key} kind=${kind} crossFile=${includeCrossFile} `
    + `single=${singleFile.length} cross=${crossFile.length} total=${rawDiagnostics.length} `
    + `elapsed=${elapsed}ms`,
  );
  context.connection.tracer.log(
    `publishFileDiagnostics ${key}: ${rawDiagnostics.length} diagnostics in ${elapsed}ms`,
  );

  const allDiags = context.diagManager.getDiagnostics(key);
  const params: PublishDiagnosticsParams = { uri, diagnostics: [...allDiags] };
  if (tracked?.version !== undefined) params.version = tracked.version;
  context.connection.sendDiagnostics(params);
}

/**
 * Republish diagnostics for a file by merging already-computed single-file
 * results from `diagCache` with fresh cross-file results from `graphCache`.
 *
 * Used after `rediagnoseAffected` rebuilds cross-file results: the changed
 * files were initially published with `includeCrossFile=false` (Phase 2 of
 * the debounce flow), so they only have single-file diagnostics in the
 * editor. This function merges the cached single-file results with the
 * now-available cross-file diagnostics and sends the complete set — without
 * re-parsing or re-running any analysis.
 *
 * No-ops when no cross-file diagnostics exist for the file (nothing to add).
 */
export function republishMergedDiagnostics(
  context: ServerContext,
  path: string,
): void {
  const key = canonicalPath(path);
  const crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
  if (crossFile.length > 0) {
    context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.config.warningsAsErrors));
  }
  context.diagManager.republish(key);
}

/**
 * Propagate TS diagnostic changes to open files that weren't directly edited.
 * Async — yields between files via setImmediate. Cancellable on keystroke or
 * new debounce cycle.
 */
export function propagateTsDiagnostics(
  context: ServerContext,
  project: Project,
  exclude: ReadonlySet<string>,
): void {
  if (!context.serverState.config.enableTsDiagnostics || !context.watchProgramReady) return;

  const ls = project.getLanguageService();
  const allOpen = (context.docManager.openPaths() as string[]).filter(p =>
    p !== undefined && !exclude.has(p) && classifyFile(p) === "solid",
  );
  if (allOpen.length === 0) return;

  let cancelled = false;
  context.tsPropagationCancel?.();
  context.tsPropagationCancel = () => { cancelled = true; };

  (async () => {
    for (let i = 0; i < allOpen.length; i++) {
      if (cancelled) break;
      await new Promise<void>(resolve => setImmediate(resolve));
      if (cancelled) break;

      const p = allOpen[i];
      if (!p) continue;
      const tsDiags = collectTsDiagnosticsForFile(ls, p, true);
      const prev = context.diagManager.getDiagnosticsByKind(p, DiagnosticKind.TypeScript);
      if (!tsDiagsEqual(prev, tsDiags)) {
        context.diagManager.update(p, DiagnosticKind.TypeScript, tsDiags);
        context.diagManager.republish(p);
      }
    }
    context.tsPropagationCancel = null;
  })();
}
