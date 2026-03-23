/**
 * Ganko Daemon Server
 *
 * Long-running background process that keeps a CompilationTracker warm
 * between `ganko lint` invocations. Uses the same compilation infrastructure
 * as the LSP — no parallel caches.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync, chmodSync, writeFileSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import {
  SolidPlugin,
  runSolidRules,
  createCompilationTracker,
  createStyleCompilation,
  prepareTailwindEval,
  buildTailwindValidatorFromEval,
  scanDependencyCustomProperties,
  setActivePolicy,
} from "@drskillissue/ganko";
import type { Diagnostic, BatchableTailwindValidator, CompilationTracker } from "@drskillissue/ganko";
import { buildFullCompilation } from "../core/compilation-builder";
import { SessionMutator } from "../server/session-mutator";
import { createServerConfig, type ServerConfig } from "../server/handlers/lifecycle";
import { createCompilationDiagnosticProducer, type CompilationDiagnosticProducer } from "../core/compilation-diagnostic-producer";
import type { ServerSession } from "../server/session";
import type { ServerInfrastructure } from "../server/server-infrastructure";
import { evaluateWorkspace } from "../core/workspace-eval";
import { batchValidateTailwindClasses } from "../core/enrichment";
import { canonicalPath, classifyFile, contentHash, createLogger, type ESLintConfigResult, type WorkspaceLayout } from "@drskillissue/ganko-shared";
import { createProject, type Project } from "../core/project";
import { createFileRegistry, type FileRegistry } from "../core/file-registry";
import { acceptProjectRoot, buildWorkspaceLayout } from "@drskillissue/ganko-shared";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit } from "../core/analyze";
import { createFileWriter, type Logger } from "../core/logger";
import {
  daemonSocketPath,
  daemonPidPath,
  daemonLogPath,
  getVersion,
  DAEMON_IDLE_TIMEOUT_MS,
  writeMessage,
  createRequestReader,
  type DaemonRequest,
  type DaemonResponse,
  type LintRequest,
} from "./daemon-protocol";

interface DaemonState extends ServerInfrastructure {
  readonly startTime: number
  projectRoot: string
  readonly server: Server
  readonly log: Logger
  readonly closeLogFile: () => Promise<void>

  project: Project | null
  session: ServerSession | null
  tracker: CompilationTracker
  readonly mutator: SessionMutator
  readonly diagnosticProducer: CompilationDiagnosticProducer

  idleTimer: ReturnType<typeof setTimeout> | null
  pending: Promise<void>
  shutdownStarted: boolean
  eslintConfig: ESLintConfigResult | null
  prewarm: Promise<void> | null

  // ServerInfrastructure mutable state
  fileIndex: FileRegistry | null
  tailwind: BatchableTailwindValidator | null
  externalCustomProperties: ReadonlySet<string> | null
  layout: WorkspaceLayout | null
  config: ServerConfig
  contentVersions: Map<string, string>
}

function resetIdleTimer(state: DaemonState): void {
  if (state.idleTimer !== null) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.log.info("idle timeout reached, shutting down");
    shutdown(state);
  }, DAEMON_IDLE_TIMEOUT_MS);
}

function shutdown(state: DaemonState): void {
  if (state.shutdownStarted) return;
  state.shutdownStarted = true;
  if (state.idleTimer !== null) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  state.server.close();
  const hardExit = setTimeout(() => {
    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath); } catch { /* already gone */ }
    state.log.error("hard exit: pending work did not settle within 10s");
    void state.closeLogFile().finally(() => { process.exit(1); });
  }, 10_000);
  hardExit.unref();
  void state.pending.finally(() => {
    clearTimeout(hardExit);
    if (state.project !== null) { try { state.project.dispose(); } catch { /* best-effort */ }; state.project = null; }
    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath); } catch { /* already gone */ }
    state.log.info("daemon shut down");
    void state.closeLogFile().finally(() => { process.exit(0); });
  });
}

function invalidateAll(state: DaemonState): void {
  state.fileIndex = null;
  state.tailwind = null;
  state.externalCustomProperties = null;
  state.layout = null;
  state.eslintConfig = null;
  state.tracker = createCompilationTracker(createStyleCompilation());
  state.session = null;
  state.contentVersions.clear();
}

