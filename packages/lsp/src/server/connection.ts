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
  ALL_EXTENSIONS,
  prefixLogger,
  createLogger,
  Level,
} from "@drskillissue/ganko-shared";
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
import { publishFileDiagnostics, propagateTsDiagnostics } from "./diagnostics-push";

import { createResourceIdentity, type ResourceIdentity } from "./resource-identity";
import { DocumentManager } from "./document-manager";
import { DiagnosticsManager } from "./diagnostics-manager";
import { ChangeProcessor } from "./change-processor";

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

  // --- New architecture modules (Phase 3+ migration) ---
  readonly identity: ResourceIdentity
  readonly docManager: DocumentManager
  readonly diagManager: DiagnosticsManager
  readonly changeProcessor: ChangeProcessor
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
  const graphCache = new GraphCache(prefixLogger(log, "cache"));
  const gcTimer = new GcTimer(prefixLogger(log, "gc"));
  const memoryWatcher = new MemoryWatcher(prefixLogger(log, "memory"));

  // New architecture modules
  const identity = createResourceIdentity();
  const docManager = new DocumentManager(identity);
  const diagManager = new DiagnosticsManager(identity, (uri, diags) => {
    connection.sendDiagnostics({ uri, diagnostics: [...diags] });
  });
  // ChangeProcessor wired after context is created (needs rediagnose callbacks)
  let changeProcessor: ChangeProcessor;

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
    tsPropagationCancel: null,
    gcTimer,
    memoryWatcher,
    identity,
    docManager,
    diagManager,
    get changeProcessor() { return changeProcessor },
    ready,
    resolveReady() { resolveReady(); },

    setProject(project) {
      context.project = project;
      context.handlerCtx = createHandlerContext(project, graphCache, diagCache, prefixLogger(log, "handler"));
    },

    resolveContent(path) {
      const tracked = docManager.getByPath(path);
      if (tracked !== null) {
        const doc = documents.get(tracked.uri);
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
      if (log.isLevelEnabled(Level.Debug)) log.debug(`evictFileCache: ${key}`);
      diagCache.delete(key);
      diagManager.evict(key);
      graphCache.invalidate(key);
    },

    rediagnoseAffected(changed, exclude) {
      const project = context.project;
      if (!project) return;
      if (changed.length === 0) return;

      changeProcessor.processChanges(
        changed.map(p => ({ path: p, kind: "changed" as const })),
        exclude,
      );
    },

    rediagnoseAll(clearTsCache = false) {
      const project = context.project;
      if (!project) return;

      graphCache.invalidateAll();
      diagCache.clear();
      diagManager.clear();
      const paths = docManager.openPaths();
      if (log.isLevelEnabled(Level.Debug)) log.debug(`rediagnoseAll: re-diagnosing ${paths.length} open files (clearTsCache=${clearTsCache})`);
      for (let i = 0, len = paths.length; i < len; i++) {
        const p = paths[i];
        if (!p) continue;
        publishFileDiagnostics(context, project, p);
      }
      propagateTsDiagnostics(context, project, new Set());
    },
  };

  // Wire ChangeProcessor now that context exists (callbacks reference context)
  changeProcessor = new ChangeProcessor(
    diagManager,
    graphCache,
    docManager,
    prefixLogger(log, "changes"),
    (path) => { if (context.project) publishFileDiagnostics(context, context.project, path) },
    (exclude) => { if (context.project) propagateTsDiagnostics(context, context.project, exclude) },
  );

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
