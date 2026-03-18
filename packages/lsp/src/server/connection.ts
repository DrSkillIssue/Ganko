/**
 * LSP Server Context and Factory
 *
 * Defines ServerContext — the shared state object passed to all handlers —
 * and exports the factory functions used to create and start the server.
 *
 * Handler routing is split across dedicated modules:
 * - routing/lifecycle.ts  — initialize, shutdown, watchedFiles, configuration
 * - routing/document.ts   — didOpen, didChange (debounced), didSave, didClose
 * - routing/feature.ts    — all LSP feature requests + pull diagnostics
 *
 * Diagnostic push is in diagnostics-push.ts:
 * - publishFileDiagnostics, propagateTsDiagnostics (exported for lifecycle.ts)
 *
 * Cache invalidation is centralised in three ServerContext methods:
 * - evictFileCache(path)     — pure cache invalidation, no side effects
 * - rediagnoseAffected(paths) — re-diagnoses open files depending on changed kinds
 * - rediagnoseAll()          — workspace-level invalidation + full re-diagnosis
 */

import {
  createConnection,
  ProposedFeatures,
  type Connection,
  type Diagnostic as LSPDiagnostic,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import ts from "typescript";
import { GraphCache } from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator } from "@drskillissue/ganko";
import {
  canonicalPath,
  classifyFile,
  contentHash,
  isToolingConfig,
  CROSS_FILE_DEPENDENTS,
  ALL_EXTENSIONS,
  prefixLogger,
  createLogger,
} from "@drskillissue/ganko-shared";
import type { FileKind } from "@drskillissue/ganko-shared";
import { FilteredTextDocuments } from "./filtered-documents";
import type { Project } from "../core/project";
import type { FileIndex } from "../core/file-index";
import type { HandlerContext } from "./handlers/handler-context";
import { readFileSync } from "node:fs";
import { buildSolidGraphForPath } from "../core/analyze";
import { createLspWriter, createFileWriter, createCompositeWriter, type Logger, type LeveledLogger } from "../core/logger";
import { GcTimer } from "./gc-timer";
import { MemoryWatcher } from "./memory-watcher";

import { type ServerState, createServerState } from "./handlers/lifecycle";
import { type DocumentState, createDocumentState, getOpenDocumentPaths } from "./handlers/document";
import { publishFileDiagnostics, propagateTsDiagnostics } from "./diagnostics-push";

import { setupLifecycleHandlers } from "./routing/lifecycle";
import { setupDocumentHandlers } from "./routing/document";
import { setupFeatureHandlers } from "./routing/feature";

/**
 * Create a HandlerContext from a Project.
 *
 * getAST returns the TypeScript SourceFile directly from the project.
 * getDiagnostics delegates to the diagCache (populated by runDiagnostics).
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
      const sourceFile = project.getSourceFile(path);
      if (!sourceFile) return null;
      const version = contentHash(sourceFile.text);
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
 * Server context containing all state.
 *
 * Cache invalidation and dependent re-diagnosis are centralised in
 * `evictFileCache`, `rediagnoseAffected`, and `rediagnoseAll`.
 * Call sites evict per-file in a loop, then call `rediagnoseAffected`
 * once after the batch to avoid redundant re-diagnosis.
 */
export interface ServerContext {
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
  readonly serverState: ServerState
  readonly documentState: DocumentState
  handlerCtx: HandlerContext | null
  project: Project | null
  fileIndex: FileIndex | null
  readonly diagCache: Map<string, readonly Diagnostic[]>
  readonly graphCache: GraphCache
  tailwindValidator: TailwindValidator | null
  externalCustomProperties?: ReadonlySet<string>
  cachedCompilerOptions: ts.CompilerOptions | null
  cachedTier1Host: ts.CompilerHost | null
  watchProgramReady: boolean
  workspaceReady: boolean
  readonly tsDiagCache: Map<string, readonly LSPDiagnostic[]>
  tsPropagationCancel: (() => void) | null
  readonly gcTimer: GcTimer
  readonly memoryWatcher: MemoryWatcher
  setProject(project: Project): void
  /**
   * Resolves when handleInitialized completes and the project is wired.
   * Document handlers must await this before accessing the project.
   */
  readonly ready: Promise<void>
  resolveReady(): void
  resolveContent(path: string): string | null
  evictFileCache(path: string): void
  rediagnoseAffected(changed: readonly string[], exclude?: ReadonlySet<string>): void
  rediagnoseAll(clearTsCache?: boolean): void
}

/** Options for server creation. */
interface CreateServerOptions {
  readonly logFile?: string | undefined
  readonly enableTsDiagnostics?: boolean | undefined
  readonly warningsAsErrors?: boolean | undefined
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
  const tsDiagCache = new Map<string, readonly LSPDiagnostic[]>();
  const graphCache = new GraphCache(prefixLogger(log, "cache"));
  const gcTimer = new GcTimer(prefixLogger(log, "gc"));
  const memoryWatcher = new MemoryWatcher(prefixLogger(log, "memory"));

  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  const serverState = createServerState();
  if (options?.enableTsDiagnostics) serverState.enableTsDiagnostics = true;
  if (options?.warningsAsErrors) serverState.warningsAsErrors = true;

  const context: ServerContext = {
    connection,
    documents,
    log,
    serverState,
    documentState: createDocumentState(),
    handlerCtx: null,
    project: null,
    fileIndex: null,
    diagCache,
    graphCache,
    tailwindValidator: null,
    cachedCompilerOptions: null,
    cachedTier1Host: null,
    watchProgramReady: false,
    workspaceReady: false,
    tsDiagCache,
    tsPropagationCancel: null,
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
      tsDiagCache.delete(key);
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

    rediagnoseAll(clearTsCache = false) {
      const project = context.project;
      if (!project) return;

      graphCache.invalidateAll();
      diagCache.clear();
      if (clearTsCache) tsDiagCache.clear();
      const paths = getOpenDocumentPaths(context.documentState);
      if (log.enabled) log.debug(`rediagnoseAll: re-diagnosing ${paths.length} open files (clearTsCache=${clearTsCache})`);
      for (let i = 0, len = paths.length; i < len; i++) {
        const p = paths[i];
        if (!p) continue;
        publishFileDiagnostics(context, project, p);
      }
      propagateTsDiagnostics(context, project, new Set());
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
 * CLI entry point — create and start the server.
 */
export function main(): void {
  const args = process.argv.slice(2);
  let logFile: string | undefined;
  let enableTsDiagnostics = false;
  let warningsAsErrors = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--log-file" && args[i + 1] !== undefined) {
      logFile = args[i + 1];
      i++;
    } else if (args[i] === "--enable-ts") {
      enableTsDiagnostics = true;
    } else if (args[i] === "--warnings-as-errors") {
      warningsAsErrors = true;
    }
  }
  const context = createServer({ logFile, enableTsDiagnostics, warningsAsErrors });
  startServer(context);
}
