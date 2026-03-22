/**
 * Ganko Daemon Server
 *
 * Long-running background process that keeps a TypeScript program,
 * compilation, file index, and Tailwind validator warm between `ganko lint`
 * invocations.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync, chmodSync, writeFileSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import {
  SolidPlugin,
  buildSolidSyntaxTree,
  buildCSSResult,
  runSolidRules,
  createSolidInput,
  createOverrideEmit,
  createStyleCompilation,
  createAnalysisDispatcher,
  allRules,
  prepareTailwindEval,
  buildTailwindValidatorFromEval,
  scanDependencyCustomProperties,
  setActivePolicy,
} from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator, CSSInput, SolidSyntaxTree } from "@drskillissue/ganko";
import { evaluateWorkspace } from "../core/workspace-eval";
import { canonicalPath, classifyFile, contentHash, createLogger, type ESLintConfigResult } from "@drskillissue/ganko-shared";
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

interface DaemonState {
  startTime: number
  project: Project | null
  projectRoot: string
  server: Server
  idleTimer: ReturnType<typeof setTimeout> | null
  log: Logger
  closeLogFile: () => Promise<void>
  fileIndex: FileRegistry | null
  tailwind: TailwindValidator | null
  externalCustomProperties: ReadonlySet<string> | null
  cssContentMap: Map<string, string> | null
  pending: Promise<void>
  shutdownStarted: boolean
  eslintConfig: ESLintConfigResult | null
  prewarm: Promise<void> | null
  /** Per-file solid tree cache — keyed by canonical path, stores version + tree */
  solidTrees: Map<string, { version: string; tree: SolidSyntaxTree }>
  /** Cached cross-file diagnostics — invalidated when any file changes */
  crossFileDiagnostics: readonly Diagnostic[] | null
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
  if (state.idleTimer !== null) { clearTimeout(state.idleTimer); state.idleTimer = null }
  state.server.close();
  const hardExit = setTimeout(() => {
    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath) } catch { /* already gone */ }
    state.log.error("hard exit: pending work did not settle within 10s");
    void state.closeLogFile().finally(() => { process.exit(1) });
  }, 10_000);
  hardExit.unref();
  void state.pending.finally(() => {
    clearTimeout(hardExit);
    if (state.project !== null) { try { state.project.dispose() } catch { /* best-effort */ }; state.project = null }
    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath) } catch { /* already gone */ }
    state.log.info("daemon shut down");
    void state.closeLogFile().finally(() => { process.exit(0) });
  });
}

function setsEqual(a: ReadonlySet<string> | null, b: ReadonlySet<string>): boolean {
  if (a === null) return b.size === 0;
  if (a.size !== b.size) return false;
  for (const item of a) { if (!b.has(item)) return false }
  return true;
}

function invalidateCaches(state: DaemonState): void {
  state.fileIndex = null;
  state.tailwind = null;
  state.externalCustomProperties = null;
  state.cssContentMap = null;
  state.eslintConfig = null;
  state.solidTrees.clear();
  state.crossFileDiagnostics = null;
}

