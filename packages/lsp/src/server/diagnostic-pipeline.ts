/**
 * Diagnostic Pipeline — Orchestrates phased diagnostic production with cancellation.
 *
 * Replaces the scattered publishFileDiagnostics / publishTier1Diagnostics /
 * republishMergedDiagnostics / propagateTsDiagnostics with a single pipeline
 * that checks a CancellationToken between phases and between files.
 *
 * Phase 1: Single-file ganko diagnostics (sync, 5-20ms per file)
 * Phase 2: Cross-file ganko diagnostics (sync, 100-500ms, if enriched)
 * Phase 3: TypeScript diagnostics (async, yields via setImmediate between files)
 *
 * Each phase publishes results via DiagnosticsManager immediately so the
 * user sees single-file results before cross-file completes.
 */

import type { Diagnostic } from "@drskillissue/ganko";
import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";
import { createSolidInput, buildSolidSyntaxTree, runSolidRules, createOverrideEmit } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
import { runSingleFileDiagnostics } from "../core/analyze";
import { createIncrementalAnalyzer } from "../core/incremental-analysis";
import type { Project } from "../core/project";
import type { ServerContext } from "./server";
import { DiagnosticKind } from "./diagnostics-manager";
import { convertDiagnostics } from "./handlers/diagnostics";
import { collectTsDiagnosticsForFile, tsDiagsEqual, convertTsDiagnostic } from "./handlers/ts-diagnostics";
import type { CancellationToken } from "./cancellation";

export interface DiagnosticPipelineOptions {
  readonly context: ServerContext
  readonly project: Project
  readonly path: string
  readonly content?: string | undefined
  readonly includeCrossFile: boolean
  readonly token: CancellationToken
}

/**
 * Run all diagnostic phases for a single file with cancellation support.
 *
 * Phase 1: single-file ganko diagnostics — always runs
 * Phase 2: cross-file ganko diagnostics — only if enriched + includeCrossFile
 * Phase 3: TypeScript diagnostics — only if enabled
 *
 * Publishes after Phase 1 so user sees results immediately, then
 * re-publishes after Phase 2 with cross-file merged in.
 *
 * Returns early if token is cancelled between phases.
 */
export function runDiagnosticPipeline(opts: DiagnosticPipelineOptions): void {
  const { context, project, path, content, includeCrossFile, token } = opts;
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  const log = context.log;

  // ── Phase 1: Single-file ganko diagnostics ──
  const resolvedContent = content
    ?? (kind !== "unknown" ? context.resolveContent(key) ?? undefined : undefined);

  const t0 = performance.now();
  const singleFile = runSingleFileDiagnostics(project, key, resolvedContent, context.serverState.config.ruleOverrides, log);

  if (token.isCancelled) return;

  // All phases publish in a single batch so the client receives ONE
  // combined notification with ganko + cross-file + TypeScript diagnostics.
  context.diagManager.beginBatch();
  try {
    // Phase 1 result
    context.diagManager.update(key, DiagnosticKind.Ganko, convertDiagnostics(singleFile, context.serverState.config.warningsAsErrors), singleFile);

    if (token.isCancelled) return;

    // ── Phase 2: Cross-file ganko diagnostics via IncrementalAnalyzer ──
    const phase = context.phase;
    if (includeCrossFile && phase.tag === "enriched") {
      const analyzer = createIncrementalAnalyzer();
      const compilation = context.graphCache.currentCompilation;
      // Run full analysis — cross-file rules need all files (CSS rules need
      // solid trees for element dispatch, solid rules need CSS scope).
      // analyzeAffected with just [key] misses rules that fire on other files
      // but produce diagnostics attributed to key.
      const crossByFile = analyzer.analyzeAll(compilation, context.serverState.config.ruleOverrides);
      const crossFile = crossByFile.get(key) ?? [];

      if (!token.isCancelled && crossFile.length > 0) {
        context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.config.warningsAsErrors), crossFile);
      }
    } else if (phase.tag === "enriched") {
      const crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
      if (crossFile.length > 0) {
        context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.config.warningsAsErrors), crossFile);
      }
    }

    if (token.isCancelled) return;

    // ── Phase 3: TypeScript diagnostics (sync per-file portion) ──
    if (context.serverState.config.enableTsDiagnostics && (phase.tag === "running" || phase.tag === "enriched") && kind === "solid") {
      if (resolvedContent !== undefined) {
        const ls = project.getLanguageService();
        const tsDiags = collectTsDiagnosticsForFile(ls, key, true);
        context.diagManager.update(key, DiagnosticKind.TypeScript, tsDiags);
      }
    }
  } finally {
    context.diagManager.endBatch();
  }

  if (log.isLevelEnabled(Level.Debug)) {
    const elapsed = (performance.now() - t0).toFixed(1);
    log.debug(`pipeline: ${key} single=${singleFile.length} elapsed=${elapsed}ms`);
  }
}

/**
 * Run diagnostic pipeline for a batch of files with cancellation between files.
 */
