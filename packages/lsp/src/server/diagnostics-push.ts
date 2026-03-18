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

import ts from "typescript";
import { dirname } from "node:path";
import {
  type PublishDiagnosticsParams,
  type Diagnostic as LSPDiagnostic,
} from "vscode-languageserver/node";
import { createSolidInput, buildSolidGraph, runSolidRules, createOverrideEmit } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, pathToUri } from "@drskillissue/ganko-shared";
import type { RuleOverrides } from "@drskillissue/ganko-shared";
import { createTier1Program } from "../core/tier1-program";
import { runSingleFileDiagnostics, runCrossFileDiagnostics } from "../core/analyze";
import type { Project } from "../core/project";
import { collectTsDiagnosticsForFile, tsDiagsEqual, convertTsDiagnostic } from "./handlers/ts-diagnostics";
import { convertDiagnostics } from "./handlers/diagnostics";
import { getOpenDocumentPaths } from "./handlers/document";
import type { Logger } from "../core/logger";
import type { ServerContext } from "./connection";

/**
 * Run single-file diagnostics and cache the result.
 *
 * Stores ONLY singleFile results in diagCache[key].
 * republishMergedDiagnostics merges diagCache[key] + graphCache.crossFileDiagnostics[key];
 * storing merged here would double-count cross-file diagnostics in subsequent merges.
 */