async function handleLintRequest(
  state: DaemonState,
  request: LintRequest,
): Promise<DaemonResponse> {
  const params = request.params;
  const projectRoot = params.projectRoot;
  const log = state.log;

  let usedPrewarmConfig = false;
  if (state.prewarm !== null) { await state.prewarm; state.prewarm = null; usedPrewarmConfig = true }

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
    invalidateCaches(state);
    state.project = createProject({ rootPath: projectRoot, plugins: [SolidPlugin], rules: eslintResult.overrides, log });
  }

  setActivePolicy(params.accessibilityPolicy ?? null);
  const project = state.project;
  project.setRuleOverrides(eslintResult.overrides);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...params.exclude, ...eslintResult.globalIgnores] : params.exclude;

  const daemonRoot = acceptProjectRoot(projectRoot);
  const daemonLayout = buildWorkspaceLayout(daemonRoot, log);
  state.fileIndex = createFileRegistry(daemonLayout, effectiveExclude, log);
  const fileIndex = state.fileIndex;

  // Evict deleted solid files from cache
  for (const cachedPath of state.solidTrees.keys()) {
    if (!fileIndex.solidFiles.has(cachedPath)) {
      state.solidTrees.delete(cachedPath);
      state.crossFileDiagnostics = null;
    }
  }

  let filesToLint: readonly string[];
  if (params.files.length > 0) filesToLint = params.files;
  else filesToLint = fileIndex.allFiles();

  const allDiagnostics: Diagnostic[] = [];

  // Read solid file contents
  const solidPathsToSync = params.crossFile
    ? [...fileIndex.solidFiles]
    : filesToLint.filter(path => classifyFile(path) === "solid");
  const solidContentByPath = new Map<string, string>();

  for (let i = 0; i < solidPathsToSync.length; i++) {
    const path = solidPathsToSync[i]; if (!path) continue
    let content: string; try { content = await readFile(path, "utf-8") } catch { continue }
    const key = canonicalPath(path);
    solidContentByPath.set(key, content);
    const sf = project.getSourceFile(key);
    if (sf === undefined || sf.text !== content) project.updateFile(key, content);
  }

  if (filesToLint.length === 0) {
    return { kind: "lint-response", id: request.id, diagnostics: [] };
  }

  // CSS content diffing
  {
    const allCSSFiles = fileIndex.loadAllCSSContent();
    const previousContentMap = state.cssContentMap;
    const nextContentMap = new Map<string, string>();
    let cssChanged = previousContentMap === null;

    for (let i = 0; i < allCSSFiles.length; i++) {
      const cssFile = allCSSFiles[i]; if (!cssFile) continue
      nextContentMap.set(cssFile.path, cssFile.content);
      if (!cssChanged && previousContentMap !== null) {
        const prev = previousContentMap.get(cssFile.path);
        if (prev === undefined || prev !== cssFile.content) cssChanged = true;
      }
    }
    if (!cssChanged && previousContentMap !== null) {
      for (const prevPath of previousContentMap.keys()) { if (!nextContentMap.has(prevPath)) { cssChanged = true; break } }
    }
    state.cssContentMap = nextContentMap;

    if (cssChanged) {
      state.crossFileDiagnostics = null;
      const wsPackagePaths = Array.from(daemonLayout.packagePaths);
      const twParams = prepareTailwindEval(allCSSFiles, projectRoot, wsPackagePaths, log);
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
  }

  // External custom properties
  {
    const nextExternal = scanDependencyCustomProperties(daemonLayout);
    if (!setsEqual(state.externalCustomProperties, nextExternal)) {
      state.crossFileDiagnostics = null;
    }
    state.externalCustomProperties = nextExternal;
  }

  // Single-file solid analysis — build trees, run rules, cache
  const program = project.getProgram();
  for (let i = 0; i < filesToLint.length; i++) {
    const path = filesToLint[i]; if (!path) continue
    if (classifyFile(path) === "css") continue
    const key = canonicalPath(path);
    const content = solidContentByPath.get(key); if (content === undefined) continue
    const version = contentHash(content);

    const cached = state.solidTrees.get(key);
    let tree: SolidSyntaxTree;

    if (cached !== null && cached !== undefined && cached.version === version) {
      tree = cached.tree;
    } else {
      const input = createSolidInput(key, program, log);
      tree = buildSolidSyntaxTree(input, version);
      state.solidTrees.set(key, { version, tree });
      state.crossFileDiagnostics = null;
    }

    const sourceFile = program.getSourceFile(key);
    if (!sourceFile) continue;

    const { results, emit } = createEmit(eslintResult.overrides);
    runSolidRules(tree, sourceFile, emit);
    for (let j = 0; j < results.length; j++) { const d = results[j]; if (d) allDiagnostics.push(d) }
  }

  // Cross-file analysis via AnalysisDispatcher
  if (params.crossFile) {
    if (state.crossFileDiagnostics !== null) {
      // Use cached cross-file results
      if (params.files.length > 0) {
        const lintSet = new Set(filesToLint);
        for (let i = 0; i < state.crossFileDiagnostics.length; i++) {
          const d = state.crossFileDiagnostics[i]; if (d && lintSet.has(d.file)) allDiagnostics.push(d)
        }
      } else {
        for (let i = 0; i < state.crossFileDiagnostics.length; i++) {
          const d = state.crossFileDiagnostics[i]; if (d) allDiagnostics.push(d)
        }
      }
    } else {
      // Build compilation from cached trees + CSS
      let compilation = createStyleCompilation();
      for (const [, { tree }] of state.solidTrees) {
        compilation = compilation.withSolidTree(tree);
      }

      const cssContentMap = state.cssContentMap;
      if (cssContentMap !== null && cssContentMap.size > 0) {
        const cssFiles: { path: string; content: string }[] = [];
        for (const [path, content] of cssContentMap) cssFiles.push({ path, content });
        const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles, logger: log };
        if (state.tailwind !== null) cssInput.tailwind = state.tailwind;
        if (state.externalCustomProperties !== null && state.externalCustomProperties.size > 0) {
          cssInput.externalCustomProperties = state.externalCustomProperties;
        }
        const { trees } = buildCSSResult(cssInput);
        compilation = compilation.withCSSTrees(trees);
      }

      const dispatcher = createAnalysisDispatcher();
      for (let i = 0; i < allRules.length; i++) dispatcher.register(allRules[i]!);

      const crossResult = dispatcher.run(compilation);
      const hasOverrides = Object.keys(eslintResult.overrides).length > 0;

      const crossDiagnostics: Diagnostic[] = [];
      const crossEmit = hasOverrides
        ? createOverrideEmit((d: Diagnostic) => crossDiagnostics.push(d), eslintResult.overrides)
        : (d: Diagnostic) => crossDiagnostics.push(d);

      for (let i = 0; i < crossResult.diagnostics.length; i++) {
        const d = crossResult.diagnostics[i]; if (d) crossEmit(d);
      }

      state.crossFileDiagnostics = crossDiagnostics;

      if (params.files.length > 0) {
        const lintSet = new Set(filesToLint);
        for (let i = 0; i < crossDiagnostics.length; i++) {
          const d = crossDiagnostics[i]; if (d && lintSet.has(d.file)) allDiagnostics.push(d)
        }
      } else {
        for (let i = 0; i < crossDiagnostics.length; i++) {
          const d = crossDiagnostics[i]; if (d) allDiagnostics.push(d)
        }
      }
    }
  }

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
        if (state.idleTimer !== null) { clearTimeout(state.idleTimer); state.idleTimer = null }
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          sendResponse(state, socket, { kind: "error-response", id: request.id, code: -32603, message: "lint request timed out after 120s" });
        }, 120_000);
        return handleLintRequest(state, request).then(
          (response) => { if (!timedOut) sendResponse(state, socket, response) },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            state.log.error(`lint request failed: ${message}`);
            if (!timedOut) sendResponse(state, socket, { kind: "error-response", id: request.id, code: -32603, message });
          },
        ).finally(() => { clearTimeout(timer); resetIdleTimer(state) });
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
    probe.once("connect", () => { probe.destroy(); resolve(true) });
    probe.once("error", () => { probe.destroy(); resolve(false) });
    probe.setTimeout(1000, () => { probe.destroy(); resolve(false) });
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
    try { unlinkSync(sockPath) } catch { /* race — acceptable */ }
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
    cssContentMap: null,
    pending: Promise.resolve(),
    shutdownStarted: false,
    eslintConfig: null,
    prewarm: null,
    solidTrees: new Map(),
    crossFileDiagnostics: null,
  };

  server.on("connection", (socket: Socket) => {
    const feed = createRequestReader(
      (request) => { handleRequest(state, request, socket) },
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
      try { chmodSync(sockPath, 0o600) } catch { /* best-effort */ }
    }
    resetIdleTimer(state);
    void writePidFile(pidPath).then(() => {
      log.info(`daemon listening on ${sockPath} (pid=${process.pid})`);
    }).catch((err) => {
      log.warning(`failed to write PID file: ${err instanceof Error ? err.message : String(err)}`);
    });
    state.prewarm = prewarmDaemon(state);
  });

  process.on("SIGTERM", () => { shutdown(state) });
  process.on("SIGINT", () => { shutdown(state) });
  process.on("exit", () => { try { unlinkSync(pidPath) } catch { /* best-effort */ } });
}