function setsEqual(a: ReadonlySet<string> | null, b: ReadonlySet<string>): boolean {
  if (a === null) return b.size === 0;
  if (a.size !== b.size) return false;
  for (const item of a) { if (!b.has(item)) return false; }
  return true;
}

async function handleLintRequest(
  state: DaemonState,
  request: LintRequest,
): Promise<DaemonResponse> {
  const params = request.params;
  const projectRoot = params.projectRoot;
  const log = state.log;

  let usedPrewarmConfig = false;
  if (state.prewarm !== null) { await state.prewarm; state.prewarm = null; usedPrewarmConfig = true; }

  let eslintResult: ESLintConfigResult;
  if (params.noEslintConfig) {
    eslintResult = EMPTY_ESLINT_RESULT;
  } else if (usedPrewarmConfig && state.eslintConfig !== null && params.eslintConfigPath === undefined) {
    eslintResult = state.eslintConfig;
    state.eslintConfig = null;
  } else {
    eslintResult = await loadESLintConfig(projectRoot, params.eslintConfigPath, log).catch((err) => {
      log.warning(`failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_ESLINT_RESULT;
    });
  }

  if (state.project === null || state.projectRoot !== projectRoot) {
    if (state.project !== null) {
      log.info(`project root changed from ${state.projectRoot} to ${projectRoot}, discarding warm state`);
      state.project.dispose();
    }
    state.projectRoot = projectRoot;
    invalidateAll(state);
    state.project = createProject({ rootPath: projectRoot, plugins: [SolidPlugin], rules: eslintResult.overrides, log });
  }

  setActivePolicy(params.accessibilityPolicy ?? null);
  const project = state.project;
  project.setRuleOverrides(eslintResult.overrides);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...params.exclude, ...eslintResult.globalIgnores] : params.exclude;

  state.config.ruleOverrides = eslintResult.overrides;
  const daemonRoot = acceptProjectRoot(projectRoot);
  const daemonLayout = buildWorkspaceLayout(daemonRoot, log);
  state.layout = daemonLayout;
  state.fileIndex = createFileRegistry(daemonLayout, effectiveExclude, log);
  const fileIndex = state.fileIndex;

  let filesToLint: readonly string[];
  if (params.files.length > 0) filesToLint = params.files;
  else filesToLint = fileIndex.allFiles();

  if (filesToLint.length === 0) {
    return { kind: "lint-response", id: request.id, diagnostics: [] };
  }

  const allDiagnostics: Diagnostic[] = [];
  const t0 = performance.now();

  // ── Sync solid files into TS project + detect changes ──

  const solidPathsToSync = params.crossFile
    ? [...fileIndex.solidFiles]
    : filesToLint.filter(path => classifyFile(path) === "solid");

  let anyFileChanged = false;
  const solidContentByPath = new Map<string, string>();

  for (let i = 0; i < solidPathsToSync.length; i++) {
    const path = solidPathsToSync[i]; if (!path) continue;
    let content: string; try { content = await readFile(path, "utf-8"); } catch { continue; }
    const key = canonicalPath(path);
    solidContentByPath.set(key, content);
    const version = contentHash(content);
    const prevVersion = state.contentVersions.get(key);
    if (prevVersion !== version) {
      state.contentVersions.set(key, version);
      project.updateFile(key, content);
      anyFileChanged = true;
    }
  }

  // CSS — read all, detect changes
  const allCSSContent = fileIndex.loadAllCSSContent();
  for (let i = 0; i < allCSSContent.length; i++) {
    const cssFile = allCSSContent[i]; if (!cssFile) continue;
    const key = canonicalPath(cssFile.path);
    const version = contentHash(cssFile.content);
    const prevVersion = state.contentVersions.get(key);
    if (prevVersion !== version) {
      state.contentVersions.set(key, version);
      anyFileChanged = true;
    }
  }

  // Evict deleted files from content versions
  for (const cachedPath of state.contentVersions.keys()) {
    if (!fileIndex.solidFiles.has(cachedPath) && !fileIndex.cssFiles.has(cachedPath)) {
      state.contentVersions.delete(cachedPath);
      anyFileChanged = true;
    }
  }

  const tSync = performance.now();
  log.info(`file sync: ${solidPathsToSync.length} solid + ${allCSSContent.length} css, changed=${anyFileChanged} in ${(tSync - t0).toFixed(0)}ms`);

  // ── Resolve inputs BEFORE compilation build ──

  // External custom properties (may change independently of file content)
  {
    const nextExternal = scanDependencyCustomProperties(daemonLayout);
    if (!setsEqual(state.externalCustomProperties, nextExternal)) {
      anyFileChanged = true;
    }
    state.externalCustomProperties = nextExternal;
  }

  // Tailwind re-resolution (must happen before compilation build so CSS
  // trees are parsed with the correct validator)
  const wsPackagePaths = Array.from(daemonLayout.packagePaths);
  const twParams = prepareTailwindEval(allCSSContent, projectRoot, wsPackagePaths, log);
  if (anyFileChanged) {
    if (twParams !== null) {
      const twResponse = await evaluateWorkspace(projectRoot, {
        type: "tailwind-init",
        tailwindModulePath: twParams.modulePath,
        tailwindEntryCss: twParams.entryCss,
        tailwindEntryBase: twParams.entryBase,
      }, log).catch(() => null);
      state.tailwind = twResponse !== null && twResponse.tailwind !== undefined
        ? buildTailwindValidatorFromEval(twResponse.tailwind.utilities, twResponse.tailwind.variants, log)
        : null;
    } else {
      state.tailwind = null;
    }
  }

  const tResolve = performance.now();
  log.info(`resolve inputs: ${(tResolve - tSync).toFixed(0)}ms`);

  // ── Build compilation when anything changed ──
  // Full rebuild via buildFullCompilation. The CompilationTracker wraps the
  // compilation and caches cross-file diagnostics across invocations.
  // Solid tree parsing requires ts.Program (tracker can't do this internally).
  // CSS tree parsing goes through buildCSSResult in the builder.
  // Full rebuild is correct — compilation construction is O(files), analysis
  // is O(rules × files). The compilation build is <5% of total lint time.
  if (anyFileChanged) {
    const resolveContent = (path: string): string | null => {
      const solidContent = solidContentByPath.get(path);
      if (solidContent !== undefined) return solidContent;
      for (let i = 0; i < allCSSContent.length; i++) {
        const f = allCSSContent[i];
        if (f && f.path === path) return f.content;
      }
      return null;
    };

    const { compilation } = buildFullCompilation({
      solidFiles: fileIndex.solidFiles,
      cssFiles: fileIndex.cssFiles,
      getProgram: () => project.getProgram(),
      tailwindValidator: state.tailwind,
      externalCustomProperties: state.externalCustomProperties !== null && state.externalCustomProperties.size > 0
        ? state.externalCustomProperties : undefined,
      resolveContent,
      logger: log,
    });
    state.tracker = createCompilationTracker(compilation);
    state.session = state.mutator.buildSession(state);
    log.info(`compilation build: ${compilation.solidTrees.size} solid + ${compilation.cssTrees.size} css in ${(performance.now() - tResolve).toFixed(0)}ms`);

    if (state.tailwind !== null && "preloadBatch" in state.tailwind && twParams !== null) {
      await batchValidateTailwindClasses(compilation, state.tailwind, twParams, projectRoot, null, log);
    }
  }

  const tAnalysis = performance.now();

  // ── Single-file solid analysis ──

  const compilation = state.tracker.currentCompilation;
  for (let i = 0; i < filesToLint.length; i++) {
    const path = filesToLint[i]; if (!path) continue;
    if (classifyFile(path) === "css") continue;
    const key = canonicalPath(path);
    const tree = compilation.getSolidTree(key);
    if (!tree) continue;
    const sourceFile = project.getProgram().getSourceFile(key);
    if (!sourceFile) continue;

    const { results, emit } = createEmit(eslintResult.overrides);
    runSolidRules(tree, sourceFile, emit);
    for (let j = 0; j < results.length; j++) { const d = results[j]; if (d) allDiagnostics.push(d); }
  }

  const tCrossFile = performance.now();
  log.info(`single-file: ${allDiagnostics.length} diagnostics in ${(tCrossFile - tAnalysis).toFixed(0)}ms`);

  // ── Cross-file analysis via AnalysisDispatcher ──

  if (params.crossFile) {
    const cachedResults = state.tracker.getCachedCrossFileResults();

    if (cachedResults !== null) {
      // Use cached cross-file results from tracker
      if (params.files.length > 0) {
        const lintSet = new Set(filesToLint);
        for (const [file, diags] of cachedResults) {
          if (!lintSet.has(file)) continue;
          for (let i = 0; i < diags.length; i++) { const d = diags[i]; if (d) allDiagnostics.push(d); }
        }
      } else {
        for (const [, diags] of cachedResults) {
          for (let i = 0; i < diags.length; i++) { const d = diags[i]; if (d) allDiagnostics.push(d); }
        }
      }
    } else {
      // Run cross-file analysis via shared CompilationDiagnosticProducer
      const crossByFile = state.diagnosticProducer.runAll(compilation, eslintResult.overrides);

      // Flatten for tracker cache
      const crossFlat: Diagnostic[] = [];
      for (const [, diags] of crossByFile) {
        for (let i = 0; i < diags.length; i++) { const d = diags[i]; if (d) crossFlat.push(d); }
      }
      state.tracker.setCachedCrossFileResults(crossFlat);

      // Collect for response
      if (params.files.length > 0) {
        const lintSet = new Set(filesToLint);
        for (const [file, diags] of crossByFile) {
          if (!lintSet.has(file)) continue;
          for (let i = 0; i < diags.length; i++) { const d = diags[i]; if (d) allDiagnostics.push(d); }
        }
      } else {
        for (const [, diags] of crossByFile) {
          for (let i = 0; i < diags.length; i++) { const d = diags[i]; if (d) allDiagnostics.push(d); }
        }
      }
    }
  }

  log.info(`analysis: ${allDiagnostics.length} diagnostics in ${(performance.now() - tAnalysis).toFixed(0)}ms (total: ${(performance.now() - t0).toFixed(0)}ms)`);
  return { kind: "lint-response", id: request.id, diagnostics: allDiagnostics };
}

function sendResponse(state: DaemonState, socket: Socket, message: DaemonResponse): void {
  if (!writeMessage(socket, message)) {
    state.log.warning(`write failed for response id=${String(message.id)} (socket destroyed or backpressure)`);
  }
}

function handleRequest(state: DaemonState, request: DaemonRequest, socket: Socket): void {
  if (state.shutdownStarted) {
    sendResponse(state, socket, { kind: "error-response", id: request.id, code: -32000, message: "daemon is shutting down" });
    return;
  }
  resetIdleTimer(state);
  switch (request.kind) {
    case "shutdown-request": {
      sendResponse(state, socket, { kind: "status-response", id: request.id, uptime: Date.now() - state.startTime, projectRoot: state.projectRoot, version: getVersion() });
      shutdown(state);
      return;
    }
    case "status-request": {
      sendResponse(state, socket, { kind: "status-response", id: request.id, uptime: Date.now() - state.startTime, projectRoot: state.projectRoot, version: getVersion() });
      return;
    }
    case "lint-request": {
      state.pending = state.pending.then(() => {
        if (state.idleTimer !== null) { clearTimeout(state.idleTimer); state.idleTimer = null; }
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          sendResponse(state, socket, { kind: "error-response", id: request.id, code: -32603, message: "lint request timed out after 120s" });
        }, 120_000);
        return handleLintRequest(state, request).then(
          (response) => { if (!timedOut) sendResponse(state, socket, response); },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            state.log.error(`lint request failed: ${message}`);
            if (!timedOut) sendResponse(state, socket, { kind: "error-response", id: request.id, code: -32603, message });
          },
        ).finally(() => { clearTimeout(timer); resetIdleTimer(state); });
      });
      return;
    }
  }
  const _exhaustive: never = request;
  void _exhaustive;
}

function isSocketAlive(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(sockPath);
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => { probe.destroy(); resolve(false); });
    probe.setTimeout(1000, () => { probe.destroy(); resolve(false); });
  });
}

async function writePidFile(pidPath: string): Promise<void> {
  const tmpPath = `${pidPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, String(process.pid), { mode: 0o600 });
  await rename(tmpPath, pidPath);
}

async function prewarmDaemon(state: DaemonState): Promise<void> {
  const { log, projectRoot } = state;
  const t0 = performance.now();
  log.info("pre-warm: starting background initialization");
  try {
    const eslintResult = await loadESLintConfig(projectRoot, undefined, log).catch((err) => {
      log.warning(`pre-warm: failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_ESLINT_RESULT;
    });
    if (state.shutdownStarted) return;
    state.eslintConfig = eslintResult;
    if (state.project === null) {
      state.project = createProject({ rootPath: projectRoot, plugins: [SolidPlugin], rules: eslintResult.overrides, log });
    }
    log.info(`pre-warm: completed in ${(performance.now() - t0).toFixed(0)}ms`);
  } catch (err) {
    log.warning(`pre-warm: failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function startDaemon(projectRoot: string): Promise<void> {
  const sockPath = daemonSocketPath(projectRoot);
  const pidPath = daemonPidPath(projectRoot);
  const logPath = daemonLogPath(projectRoot);

  if (existsSync(sockPath)) {
    const alive = await isSocketAlive(sockPath);
    if (alive) {
      process.stderr.write(`ganko: daemon already running for ${projectRoot}\n`);
      process.exit(1);
    }
    try { unlinkSync(sockPath); } catch { /* race — acceptable */ }
  }

  writeFileSync(logPath, "", { mode: 0o600 });
  const { writer: fileWriter, close: closeLogFile } = createFileWriter(logPath);
  const log: Logger = createLogger(fileWriter, "info");

  const server = createServer();

  const state: DaemonState = {
    startTime: Date.now(),
    project: null,
    projectRoot,
    server,
    idleTimer: null,
    log,
    closeLogFile,
    fileIndex: null,
    tailwind: null,
    externalCustomProperties: null,
    layout: null,
    config: createServerConfig(),
    pending: Promise.resolve(),
    shutdownStarted: false,
    eslintConfig: null,
    prewarm: null,
    tracker: createCompilationTracker(createStyleCompilation()),
    session: null,
    mutator: new SessionMutator(),
    diagnosticProducer: createCompilationDiagnosticProducer(),
    contentVersions: new Map(),

    // ServerInfrastructure
    getProject() { return state.project; },
    getTsCompilerOptions() { return null; },
    getRootPath() { return state.projectRoot; },
    getConfig() { return state.config; },
    getFileRegistry() { return state.fileIndex; },
    getWorkspaceLayout() { return state.layout; },
    getTailwindValidator() { return state.tailwind; },
    getBatchableValidator() { return null; },
    getExternalCustomProperties() { return state.externalCustomProperties !== null && state.externalCustomProperties.size > 0 ? state.externalCustomProperties : undefined; },
    getEvaluator() { return null; },
  };

  server.on("connection", (socket: Socket) => {
    const feed = createRequestReader(
      (request) => { handleRequest(state, request, socket); },
      (id, message) => {
        sendResponse(state, socket, { kind: "error-response", id: id ?? 0, code: -32600, message });
      },
    );
    socket.on("data", feed);
    socket.on("error", () => { /* client disconnected */ });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") log.error(`socket path already in use: ${sockPath}`);
    else log.error(`server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(sockPath, () => {
    if (process.platform !== "win32") {
      try { chmodSync(sockPath, 0o600); } catch { /* best-effort */ }
    }
    resetIdleTimer(state);
    void writePidFile(pidPath).then(() => {
      log.info(`daemon listening on ${sockPath} (pid=${process.pid})`);
    }).catch((err) => {
      log.warning(`failed to write PID file: ${err instanceof Error ? err.message : String(err)}`);
    });
    state.prewarm = prewarmDaemon(state);
  });

  process.on("SIGTERM", () => { shutdown(state); });
  process.on("SIGINT", () => { shutdown(state); });
  process.on("exit", () => { try { unlinkSync(pidPath); } catch { /* best-effort */ } });
}