export function runDiagnostics(
  project: Project,
  diagCache: Map<string, readonly Diagnostic[]>,
  path: string,
  content?: string,
  overrides?: RuleOverrides,
  logger?: Logger,
): readonly Diagnostic[] {
  const key = canonicalPath(path);
  if (logger?.enabled) logger.trace(`runDiagnostics: ${key}`);
  const diagnostics = runSingleFileDiagnostics(project, key, content, overrides, logger);
  diagCache.set(key, diagnostics);
  if (logger?.enabled) logger.trace(`runDiagnostics: ${key} → ${diagnostics.length} diagnostics`);
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

  /* Cache compiler options from tsconfig — parsed once, reused for all
     Tier 1 calls during startup. */
  if (context.cachedCompilerOptions === null) {
    const tsconfigPath = ts.findConfigFile(
      context.serverState.rootPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(tsconfigPath),
      );
      context.cachedCompilerOptions = parsed.options;
    }
  }

  /* Cache the CompilerHost across Tier 1 calls to avoid re-parsing lib.d.ts
     for each opened file. lib.d.ts parsing is cached within a single
     CompilerHost instance, NOT globally — reusing the host saves ~50-100ms
     per subsequent file. */
  if (context.cachedTier1Host === null && context.cachedCompilerOptions) {
    context.cachedTier1Host = ts.createCompilerHost(context.cachedCompilerOptions);
  }

  const tier1 = createTier1Program(
    path,
    content,
    context.cachedCompilerOptions ?? undefined,
    context.cachedTier1Host ?? undefined,
  );
  if (!tier1) {
    if (context.log.enabled) context.log.warning(`Tier 1: failed to create program for ${path}`);
    return;
  }

  const input = createSolidInput(path, tier1.program, context.log);
  const graph = buildSolidGraph(input);

  const diagnostics: Diagnostic[] = [];
  const rawEmit = (d: Diagnostic) => diagnostics.push(d);
  const hasOverrides = Object.keys(context.serverState.ruleOverrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(rawEmit, context.serverState.ruleOverrides) : rawEmit;
  runSolidRules(graph, input.sourceFile, emit);

  context.diagCache.set(path, diagnostics);

  const converted = convertDiagnostics(diagnostics, context.serverState.warningsAsErrors);

  if (context.serverState.enableTsDiagnostics) {
    const syntactic = tier1.program.getSyntacticDiagnostics(tier1.sourceFile);
    for (let i = 0, len = syntactic.length; i < len; i++) {
      const d = syntactic[i];
      if (!d) continue;
      const lspDiag = convertTsDiagnostic(d);
      if (lspDiag !== null) converted.push(lspDiag);
    }
  }

  const uri = context.documentState.pathIndex.get(path) ?? pathToUri(path);
  const docInfo = context.documentState.openDocuments.get(uri);

  const params: PublishDiagnosticsParams = { uri, diagnostics: converted };
  if (docInfo?.version !== undefined) params.version = docInfo.version;
  context.connection.sendDiagnostics(params);

  if (context.log.enabled) {
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
  if (context.log.enabled) context.log.trace(`publishFileDiagnostics ENTER: ${key} kind=${kind} content=${resolved !== undefined ? `${resolved.length} chars` : "from disk"} includeCrossFile=${includeCrossFile}`);
  const t0 = performance.now();
  const singleFile = runDiagnostics(project, context.diagCache, key, resolved, context.serverState.ruleOverrides, context.log);
  if (context.log.enabled) context.log.trace(`publishFileDiagnostics: ${key} singleFile=${singleFile.length} in ${(performance.now() - t0).toFixed(1)}ms`);

  let crossFile: readonly Diagnostic[];
  if (includeCrossFile && context.fileIndex && context.project) {
    if (context.log.enabled) context.log.trace(`publishFileDiagnostics: running cross-file for ${key} (solidFiles=${context.fileIndex.solidFiles.size} cssFiles=${context.fileIndex.cssFiles.size})`);
    crossFile = runCrossFileDiagnostics(key, context.fileIndex, context.project, context.graphCache, context.tailwindValidator, context.resolveContent, context.serverState.ruleOverrides, context.externalCustomProperties);
  } else {
    crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
    if (context.log.enabled) context.log.trace(`publishFileDiagnostics: using cached cross-file for ${key} (${crossFile.length} diags)`);
  }

  const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;
  context.diagCache.set(key, rawDiagnostics);
  const diagnostics = convertDiagnostics(rawDiagnostics, context.serverState.warningsAsErrors);

  if (context.serverState.enableTsDiagnostics && context.watchProgramReady && kind === "solid") {
    let tsDiags: readonly LSPDiagnostic[];
    if (content !== undefined) {
      const ls = project.getLanguageService();
      tsDiags = collectTsDiagnosticsForFile(ls, key, true);
      if (tsDiags.length > 0) {
        context.tsDiagCache.set(key, tsDiags);
      } else {
        context.tsDiagCache.delete(key);
      }
    } else {
      tsDiags = context.tsDiagCache.get(key) ?? [];
    }
    for (let i = 0, len = tsDiags.length; i < len; i++) {
      const td = tsDiags[i];
      if (td) diagnostics.push(td);
    }
  }

  const uri = context.documentState.pathIndex.get(key) ?? pathToUri(key);
  const docInfo = context.documentState.openDocuments.get(uri);

  const elapsed = (performance.now() - t0).toFixed(1);
  if (context.log.enabled) context.log.debug(
    `publishFileDiagnostics: ${key} kind=${kind} crossFile=${includeCrossFile} `
    + `single=${singleFile.length} cross=${crossFile.length} total=${rawDiagnostics.length} `
    + `elapsed=${elapsed}ms`,
  );
  context.connection.tracer.log(
    `publishFileDiagnostics ${key}: ${rawDiagnostics.length} diagnostics in ${elapsed}ms`,
  );

  const params: PublishDiagnosticsParams = { uri, diagnostics };
  if (docInfo?.version !== undefined) params.version = docInfo.version;
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
  const hasTsDiags = context.serverState.enableTsDiagnostics && context.tsDiagCache.has(key);
  if (crossFile.length === 0 && !hasTsDiags) return;

  const singleFile = context.diagCache.get(key);
  if (singleFile === undefined) return;

  const rawDiagnostics = crossFile.length > 0 ? [...singleFile, ...crossFile] : singleFile;
  context.diagCache.set(key, rawDiagnostics);
  const diagnostics = convertDiagnostics(rawDiagnostics, context.serverState.warningsAsErrors);

  if (hasTsDiags) {
    const tsDiags = context.tsDiagCache.get(key);
    if (tsDiags !== undefined) {
      for (let i = 0, len = tsDiags.length; i < len; i++) {
        const td = tsDiags[i];
        if (td) diagnostics.push(td);
      }
    }
  }

  const uri = context.documentState.pathIndex.get(key) ?? pathToUri(key);
  const docInfo = context.documentState.openDocuments.get(uri);

  if (context.log.enabled) context.log.debug(
    `republishMergedDiagnostics: ${key} single=${singleFile.length} cross=${crossFile.length} ts=${hasTsDiags ? context.tsDiagCache.get(key)?.length ?? 0 : 0}`,
  );

  const params: PublishDiagnosticsParams = { uri, diagnostics };
  if (docInfo?.version !== undefined) params.version = docInfo.version;
  context.connection.sendDiagnostics(params);
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
  if (!context.serverState.enableTsDiagnostics || !context.watchProgramReady) return;

  const ls = project.getLanguageService();
  const allOpen = getOpenDocumentPaths(context.documentState).filter(p =>
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
      const prev = context.tsDiagCache.get(p);
      if (!tsDiagsEqual(prev, tsDiags)) {
        if (tsDiags.length > 0) {
          context.tsDiagCache.set(p, tsDiags);
        } else {
          context.tsDiagCache.delete(p);
        }
        republishMergedDiagnostics(context, p);
      }
    }
    context.tsPropagationCancel = null;
  })();
}