export function runDiagnosticPipelineBatch(
  context: ServerContext,
  project: Project,
  paths: readonly string[],
  includeCrossFile: boolean,
  token: CancellationToken,
): void {
  for (let i = 0; i < paths.length; i++) {
    if (token.isCancelled) return;
    const path = paths[i];
    if (!path) continue;
    runDiagnosticPipeline({
      context,
      project,
      path,
      includeCrossFile,
      token,
    });
  }
}

/**
 * Run diagnostics IMMEDIATELY for pull diagnostics (textDocument/diagnostic).
 *
 * The ROUTING LAYER performs flush/mutation BEFORE calling this:
 *   1. Routing: flush pending buffer into TS service
 *   2. Routing: apply change to tracker if content differs
 *   3. Routing: rebuild session
 *   4. This: runs full analysis inline, returns fresh diagnostics
 *   5. This: updates DiagnosticsManager so push path stays in sync
 */
export function runDiagnosticPipelineImmediate(
  context: ServerContext,
  project: Project,
  path: string,
  content: string | undefined,
): LSPDiagnostic[] {
  const key = canonicalPath(path);
  const kind = classifyFile(key);

  if (kind === "unknown") return [];

  const resolved = content ?? context.resolveContent(key) ?? undefined;

  // Phase 1: single-file
  const singleFile = runSingleFileDiagnostics(project, key, resolved, context.serverState.config.ruleOverrides, context.log);

  context.diagManager.beginBatch();
  try {
    context.diagManager.update(key, DiagnosticKind.Ganko, convertDiagnostics(singleFile, context.serverState.config.warningsAsErrors), singleFile);

    // Phase 2: cross-file
    const phase = context.phase;
    let crossFile: readonly Diagnostic[] = [];
    if (phase.tag === "enriched") {
      const analyzer = createIncrementalAnalyzer();
      const crossByFile = analyzer.analyzeAffected([key], context.graphCache.currentCompilation, context.serverState.config.ruleOverrides);
      crossFile = crossByFile.get(key) ?? [];
      if (crossFile.length > 0) {
        context.diagManager.update(key, DiagnosticKind.CrossFile, convertDiagnostics(crossFile, context.serverState.config.warningsAsErrors), crossFile);
      }
    }

    // Phase 3: TypeScript (inline, not async — pull is synchronous)
    const items = convertDiagnostics(
      crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile,
      context.serverState.config.warningsAsErrors,
    );

    if (context.serverState.config.enableTsDiagnostics && kind === "solid") {
      const ls = project.getLanguageService();
      const tsDiags = collectTsDiagnosticsForFile(ls, key, true);
      context.diagManager.update(key, DiagnosticKind.TypeScript, tsDiags);
      for (let i = 0; i < tsDiags.length; i++) {
        const td = tsDiags[i];
        if (td) items.push(td);
      }
    }

    return items;
  } finally {
    context.diagManager.endBatch();
  }
}

/**
 * Async TypeScript diagnostic propagation across open files.
 *
 * Yields between files via setImmediate. Cancellable — checks token
 * between each file. Replaces propagateTsDiagnostics from diagnostics-push.ts.
 */
export function propagateTsDiagnosticsAsync(
  context: ServerContext,
  project: Project,
  exclude: ReadonlySet<string>,
  token: CancellationToken,
): void {
  if (!context.serverState.config.enableTsDiagnostics) return;
  if (context.phase.tag !== "running" && context.phase.tag !== "enriched") return;

  const ls = project.getLanguageService();
  const allOpen = context.docManager.openPaths().filter(p =>
    p !== undefined && !exclude.has(p) && classifyFile(p) === "solid",
  );
  if (allOpen.length === 0) return;

  // Cancel any previous TS propagation
  context.tsPropagationCancel?.();
  let cancelled = false;
  context.tsPropagationCancel = () => { cancelled = true; };

  (async () => {
    for (let i = 0; i < allOpen.length; i++) {
      if (cancelled || token.isCancelled) break;
      await new Promise<void>(resolve => setImmediate(resolve));
      if (cancelled || token.isCancelled) break;

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

/**
 * Publish Tier 1 diagnostics for a file using a minimal single-file ts.Program.
 *
 * Used during startup before the full TypeScript program is built.
 * Cost: ~50-100ms on first call (lib.d.ts parsing), ~20-50ms thereafter.
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
  const graph = buildSolidSyntaxTree(input, "");

  const diagnostics: Diagnostic[] = [];
  const rawEmit = (d: Diagnostic) => diagnostics.push(d);
  const hasOverrides = Object.keys(context.serverState.config.ruleOverrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(rawEmit, context.serverState.config.ruleOverrides) : rawEmit;
  runSolidRules(graph, input.sourceFile, emit);

  const converted = convertDiagnostics(diagnostics, context.serverState.config.warningsAsErrors);
  context.diagManager.beginBatch();
  try {
    context.diagManager.update(path, DiagnosticKind.Ganko, converted, diagnostics);

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
  } finally {
    context.diagManager.endBatch();
  }

  if (context.log.isLevelEnabled(Level.Info)) {
    context.log.info(`Tier 1: ${path} → ${diagnostics.length} ganko diagnostics in ${(performance.now() - t0).toFixed(0)}ms`);
  }
}
