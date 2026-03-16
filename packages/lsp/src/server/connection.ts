/**
 * LSP Connection Setup and Routing
 *
 * Main entry point for the LSP server. Sets up the connection,
 * routes requests to handlers, and coordinates components.
 *
 * HandlerContext is constructed from Project:
 * - getAST returns ts.SourceFile from project.getSourceFile()
 * - getDiagnostics delegates to project.run([path])
 * - getLanguageService/getSourceFile delegate to project
 *
 * Cache invalidation and dependent re-diagnosis are centralised in three
 * methods on ServerContext:
 * - `evictFileCache(path)` — pure cache invalidation, no side effects
 * - `rediagnoseAffected(paths)` — re-diagnoses open files whose
 *   cross-file diagnostics depend on the changed file kinds
 * - `rediagnoseAll()` — workspace-level invalidation + full re-diagnosis
 */

import {
  createConnection,
  ProposedFeatures,
  FileChangeType,
  type Connection,
  type PublishDiagnosticsParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GraphCache } from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, isToolingConfig, uriToPath, pathToUri, CROSS_FILE_DEPENDENTS, formatSnapshot, ALL_EXTENSIONS } from "@drskillissue/ganko-shared";
import { FilteredTextDocuments } from "./filtered-documents";
import type { FileKind, RuleOverrides } from "@drskillissue/ganko-shared";
import { runSingleFileDiagnostics, runCrossFileDiagnostics, buildSolidGraphForPath } from "../core/analyze";
import type { Project } from "../core/project";
import { createFileIndex, type FileIndex } from "../core/file-index";
import type { HandlerContext } from "./handlers/handler-context";
import { readFileSync } from "node:fs";

import {
  type ServerState,
  createServerState,
  handleInitialize,
  handleInitialized,
  handleShutdown,
  handleExit,
  isServerReady,
  handleConfigurationChange,
  reloadESLintConfig,
  effectiveExclude,
} from "./handlers/lifecycle";

import {
  type DocumentState,
  type PendingChange,
  createDocumentState,
  handleDidOpen,
  handleDidChange,
  handleDidClose,
  handleDidSave,
  flushPendingChanges,
} from "./handlers/document";
import { createLspWriter, createFileWriter, createCompositeWriter, type Logger, type LeveledLogger } from "../core/logger";
import { createLogger, prefixLogger } from "@drskillissue/ganko-shared";
import { parseLogLevel } from "@drskillissue/ganko-shared";
import { GcTimer } from "./gc-timer";
import { MemoryWatcher } from "./memory-watcher";

import { convertDiagnostics, clearDiagnostics } from "./handlers/diagnostics";
import { handleDefinition } from "./handlers/definition";
import { handleReferences } from "./handlers/references";
import { handleHover } from "./handlers/hover";
import { handleCompletion } from "./handlers/completion";
import { handlePrepareRename, handleRename } from "./handlers/rename";
import { handleCodeAction } from "./handlers/code-action";
import { handleSignatureHelp } from "./handlers/signature-help";
import { handleDocumentHighlight } from "./handlers/document-highlight";
import { handleLinkedEditingRanges } from "./handlers/linked-editing";
import { handleFoldingRanges } from "./handlers/folding-ranges";
import { handleSelectionRange } from "./handlers/selection-range";
import { handleDocumentSymbol } from "./handlers/document-symbol";
import { handleWorkspaceSymbol } from "./handlers/workspace-symbol";
import { handleSemanticTokens } from "./handlers/semantic-tokens";
import { handleInlayHint } from "./handlers/inlay-hint";
import { handleReactiveGraph } from "./handlers/reactive-graph";
import { getOpenDocumentPaths } from "./handlers/document";

/** Debounce delay for document changes in milliseconds. */
const DEBOUNCE_MS = 150;

