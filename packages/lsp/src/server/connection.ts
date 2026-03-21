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
 * Cache invalidation is handled by ChangeProcessor — callers invoke
 * changeProcessor.processChanges() or changeProcessor.processWorkspaceChange()
 * instead of manual evict-then-rediagnose sequences.
 */

import {
  createConnection,
  ProposedFeatures,
  type Connection,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GraphCache } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import {
  classifyFile,
  contentHash,
  isToolingConfig,
  ALL_EXTENSIONS,
  prefixLogger,
  createLogger,
} from "@drskillissue/ganko-shared";
import { FilteredTextDocuments } from "./filtered-documents";
import type { Project } from "../core/project";
import type { FeatureHandlerContext } from "./handlers/handler-context";
import type { LifecyclePhase } from "./server-state";
import { readFileSync } from "node:fs";
import { buildSolidGraphForPath } from "../core/analyze";
import { createLspWriter, createFileWriter, createCompositeWriter, type Logger, type LeveledLogger } from "../core/logger";
import { GcTimer } from "./gc-timer";
import { MemoryWatcher } from "./memory-watcher";
import { ResourceMap } from "./resource-map";

import { type ServerState, createServerState, createServerConfig } from "./handlers/lifecycle";
import { publishFileDiagnostics, propagateTsDiagnostics } from "./diagnostics-push";

import { createResourceIdentity, type ResourceIdentity } from "./resource-identity";
import { DocumentManager } from "./document-manager";
import { DiagnosticsManager } from "./diagnostics-manager";
import { ChangeProcessor } from "./change-processor";
import { createTsService, type TsService } from "../core/ts-service";

import { setupLifecycleHandlers } from "./routing/lifecycle";
import { setupDocumentHandlers } from "./routing/document";
import { setupFeatureHandlers } from "./routing/feature";

function createFeatureHandlerContext(
  tsService: TsService,
  project: Project,
  graphCache: GraphCache,
  diagCache: ResourceMap<readonly Diagnostic[]>,
  handlerLog: Logger,
): FeatureHandlerContext {
  return {
    log: handlerLog,

    getLanguageService(_path) {
      return tsService.getLanguageService();
    },

    getSourceFile(path) {
      return tsService.getSourceFile(path);
    },

    getTSFileInfo(path) {
      const ls = tsService.getLanguageService();
      if (!ls) return null;
      const sf = tsService.getSourceFile(path);
      if (!sf) return null;
      return { ls, sf };
    },

    getAST(path) {
      return tsService.getSourceFile(path);
    },

    getDiagnostics(path) {
      return diagCache.get(path) ?? [];
    },

    getContent(path) {
      return tsService.getSourceFile(path)?.text ?? null;
    },

    getSolidGraph(path) {
      if (classifyFile(path) !== "solid") return null;
      const sourceFile = tsService.getSourceFile(path);
      if (!sourceFile) return null;
      const version = contentHash(sourceFile.text);
      return graphCache.getSolidGraph(path, version, buildSolidGraphForPath(project, path, graphCache.logger));
    },
  };
}


export interface ServerContext {
  // --- Infrastructure (always available) ---
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
  readonly serverState: ServerState
  readonly diagCache: ResourceMap<readonly Diagnostic[]>
  readonly graphCache: GraphCache
  readonly gcTimer: GcTimer
  readonly memoryWatcher: MemoryWatcher
  readonly identity: ResourceIdentity
  readonly docManager: DocumentManager
  readonly diagManager: DiagnosticsManager
  readonly changeProcessor: ChangeProcessor
  readonly tsService: TsService
  readonly ready: Promise<void>
  resolveReady(): void
  resolveContent(path: string): string | null
  tsPropagationCancel: (() => void) | null

  // --- Lifecycle phase (discriminated union) ---
  phase: LifecyclePhase
  /** Create FeatureHandlerContext for the project (phase stays unchanged). */
  setProject(project: Project): FeatureHandlerContext
}

/** Options for server creation. */
interface CreateServerOptions {
  readonly logFile?: string | undefined
  readonly enableTsDiagnostics?: boolean | undefined
  readonly warningsAsErrors?: boolean | undefined
}

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

  const diagCache = new ResourceMap<readonly Diagnostic[]>();
  const graphCache = new GraphCache(prefixLogger(log, "cache"));
  const gcTimer = new GcTimer(prefixLogger(log, "gc"));
  const memoryWatcher = new MemoryWatcher(prefixLogger(log, "memory"));

  const identity = createResourceIdentity();
  const docManager = new DocumentManager(identity);
  const diagManager = new DiagnosticsManager(identity, (uri, diags) => {
    connection.sendDiagnostics({ uri, diagnostics: [...diags] });
  });
  let changeProcessor: ChangeProcessor;
  let tsService: TsService | null = null;

  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  const config = createServerConfig();
  if (options?.enableTsDiagnostics) config.enableTsDiagnostics = true;
  if (options?.warningsAsErrors) config.warningsAsErrors = true;
  const serverState = createServerState(config);

  const context: ServerContext = {
    connection,
    documents,
    log,
    serverState,
    diagCache,
    graphCache,
    tsPropagationCancel: null,
    gcTimer,
    memoryWatcher,
    identity,
    docManager,
    diagManager,
    get changeProcessor() { return changeProcessor },
    get tsService(): TsService {
      if (tsService === null) {
        const rootPath = context.serverState.rootPath;
        if (!rootPath) throw new Error("tsService accessed before rootPath is set");
        tsService = createTsService(rootPath);
      }
      return tsService;
    },
    ready,
    resolveReady() { resolveReady(); },

    // Lifecycle phase
    phase: { tag: "initializing" },

    setProject(project) {
      context.tsService.setProject(project);
      return createFeatureHandlerContext(context.tsService, project, graphCache, diagCache, prefixLogger(log, "handler"));
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
  };

  changeProcessor = new ChangeProcessor(
    diagManager,
    graphCache,
    docManager,
    prefixLogger(log, "changes"),
    (path) => { const p = context.phase; if (p.tag === "running" || p.tag === "enriched") publishFileDiagnostics(context, p.project, path) },
    (exclude) => { const p = context.phase; if (p.tag === "running" || p.tag === "enriched") propagateTsDiagnostics(context, p.project, exclude) },
  );

  setupLifecycleHandlers(context);
  setupDocumentHandlers(context);
  setupFeatureHandlers(context);

  return context;
}

export function startServer(context: ServerContext): void {
  context.documents.listen(context.connection);
  context.connection.listen();
}

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
