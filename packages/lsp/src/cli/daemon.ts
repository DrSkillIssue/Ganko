/**
 * Ganko Daemon Server
 *
 * Long-running background process that keeps a TypeScript program,
 * graph caches, file index, and Tailwind validator warm between `ganko lint`
 * invocations. Eliminates both the TS program build cost
 * and the per-file graph rebuild cost on repeated runs.
 *
 * Architecture follows Biome's daemon pattern:
 * - Listens on a platform-appropriate IPC path (Unix socket / Windows named pipe)
 * - Accepts JSON-RPC requests with Content-Length framing
 * - Serializes lint requests to prevent concurrent mutation of shared state
 * - Auto-shuts down after an idle timeout (default 5 minutes)
 * - Per-project isolation via hashed socket paths
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync, readFileSync, chmodSync, writeFileSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import { SolidPlugin, GraphCache, buildSolidGraph, runSolidRules, createSolidInput, resolveTailwindValidator, scanDependencyCustomProperties, setActivePolicy } from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, contentHash, createLogger, Level, type ESLintConfigResult } from "@drskillissue/ganko-shared";
import { createProject, type Project } from "../core/project";
import { createBatchProgram } from "../core/batch-program";
import { createFileIndex, type FileIndex } from "../core/file-index";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit, readCSSFilesFromDisk, runAllCrossFileDiagnostics } from "../core/analyze";
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

/**
 * Mutable daemon state holding the warm project and associated caches.
 *
 * All fields are persisted across lint requests. Caches are invalidated
 * only when the project root or exclude patterns change.
 */
interface DaemonState {
  startTime: number
  project: Project | null
  projectRoot: string
  server: Server
  idleTimer: ReturnType<typeof setTimeout> | null
  log: Logger
  closeLogFile: () => Promise<void>
  cache: GraphCache | null
  fileIndex: FileIndex | null
  tailwind: TailwindValidator | null
  externalCustomProperties: ReadonlySet<string> | null
  cssContentMap: Map<string, string> | null
  /** Serialization chain — each lint request awaits the previous one. */
  pending: Promise<void>
  /** Guard against double shutdown from concurrent signals. */
  shutdownStarted: boolean
  /** ESLint config cached from pre-warm or first lint. */
  eslintConfig: ESLintConfigResult | null
  /** Promise tracking the background pre-warm. Awaited on first lint to
   *  ensure the warm state is ready before proceeding. */
  prewarm: Promise<void> | null
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

  if (state.idleTimer !== null) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  state.server.close();

  /** Hard exit if pending work doesn't settle within 10s (prevents zombie). */
  const hardExit = setTimeout(() => {
    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath); } catch { /* already gone */ }
    state.log.error("hard exit: pending work did not settle within 10s");
    void state.closeLogFile().finally(() => {
      process.exit(1);
    });
  }, 10_000);
  hardExit.unref();

  void state.pending.finally(() => {
    clearTimeout(hardExit);
    if (state.project !== null) {
      try { state.project.dispose(); } catch { /* dispose is best-effort */ }
      state.project = null;
    }

    const sockPath = daemonSocketPath(state.projectRoot);
    try { unlinkSync(sockPath); } catch { /* already gone */ }

    state.log.info("daemon shut down");
    void state.closeLogFile().finally(() => {
      process.exit(0);
    });
  });
}