/**
 * Create a HandlerContext from a Project.
 *
 * getAST returns the TypeScript SourceFile directly from the project.
 * getDiagnostics delegates to project.run().
 *
 * @param project - The ganko Project instance
 * @param graphCache - Versioned graph cache for cross-file analysis
 * @param diagCache - Shared diagnostic cache managed by the server
 * @returns HandlerContext for handlers
 */
function createHandlerContext(
  project: Project,
  graphCache: GraphCache,
  diagCache: Map<string, readonly Diagnostic[]>,
  handlerLog: Logger,
): HandlerContext {
  /* All HandlerContext methods receive paths already canonicalized by
     uriToPath() in the caller. No redundant canonicalPath() calls. */
  return {
    log: handlerLog,

    getLanguageService(_path) {
      return project.getLanguageService();
    },

    getSourceFile(path) {
      return project.getSourceFile(path) ?? null;
    },

    getTSFileInfo(path) {
      const ls = project.getLanguageService();
      if (!ls) return null;
      const sf = project.getSourceFile(path);
      if (!sf) return null;
      return { ls, sf };
    },

    getAST(path) {
      return project.getSourceFile(path) ?? null;
    },

    getDiagnostics(path) {
      return diagCache.get(path) ?? [];
    },

    getContent(path) {
      return project.getSourceFile(path)?.text ?? null;
    },

    getSolidGraph(path) {
      if (classifyFile(path) !== "solid") return null;
      const version = "0";
      return graphCache.getSolidGraph(path, version, buildSolidGraphForPath(project, path, graphCache.logger));
    },
  };
}

/**
 * Collect open file paths whose cross-file diagnostics are affected
 * by a batch of changed paths.
 *
 * Unions the dependent-kind sets for each changed path's kind via
 * `CROSS_FILE_DEPENDENTS`, then returns open files matching those kinds
 * (minus any in `exclude`).
 *
 * @param changed - Paths that changed in this batch
 * @param state - Document state (for open file enumeration)
 * @param exclude - Paths to skip (already diagnosed by caller)
 * @returns Open paths that need re-diagnosis
 */
function collectAffectedPaths(
  changed: readonly string[],
  state: DocumentState,
  exclude?: ReadonlySet<string>,
  logger?: Logger,
): string[] {
  const needed = new Set<FileKind>();
  for (let i = 0, len = changed.length; i < len; i++) {
    const changedPath = changed[i];
    if (!changedPath) continue;
    const deps = CROSS_FILE_DEPENDENTS[classifyFile(changedPath)];
    for (const dep of deps) needed.add(dep);
  }
  if (needed.size === 0) return [];

  const open = getOpenDocumentPaths(state);
  const out: string[] = [];
  for (let i = 0, len = open.length; i < len; i++) {
    const p = open[i];
    if (!p) continue;
    if (exclude !== undefined && exclude.has(p)) continue;
    if (needed.has(classifyFile(p))) out.push(p);
  }
  if (logger?.enabled) logger.trace(`collectAffectedPaths: ${changed.length} changed → kinds=[${[...needed].join(",")}] → ${out.length} affected`);
  return out;
}

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
 * Run single-file diagnostics and cache the results.
 *
 * Delegates to the shared analyze module and caches results.
 *
 * @param project - The ganko Project
 * @param diagCache - Diagnostic cache map
 * @param path - File path to analyze
 * @param content - In-memory content for unsaved buffers
 * @param overrides - Rule severity overrides
 * @returns The diagnostics produced
 */
