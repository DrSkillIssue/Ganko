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
import { createCompilationTracker, createStyleCompilation } from "@drskillissue/ganko";
import type { CompilationTracker, TailwindValidator, BatchableTailwindValidator } from "@drskillissue/ganko";
import type ts from "typescript";
import {
  classifyFile,
  isToolingConfig,
  ALL_EXTENSIONS,
  prefixLogger,
  createLogger,
} from "@drskillissue/ganko-shared";
import type { WorkspaceLayout } from "@drskillissue/ganko-shared";
import { FilteredTextDocuments } from "./filtered-documents";
import type { Project } from "../core/project";
import type { FileRegistry } from "../core/file-registry";
import type { WorkspaceEvaluator } from "../core/workspace-eval";
import type { FeatureHandlerContext } from "./handlers/handler-context";
import type { LifecyclePhase } from "./session";
import { readFileSync } from "node:fs";
import { buildSolidTreeForFile } from "../core/compilation-builder";
import { createLspWriter, createFileWriter, createCompositeWriter, type Logger, type LeveledLogger } from "../core/logger";
import { GcTimer } from "./gc-timer";
import { MemoryWatcher } from "./memory-watcher";
import type { CancellationSource } from "./cancellation";
import type { ServerSession } from "./session";

import { type ServerState, type ServerConfig, createServerState, createServerConfig } from "./handlers/lifecycle";

import { createResourceIdentity, type ResourceIdentity } from "./resource-identity";
import { DocumentTracker } from "./document-tracker";
import { DiagnosticsManager } from "./diagnostics-manager";
import { createTsService, type TsService } from "../core/ts-service";

import { setupLifecycleHandlers } from "./routing/lifecycle";
import { setupDocumentHandlers } from "./routing/document";
import { setupFeatureHandlers } from "./routing/feature";

function createFeatureHandlerContext(
  tsService: TsService,
  project: Project,
  _tracker: CompilationTracker,
  diagManager: DiagnosticsManager,
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
      return diagManager.getRawDiagnostics(path);
    },

    getContent(path) {
      return tsService.getSourceFile(path)?.text ?? null;
    },

    getSolidSyntaxTree(path) {
      if (classifyFile(path) !== "solid") return null;
      const sourceFile = tsService.getSourceFile(path);
      if (!sourceFile) return null;
      return buildSolidTreeForFile(path, () => project.getProgram());
    },
  };
}


export interface ServerContext {
  // --- Infrastructure (always available) ---
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
  readonly serverState: ServerState
  graphCache: CompilationTracker
  readonly gcTimer: GcTimer
  readonly memoryWatcher: MemoryWatcher
  readonly identity: ResourceIdentity
  readonly docManager: DocumentTracker
  readonly diagManager: DiagnosticsManager
  readonly tsService: TsService
  readonly ready: Promise<void>
  resolveReady(): void
  resolveContent(path: string): string | null
  tsPropagationCancel: (() => void) | null

  /** Current diagnostic pipeline cancellation — cancelled on each coalesced change batch. */
  diagnosticCancellation: CancellationSource | null

  /** Current session snapshot — immutable, rebuilt on state changes. */
  session: ServerSession | null

  // --- Lifecycle phase (discriminated union) ---
  phase: LifecyclePhase
  /** Create FeatureHandlerContext for the project (phase stays unchanged). */
  setProject(project: Project): FeatureHandlerContext

  // --- ServerInfrastructure (for SessionMutator) ---
  getProject(): Project | null
  getTsCompilerOptions(): ts.CompilerOptions | null
  getRootPath(): string | null
  getConfig(): ServerConfig
  getFileRegistry(): FileRegistry | null
  getWorkspaceLayout(): WorkspaceLayout | null
  getTailwindValidator(): TailwindValidator | null
  getBatchableValidator(): BatchableTailwindValidator | null
  getExternalCustomProperties(): ReadonlySet<string> | undefined
  getEvaluator(): WorkspaceEvaluator | null

  /** Alias for graphCache — satisfies ServerInfrastructure.tracker */
  readonly tracker: CompilationTracker
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

  const graphCache = createCompilationTracker(createStyleCompilation(), { logger: prefixLogger(log, "cache") });
  const gcTimer = new GcTimer(prefixLogger(log, "gc"));
  const memoryWatcher = new MemoryWatcher(prefixLogger(log, "memory"));

  const identity = createResourceIdentity();
  const docManager = new DocumentTracker(identity);
  const diagManager = new DiagnosticsManager(identity, (uri, diags) => {
    const tracked = docManager.getByUri(uri);
    connection.sendDiagnostics(
      tracked?.version !== undefined
        ? { uri, diagnostics: [...diags], version: tracked.version }
        : { uri, diagnostics: [...diags] },
    );
  });
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
    graphCache,
    tsPropagationCancel: null,
    diagnosticCancellation: null,
    session: null,
    gcTimer,
    memoryWatcher,
    identity,
    docManager,
    diagManager,
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
      return createFeatureHandlerContext(context.tsService, project, graphCache, diagManager, prefixLogger(log, "handler"));
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

    // ServerInfrastructure implementation
    get tracker() { return graphCache; },
    getProject() { return context.serverState.project; },
    getTsCompilerOptions() { return context.tsService.getCompilerOptions(); },
    getRootPath() { return context.serverState.rootPath; },
    getConfig() { return context.serverState.config; },
    getFileRegistry() { const p = context.phase; return p.tag === "enriched" ? p.registry : null; },
    getWorkspaceLayout() { const p = context.phase; return p.tag === "enriched" ? p.layout : null; },
    getTailwindValidator() { const p = context.phase; return p.tag === "enriched" ? p.tailwindValidator : null; },
    getBatchableValidator() { const p = context.phase; return p.tag === "enriched" ? p.batchableValidator : null; },
    getExternalCustomProperties() { const p = context.phase; return p.tag === "enriched" ? p.externalCustomProperties : undefined; },
    getEvaluator() { const p = context.phase; return p.tag === "enriched" ? p.evaluator : null; },
  };

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