/** Compare two ReadonlySet instances for shallow equality. */
function setsEqual(a: ReadonlySet<string> | null, b: ReadonlySet<string>): boolean {
  if (a === null) return b.size === 0;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** Invalidate all caches when project root or excludes change. */
function invalidateCaches(state: DaemonState): void {
  state.cache = null;
  state.fileIndex = null;
  state.tailwind = null;
  state.externalCustomProperties = null;
  state.cssContentMap = null;
  state.eslintConfig = null;
}

async function handleLintRequest(
  state: DaemonState,
  request: LintRequest,
): Promise<DaemonResponse> {
  const params = request.params;
  const projectRoot = params.projectRoot;

  const log = state.log;

  /** Await background pre-warm if still in progress. The pre-warmed
   *  ESLint config is consumed once and cleared — subsequent requests
   *  must re-read the config file because it may change between runs. */
  let usedPrewarmConfig = false;
  if (state.prewarm !== null) {
    await state.prewarm;
    state.prewarm = null;
    usedPrewarmConfig = true;
  }

  /** H1: Load ESLint config — reuse pre-warm result only on the first
   *  request after pre-warm. Subsequent requests always re-read because
   *  the config file may be edited between lint invocations. */
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

    state.project = createProject({
      rootPath: projectRoot,
      plugins: [SolidPlugin],
      rules: eslintResult.overrides,
      log,
    });
  }

  setActivePolicy(params.accessibilityPolicy ?? null);
  const project = state.project;
  project.setRuleOverrides(eslintResult.overrides);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...params.exclude, ...eslintResult.globalIgnores]
    : params.exclude;

  /** H1: Rebuild FileIndex every request — files may be created/deleted
   * between invocations. The scan is single-digit ms; the TS project
   * service (which we keep warm) is the expensive part. */
  const previousSolidFiles = state.fileIndex !== null
    ? new Set(state.fileIndex.solidFiles)
    : null;
  state.fileIndex = createFileIndex(projectRoot, effectiveExclude, log);
  const fileIndex = state.fileIndex;

  /** H2: Evict GraphCache entries for files that no longer exist.
   * Prevents phantom diagnostics from deleted files in cross-file rules. */
  if (state.cache !== null && previousSolidFiles !== null) {
    for (const oldPath of previousSolidFiles) {
      if (!fileIndex.solidFiles.has(oldPath)) {
        state.cache.invalidate(oldPath);
      }
    }
  }

  let filesToLint: readonly string[];
  if (params.files.length > 0) {
    filesToLint = params.files;
  } else {
    filesToLint = fileIndex.allFiles();
  }

  const allDiagnostics: Diagnostic[] = [];

  const solidPathsToSync = params.crossFile
    ? [...fileIndex.solidFiles]
    : filesToLint.filter(path => classifyFile(path) === "solid");
  const solidContentByPath = new Map<string, string>();

  for (let i = 0, len = solidPathsToSync.length; i < len; i++) {
    const path = solidPathsToSync[i];
    if (!path) continue;

    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch {
      continue;
    }

    const key = canonicalPath(path);
    solidContentByPath.set(key, content);

    const sf = project.getSourceFile(key);
    if (sf === undefined || sf.text !== content) {
      project.updateFile(key, content);
    }
  }

  if (filesToLint.length === 0) {
    return { kind: "lint-response", id: request.id, diagnostics: [] };
  }

  /** Re-read CSS files from disk and diff against cached content.
   * Only invalidate the GraphCache CSS generation when content actually
   * changed, so cross-file results remain cached across no-op runs. */
  {
    const allCSSFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
    const previousContentMap = state.cssContentMap;
    const nextContentMap = new Map<string, string>();

    let cssChanged = previousContentMap === null;

    for (let i = 0, len = allCSSFiles.length; i < len; i++) {
      const cssFile = allCSSFiles[i];
      if (!cssFile) continue;
      nextContentMap.set(cssFile.path, cssFile.content);

      if (!cssChanged && previousContentMap !== null) {
        const prev = previousContentMap.get(cssFile.path);
        if (prev === undefined || prev !== cssFile.content) {
          cssChanged = true;
        }
      }
    }

    // Detect deleted CSS files
    if (!cssChanged && previousContentMap !== null) {
      for (const prevPath of previousContentMap.keys()) {
        if (!nextContentMap.has(prevPath)) {
          cssChanged = true;
          break;
        }
      }
    }

    state.cssContentMap = nextContentMap;

    if (cssChanged) {
      // Invalidate every CSS file in the cache so cssGeneration bumps
      // and getCachedCrossFileResults() / getCSSGraph() return misses.
      if (state.cache !== null) {
        for (const cssPath of nextContentMap.keys()) {
          state.cache.invalidate(cssPath);
        }
        // Also invalidate deleted CSS files so their cross-file
        // diagnostics are evicted and cssGeneration reflects the removal.
        if (previousContentMap !== null) {
          for (const prevPath of previousContentMap.keys()) {
            if (!nextContentMap.has(prevPath)) {
              state.cache.invalidate(prevPath);
            }
          }
        }
      }

      state.tailwind = await resolveTailwindValidator(allCSSFiles, log).catch((err) => {
        log.warning(`failed to resolve Tailwind validator: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
    }
  }

  /** H5: Re-scan external custom properties every request.
   * node_modules may change between runs (npm install). The scan reads
   * package.json + a few JS files per dependency — fast enough per-request.
   * When the set changes, invalidate the CSSGraph so it rebuilds with
   * the updated synthetic `:root` declarations. */
  {
    const nextExternal = scanDependencyCustomProperties(projectRoot);
    if (!setsEqual(state.externalCustomProperties, nextExternal) && state.cache !== null) {
      state.cache.invalidateAll();
    }
    state.externalCustomProperties = nextExternal;
  }

  /** H2: Persist GraphCache across requests. */
  if (state.cache === null) {
    state.cache = new GraphCache(log);
  }
  const cache = state.cache;

  /** Only rebuild SolidGraphs when the content hash changed —
   * avoids bumping solidGeneration on no-op runs, which would
   * invalidate CSSGraph/LayoutGraph/cross-file caches. */
  const program = project.getProgram();
  for (let i = 0, len = filesToLint.length; i < len; i++) {
    const path = filesToLint[i];
    if (!path) continue;
    if (classifyFile(path) === "css") continue;
    const key = canonicalPath(path);
    const content = solidContentByPath.get(key);
    if (content === undefined) {
      continue;
    }

    const version = contentHash(content);
    const needsRebuild = !cache.hasSolidGraph(key, version);

    if (needsRebuild) {
      const input = createSolidInput(key, program, log);
      const graph = buildSolidGraph(input);
      cache.setSolidGraph(key, version, graph);

      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(graph, input.sourceFile, emit);
      for (let j = 0, dLen = results.length; j < dLen; j++) {
        const result = results[j];
        if (!result) continue;
        allDiagnostics.push(result);
      }
    } else {
      // File unchanged — re-run rules on cached graph, no re-parse needed.
      // The cached graph contains all resolved type information from
      // buildSolidGraph. Rules read entity data, not the TypeChecker.
      const graph = cache.getCachedSolidGraph(key, version);
      if (graph === null) {
        log.warning(`getCachedSolidGraph miss after hasSolidGraph hit for ${key} v=${version}`);
        continue;
      }
      const sourceFile = program.getSourceFile(key);
      if (!sourceFile) continue;

      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(graph, sourceFile, emit);
      for (let j = 0, dLen = results.length; j < dLen; j++) {
        const result = results[j];
        if (!result) continue;
        allDiagnostics.push(result);
      }
    }
  }

  if (params.crossFile) {
    const cssContentMap = state.cssContentMap;
    const readContent = (path: string): string | null => {
      if (cssContentMap !== null) {
        const cached = cssContentMap.get(path);
        if (cached !== undefined) return cached;
      }
      try {
        /* Sync fallback for non-cached paths (e.g. inline styles). */
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    };

    const crossDiagnostics = runAllCrossFileDiagnostics(
      fileIndex,
      project,
      cache,
      state.tailwind,
      readContent,
      eslintResult.overrides,
      state.externalCustomProperties ?? new Set(),
    );

    if (params.files.length > 0) {
      const lintSet = new Set(filesToLint);
      for (let i = 0, len = crossDiagnostics.length; i < len; i++) {
        const d = crossDiagnostics[i];
        if (!d) continue;
        if (lintSet.has(d.file)) {
          allDiagnostics.push(d);
        }
      }
    } else {
      for (let i = 0, len = crossDiagnostics.length; i < len; i++) {
        const cd = crossDiagnostics[i];
        if (!cd) continue;
        allDiagnostics.push(cd);
      }
    }
  }

  return { kind: "lint-response", id: request.id, diagnostics: allDiagnostics };
}

/** Write a message to the socket, logging if the write fails due to backpressure or destroyed socket. */
function sendResponse(state: DaemonState, socket: Socket, message: DaemonResponse): void {
  if (!writeMessage(socket, message)) {
    state.log.warning(`write failed for response id=${String(message.id)} (socket destroyed or backpressure)`);
  }
}

function handleRequest(
  state: DaemonState,
  request: DaemonRequest,
  socket: Socket,
): void {
  if (state.shutdownStarted) {
    sendResponse(state, socket, {
      kind: "error-response",
      id: request.id,
      code: -32000,
      message: "daemon is shutting down",
    });
    return;
  }

  resetIdleTimer(state);

  switch (request.kind) {
    case "shutdown-request": {
      const response: DaemonResponse = {
        kind: "status-response",
        id: request.id,
        uptime: Date.now() - state.startTime,
        projectRoot: state.projectRoot,
        version: getVersion(),
      };
      sendResponse(state, socket, response);
      shutdown(state);
      return;
    }

    case "status-request": {
      const response: DaemonResponse = {
        kind: "status-response",
        id: request.id,
        uptime: Date.now() - state.startTime,
        projectRoot: state.projectRoot,
        version: getVersion(),
      };
      sendResponse(state, socket, response);
      return;
    }

    case "lint-request": {
      state.pending = state.pending.then(() => {
        if (state.idleTimer !== null) {
          clearTimeout(state.idleTimer);
          state.idleTimer = null;
        }
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          const errResponse: DaemonResponse = {
            kind: "error-response",
            id: request.id,
            code: -32603,
            message: "lint request timed out after 120s",
          };
          sendResponse(state, socket, errResponse);
        }, 120_000);
        return handleLintRequest(state, request).then(
          (response) => {
            if (!timedOut) sendResponse(state, socket, response);
          },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            state.log.error(`lint request failed: ${message}`);
            if (!timedOut) {
              const errResponse: DaemonResponse = {
                kind: "error-response",
                id: request.id,
                code: -32603,
                message,
              };
              sendResponse(state, socket, errResponse);
            }
          },
        ).finally(() => {
          clearTimeout(timer);
          resetIdleTimer(state);
        });
      });
      return;
    }
  }

  const _exhaustive: never = request;
  void _exhaustive;
}

/**
 * Probe whether an existing socket is alive by attempting a connection.
 *
 * @returns true if another daemon is actively listening, false if stale
 */
function isSocketAlive(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(sockPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      probe.destroy();
      resolve(false);
    });
    probe.setTimeout(1000, () => {
      probe.destroy();
      resolve(false);
    });
  });
}

/**
 * Write a PID file atomically via write-to-temp + rename.
 *
 * Prevents readers from seeing a partially-written PID when two
 * daemons race to start.
 */
async function writePidFile(pidPath: string): Promise<void> {
  const tmpPath = `${pidPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, String(process.pid), { mode: 0o600 });
  await rename(tmpPath, pidPath);
}

/**
 * Pre-warm the TS program in the background after daemon startup.
 *
 * Only warms resources that are expensive AND stable across request
 * configurations: the ESLint config and the TS program build (the
 * dominant cost). File index, Tailwind validator, CSS content map,
 * and dependency scan all depend on `--exclude` patterns from the CLI
 * invocation and are deferred to the first lint request.
 *
 * This matches the pattern used by Biome, oxlint, and eslint_d: only
 * pre-warm what doesn't depend on request params.
 */
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
      state.project = createProject({
        rootPath: projectRoot,
        plugins: [SolidPlugin],
        rules: eslintResult.overrides,
        log,
      });
    }

    /** Trigger full TS program build via createBatchProgram.
     *  The batch program is disposed immediately — its only purpose is
     *  to warm the filesystem cache and TypeScript's internal caches. */
    log.info("pre-warm: triggering TS program build via createBatchProgram");
    const batch = createBatchProgram(projectRoot);
    batch.dispose();
    if (state.shutdownStarted) return;

    log.info(`pre-warm: completed in ${(performance.now() - t0).toFixed(0)}ms`);
  } catch (err) {
    log.warning(`pre-warm: failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Start the daemon server for a given project root.
 *
 * Probes an existing socket before unlinking — if another daemon is
 * alive, exits instead of stealing its socket.
 */
export async function startDaemon(projectRoot: string): Promise<void> {
  const sockPath = daemonSocketPath(projectRoot);
  const pidPath = daemonPidPath(projectRoot);
  const logPath = daemonLogPath(projectRoot);

  /** H9: Probe existing socket before unlinking. */
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
    cache: null,
    fileIndex: null,
    tailwind: null,
    externalCustomProperties: null,
    cssContentMap: null,
    pending: Promise.resolve(),
    shutdownStarted: false,
    eslintConfig: null,
    prewarm: null,
  };

  server.on("connection", (socket: Socket) => {
    if (log.isLevelEnabled(Level.Debug)) log.debug("client connected");
    const feed = createRequestReader(
      (request) => { handleRequest(state, request, socket); },
      (id, message) => {
        const errResponse: DaemonResponse = {
          kind: "error-response",
          id: id ?? 0,
          code: -32600,
          message,
        };
        sendResponse(state, socket, errResponse);
      },
    );
    socket.on("data", feed);
    socket.on("error", () => { /* client disconnected */ });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error(`socket path already in use: ${sockPath}. Another daemon may be running.`);
    } else {
      log.error(`server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(sockPath, () => {
    /** Restrict socket to owner-only to prevent other local users from connecting.
     * Note: brief TOCTOU gap between listen() and chmod — using process-wide umask
     * would be worse (affects concurrent file operations). On most systems the /tmp
     * sticky bit prevents other users from connecting during this window. */
    if (process.platform !== "win32") {
      try { chmodSync(sockPath, 0o600); } catch { /* best-effort on non-Unix */ }
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

  process.on("exit", () => {
    try { unlinkSync(pidPath); } catch { /* best-effort */ }
  });
}