function runDiagnostics(
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
 * Server context containing all state.
 *
 * Cache invalidation and dependent re-diagnosis are centralised in
 * `evictFileCache`, `rediagnoseAffected`, and `rediagnoseAll`.
 * Call sites evict per-file in a loop, then call `rediagnoseAffected`
 * once after the batch to avoid redundant re-diagnosis.
 */
export interface ServerContext {
  /** LSP connection */
  readonly connection: Connection
  /** Text document manager — only stores documents matching supported extensions */
  readonly documents: FilteredTextDocuments
  /** Logger routed through connection.console (supports runtime level changes) */
  readonly log: LeveledLogger
  /** Server lifecycle state */
  readonly serverState: ServerState
  /** Document tracking state */
  readonly documentState: DocumentState
  /** Handler context (set after project is created) */
  handlerCtx: HandlerContext | null
  /** Project reference for running diagnostics */
  project: Project | null
  /** Workspace file index for cross-file analysis */
  fileIndex: FileIndex | null
  /** Diagnostic results cache — refreshed per file on change */
  readonly diagCache: Map<string, readonly Diagnostic[]>
  /** Versioned graph cache for cross-file analysis */
  readonly graphCache: GraphCache
  /** Resolved Tailwind validator (null if project doesn't use Tailwind) */
  tailwindValidator: TailwindValidator | null
  /** CSS custom properties provided by external libraries (e.g., Kobalte's --kb-* properties) */
  externalCustomProperties?: ReadonlySet<string>
  /** Debounced GC after request handlers */
  readonly gcTimer: GcTimer
  /** Periodic memory monitoring with high-water-mark gating */
  readonly memoryWatcher: MemoryWatcher
  /** Set the project and wire HandlerContext */
  setProject(project: Project): void
  /**
   * Resolves when handleInitialized completes and the project is wired.
   * Document handlers must await this before accessing the project.
   */
  readonly ready: Promise<void>
  /** Resolve the readiness gate — called once at the end of handleInitialized */
  resolveReady(): void
  /**
   * Resolve current file content: open buffer first, disk fallback.
   *
   * @param path - Absolute file path
   * @returns File content or null if unreadable
   */
  resolveContent(path: string): string | null
  /**
   * Invalidate all caches (AST, diagnostics, graph) for a path.
   *
   * Does not trigger re-diagnosis of dependent files. Callers that
   * process batches must call `rediagnoseAffected` once after the loop.
   *
   * @param path - File path to invalidate
   */
  evictFileCache(path: string): void
  /**
   * Re-diagnose open files affected by a batch of changed paths.
   *
   * Classifies each changed path to determine what kinds of files
   * changed, then re-diagnoses all open files whose cross-file
   * diagnostics depend on those kinds:
   * - CSS changed → re-diagnose open Solid and CSS files
   * - Solid changed → re-diagnose open CSS files
   *
   * Skips paths already in `exclude` (e.g. paths that were just
   * diagnosed by the caller) to avoid redundant work.
   *
   * @param changed - Paths that changed in this batch
   * @param exclude - Paths to skip (already diagnosed by caller)
   */
  rediagnoseAffected(changed: readonly string[], exclude?: ReadonlySet<string>): void
  /**
   * Invalidate all caches and re-diagnose every open file.
   *
   * Used for workspace-level events (ESLint config change,
   * VS Code settings change) that affect all rules.
   */
  rediagnoseAll(): void
}

/**
 * Create a guarded handler that checks server readiness.
 *
 * @param getCtx - Function to get current handler context
 * @param isReady - Function to check server readiness
 * @param handler - The actual handler function
 * @param fallback - Value to return when server isn't ready
 * @returns Wrapped handler function
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
      if (log.enabled) log.warning(`${handlerName} threw (returning fallback): ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    } finally {
      const elapsed = performance.now() - t0;
      if (elapsed > 1) {
        if (log.enabled) log.debug(`${handlerName}: ${elapsed.toFixed(1)}ms`);
      }
      gc.scheduleCollect();
    }
  };
}

/** Options for server creation. */
interface CreateServerOptions {
  /** Path to a log file for debugging. Writes to both LSP connection and file when set. */
  readonly logFile?: string | undefined
}

/**
 * Create the LSP server.
 *
 * @param options - Optional server configuration
 * @returns Server context
 */
export function createServer(options?: CreateServerOptions): ServerContext {
  const connection = createConnection(ProposedFeatures.all);

  let log: LeveledLogger;
  if (options?.logFile !== undefined) {
    const file = createFileWriter(options.logFile);
    log = createLogger(createCompositeWriter(createLspWriter(connection), file.writer));
  } else {
    log = createLogger(createLspWriter(connection));
  }

  log.info("ganko server starting");

  const supportedExtensions = new Set<string>(ALL_EXTENSIONS);

  const documents = new FilteredTextDocuments(TextDocument, (uri: string) => {
    if (uri.endsWith(".d.ts")) return false;
    if (isToolingConfig(uri)) return false;
    const dotIdx = uri.lastIndexOf(".");
    if (dotIdx < 0) return false;
    return supportedExtensions.has(uri.slice(dotIdx));
  });

  const diagCache = new Map<string, readonly Diagnostic[]>();
  const graphCache = new GraphCache(prefixLogger(log, "cache"));
  const gcTimer = new GcTimer(prefixLogger(log, "gc"));
  const memoryWatcher = new MemoryWatcher(prefixLogger(log, "memory"));

  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  const context: ServerContext = {
    connection,
    documents,
    log,
    serverState: createServerState(),
    documentState: createDocumentState(),
    handlerCtx: null,
    project: null,
    fileIndex: null,
    diagCache,
    graphCache,
    tailwindValidator: null,
    gcTimer,
    memoryWatcher,
    ready,
    resolveReady() { resolveReady(); },

    setProject(project) {
      context.project = project;
      context.handlerCtx = createHandlerContext(project, graphCache, diagCache, prefixLogger(log, "handler"));
    },

    resolveContent(path) {
      const uri = context.documentState.pathIndex.get(canonicalPath(path));
      if (uri !== undefined) {
        const doc = documents.get(uri);
        if (doc) return doc.getText();
      }
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    },

    evictFileCache(path) {
      const key = canonicalPath(path);
      if (log.enabled) log.debug(`evictFileCache: ${key}`);
      diagCache.delete(key);
      graphCache.invalidate(key);
    },

    rediagnoseAffected(changed, exclude) {
      const project = context.project;
      if (!project) return;
      if (changed.length === 0) return;

      const affected = collectAffectedPaths(changed, context.documentState, exclude, log);
      if (affected.length > 0) {
        if (log.enabled) log.debug(`rediagnoseAffected: ${affected.length} files affected by ${changed.length} changes`);
      }
      for (let i = 0, len = affected.length; i < len; i++) {
        const affectedPath = affected[i];
        if (!affectedPath) continue;
        publishFileDiagnostics(context, project, affectedPath);
      }
    },

    rediagnoseAll() {
      const project = context.project;
      if (!project) return;

      graphCache.invalidateAll();
      diagCache.clear();
      const paths = getOpenDocumentPaths(context.documentState);
      if (log.enabled) log.debug(`rediagnoseAll: re-diagnosing ${paths.length} open files`);
      for (let i = 0, len = paths.length; i < len; i++) {
        const p = paths[i];
        if (!p) continue;
        publishFileDiagnostics(context, project, p);
      }
    },
  };

  setupLifecycleHandlers(context);
  setupDocumentHandlers(context);
  setupFeatureHandlers(context);

  return context;
}

/**
 * Start the server.
 *
 * @param context - Server context
 */
export function startServer(context: ServerContext): void {
  context.documents.listen(context.connection);
  context.connection.listen();
}

/**
 * Wire lifecycle handlers.
 *
 * @param context - Server context
 */
function setupLifecycleHandlers(context: ServerContext): void {
  const { connection, serverState } = context;

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
    handleShutdown(serverState, context.documentState, context.log, context);
  });

  connection.onExit(() => {
    const exitCode = handleExit(serverState);
    process.exit(exitCode);
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    await context.ready;
    let eslintConfigChanged = false;
    const changes = params.changes;
    const paths: string[] = new Array(changes.length);

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change) continue;
      const path = uriToPath(change.uri);
      paths[i] = path;

      if (path.endsWith("eslint.config.mjs") || path.endsWith("eslint.config.js") || path.endsWith("eslint.config.cjs")) {
        eslintConfigChanged = true;
      }

      if (change.type === FileChangeType.Created) {
        context.fileIndex?.add(path);
        context.evictFileCache(path);
      }
      if (change.type === FileChangeType.Changed) {
        context.evictFileCache(path);
      }
      if (change.type === FileChangeType.Deleted) {
        context.fileIndex?.remove(path);
        clearDiagnostics(connection, change.uri);
        context.evictFileCache(path);
      }
    }

    if (eslintConfigChanged && context.project) {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        context.fileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
      }
      if (outcome.overridesChanged || outcome.ignoresChanged) {
        context.rediagnoseAll();
        return;
      }
    }

    /** Collect which open files rediagnoseAffected will already cover,
     * so we avoid publishing diagnostics twice for the same file. */
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
        const open = getOpenDocumentPaths(context.documentState);
        for (let i = 0, len = open.length; i < len; i++) {
          const p = open[i];
          if (!p) continue;
          if (needed.has(classifyFile(p))) alreadyDiagnosed.add(p);
        }
      }
    }

    context.rediagnoseAffected(paths);

    /** Re-diagnose any changed files that are currently open but were NOT
     * already covered by rediagnoseAffected. Without this, an AI coder that
     * writes to disk triggers didChangeWatchedFiles but the changed file
     * itself is never re-diagnosed — cross-file diagnostics go missing. */
    if (context.project) {
      const project = context.project;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (!path) continue;
        const key = canonicalPath(path);
        if (alreadyDiagnosed.has(key)) continue;
        const uri = context.documentState.pathIndex.get(key);
        if (uri === undefined) continue;
        if (!context.documentState.openDocuments.has(uri)) continue;

        const doc = context.documents.get(uri);
        const content = doc !== undefined ? doc.getText() : undefined;
        if (context.log.enabled) context.log.debug(`didChangeWatchedFiles: re-diagnosing open file ${key}`);
        publishFileDiagnostics(context, project, key, content);
      }
    }
  });

  connection.onDidChangeConfiguration(async (params) => {
    const rawLevel = params?.settings?.solid?.logLevel;
    if (typeof rawLevel === "string") {
      context.log.setLevel(parseLogLevel(rawLevel, "info"));
    }

    const result = handleConfigurationChange(params, serverState);
    if (result === "none") return;

    if (result === "rebuild-index") {
      if (serverState.rootPath) {
        const excludes = effectiveExclude(serverState);
        const fileIndex = createFileIndex(serverState.rootPath, excludes, context.log);
        context.fileIndex = fileIndex;
        if (context.log.enabled) context.log.info(`file index rebuilt: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css (exclude: ${excludes.length} patterns)`);
      }
      context.rediagnoseAll();
      return;
    }

    if (result === "reload-eslint") {
      const outcome = await reloadESLintConfig(serverState, context.log);
      if (outcome.ignoresChanged && serverState.rootPath) {
        context.fileIndex = createFileIndex(serverState.rootPath, effectiveExclude(serverState), context.log);
      }
      if (!outcome.overridesChanged && !outcome.ignoresChanged) return;
    }

    context.rediagnoseAll();
  });
}

/**
 * Wire document handlers.
 *
 * @param context - Server context
 */
function setupDocumentHandlers(context: ServerContext): void {
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

    /* Phase 4: Merge cross-file diagnostics into changed files.
       Phase 2 published changed files with single-file diagnostics only
       (includeCrossFile=false). Phase 3 rebuilt cross-file results for
       the workspace. Republish each changed file by merging the cached
       single-file results with the now-available cross-file diagnostics.
       No re-parsing — reads from diagCache + graphCache only. */
    for (let i = 0, len = changes.length; i < len; i++) {
      const change = changes[i];
      if (!change) continue;
      republishMergedDiagnostics(context, change.path);
    }

    context.connection.tracer.log(
      `processChangesCallback: ${changes.length} changes, ${diagnosed.size} diagnosed in ${(performance.now() - t0).toFixed(1)}ms`,
    );
  }

  documents.onDidOpen(async (event) => {
    const path = handleDidOpen(event, documentState);
    await context.ready;
    if (context.log.enabled) context.log.debug(
      `didOpen: uri=${event.document.uri} path=${path} hasProject=${!!context.project} `
      + `version=${event.document.version} openDocs=${documentState.openDocuments.size}`,
    );
    const project = context.project;
    if (path && project) {
      if (context.log.enabled) context.log.debug(`didOpen: calling publishFileDiagnostics for ${path}`);
      publishFileDiagnostics(context, project, path, event.document.getText());
      if (context.log.enabled) context.log.debug(`didOpen: publishFileDiagnostics complete for ${path}`);
    }
  });

  documents.onDidChangeContent(async (event) => {
    if (context.log.enabled) context.log.debug(`didChange: uri=${event.document.uri} version=${event.document.version}`);
    await context.ready;
    const queued = handleDidChange(event, documentState);
    if (context.log.enabled) context.log.debug(`didChange: queued=${queued} hasProject=${!!context.project} pendingChanges=${documentState.pendingChanges.size}`);
    if (!queued || !context.project) return;

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
      if (context.log.enabled) context.log.debug(`didClose: cleared diag cache for ${key} (graph preserved)`);
    }
  });
}

/**
 * Wire feature handlers.
 *
 * @param context - Server context
 */
function setupFeatureHandlers(context: ServerContext): void {
  const { connection } = context;

  function getCtx(): HandlerContext | null {
    return context.handlerCtx;
  }

  function isReady(): boolean {
    return isServerReady(context.serverState);
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
      if (log.enabled) log.warning(`onSemanticTokens threw (returning fallback): ${e instanceof Error ? e.message : String(e)}`);
      return { data: [] };
    } finally {
      gc.scheduleCollect();
    }
  });
  connection.languages.inlayHint.on(createGuardedHandler(getCtx, isReady, log, "onInlayHint", handleInlayHint, null, gc));

  connection.onWorkspaceSymbol((params) => {
    const ctx = getCtx();
    if (!isReady() || !ctx) return null;
    const paths = getOpenDocumentPaths(context.documentState);
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
function publishFileDiagnostics(
  context: ServerContext,
  project: Project,
  path: string,
  content?: string,
  includeCrossFile = true,
): void {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  const resolved = content ?? (kind !== "unknown" ? context.handlerCtx?.getContent(key) ?? undefined : undefined);
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
  const diagnostics = convertDiagnostics(rawDiagnostics);
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
function republishMergedDiagnostics(
  context: ServerContext,
  path: string,
): void {
  const key = canonicalPath(path);
  const crossFile = context.graphCache.getCachedCrossFileDiagnostics(key);
  if (crossFile.length === 0) return;

  const singleFile = context.diagCache.get(key);
  if (singleFile === undefined) return;

  const rawDiagnostics = [...singleFile, ...crossFile];
  context.diagCache.set(key, rawDiagnostics);
  const diagnostics = convertDiagnostics(rawDiagnostics);
  const uri = context.documentState.pathIndex.get(key) ?? pathToUri(key);
  const docInfo = context.documentState.openDocuments.get(uri);

  if (context.log.enabled) context.log.debug(
    `republishMergedDiagnostics: ${key} single=${singleFile.length} cross=${crossFile.length} total=${rawDiagnostics.length}`,
  );

  const params: PublishDiagnosticsParams = { uri, diagnostics };
  if (docInfo?.version !== undefined) params.version = docInfo.version;
  context.connection.sendDiagnostics(params);
}

/**
 * CLI entry point - create and start the server.
 */
export function main(): void {
  const args = process.argv.slice(2);
  let logFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--log-file" && args[i + 1] !== undefined) {
      logFile = args[i + 1];
      break;
    }
  }
  const context = createServer({ logFile });
  startServer(context);
}
