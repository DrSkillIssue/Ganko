/**
 * Ganko Daemon Server
 *
 * Long-running background process that keeps a TypeScript project service,
 * graph caches, file index, and Tailwind validator warm between `ganko lint`
 * invocations. Eliminates both the ~2-5s TS project service startup cost
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
import { SolidPlugin, GraphCache, buildSolidGraph, runSolidRules, resolveTailwindValidator, scanDependencyCustomProperties } from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, createLogger } from "@drskillissue/ganko-shared";
import { createProject, type Project } from "../core/project";
import { createFileIndex, type FileIndex } from "../core/file-index";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit, parseWithOptionalProgram, readCSSFilesFromDisk, runAllCrossFileDiagnostics } from "../core/analyze";
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

  void state.pending.finally(() => {
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

/** Invalidate all caches when project root or excludes change. */
function invalidateCaches(state: DaemonState): void {
  state.cache = null;
  state.fileIndex = null;
  state.tailwind = null;
  state.externalCustomProperties = null;
  state.cssContentMap = null;

}

async function handleLintRequest(
  state: DaemonState,
  request: LintRequest,
): Promise<DaemonResponse> {
  const params = request.params;
  const projectRoot = params.projectRoot;

  const log = state.log;

  /** H1: Load ESLint config once, use everywhere. */
  const eslintResult = params.noEslintConfig
    ? EMPTY_ESLINT_RESULT
    : await loadESLintConfig(projectRoot, params.eslintConfigPath, log).catch((err) => {
        log.warning(`failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
        return EMPTY_ESLINT_RESULT;
      });

  if (state.project === null || state.projectRoot !== projectRoot) {
    if (state.project !== null) {
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

  /** Invalidate CSS/Tailwind per-request — files may change on disk.
   * externalCustomProperties is kept warm — node_modules doesn't change
   * between lint runs. Restart the daemon after npm install. */
  state.cssContentMap = null;
  state.tailwind = null;

  let filesToLint: readonly string[];
  if (params.files.length > 0) {
    filesToLint = params.files;
  } else {
    filesToLint = fileIndex.allFiles();
  }

  if (filesToLint.length === 0) {
    return { kind: "lint-response", id: request.id, diagnostics: [] };
  }

  const allDiagnostics: Diagnostic[] = [];

  /** Read CSS files fresh each request — disk state may have changed. */
  if (state.cssContentMap === null) {
    const allCSSFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
    state.cssContentMap = new Map<string, string>();
    for (let i = 0, len = allCSSFiles.length; i < len; i++) {
      const cssFile = allCSSFiles[i];
      if (!cssFile) continue;
      state.cssContentMap.set(cssFile.path, cssFile.content);
    }

    /** H4: Cache Tailwind validator across requests. */
    state.tailwind = await resolveTailwindValidator(allCSSFiles).catch((err) => {
      log.warning(`failed to resolve Tailwind validator: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
  }

  /** H5: Cache external custom properties across requests. */
  if (state.externalCustomProperties === null) {
    state.externalCustomProperties = scanDependencyCustomProperties(projectRoot);
  }

  /** H2: Persist GraphCache across requests. */
  if (state.cache === null) {
    state.cache = new GraphCache(log);
  }
  const cache = state.cache;

  /** M3: Use async file reads to avoid blocking the event loop. */
  for (let i = 0, len = filesToLint.length; i < len; i++) {
    const path = filesToLint[i];
    if (!path) continue;
    if (classifyFile(path) === "css") continue;
    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch {
      continue;
    }

    const key = canonicalPath(path);
    project.updateFile(key, content);
    const program = project.getLanguageService(key)?.getProgram() ?? null;
    const input = parseWithOptionalProgram(key, content, program, log);
    const graph = buildSolidGraph(input);

    const version = project.getScriptVersion(key) ?? "0";
    cache.setSolidGraph(key, version, graph);

    const { results, emit } = createEmit(eslintResult.overrides);
    runSolidRules(graph, input.sourceCode, emit);
    for (let j = 0, dLen = results.length; j < dLen; j++) {
      const result = results[j];
      if (!result) continue;
      allDiagnostics.push(result);
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

  /* Close files in the TS project service that are no longer in the
     file index. Without this, every file opened via updateFile/getLanguageService
     across all requests accumulates in the project service, leaking memory. */
  const activeFiles = new Set(fileIndex.solidFiles);
  const openFiles = project.openFiles();
  let closed = 0;
  for (const openPath of openFiles) {
    if (!activeFiles.has(openPath)) {
      project.closeFile(openPath);
      closed++;
    }
  }
  if (closed > 0 && log.enabled) {
    log.debug(`closed ${closed} stale files from TS project service (${openFiles.size - closed} remain)`);
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
  };

  server.on("connection", (socket: Socket) => {
    if (log.enabled) log.debug("client connected");
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

    void writePidFile(pidPath).then(() => {
      log.info(`daemon listening on ${sockPath} (pid=${process.pid})`);
      resetIdleTimer(state);
    }).catch((err) => {
      log.warning(`failed to write PID file: ${err instanceof Error ? err.message : String(err)}`);
      resetIdleTimer(state);
    });
  });

  process.on("SIGTERM", () => { shutdown(state); });
  process.on("SIGINT", () => { shutdown(state); });

  process.on("exit", () => {
    try { unlinkSync(pidPath); } catch { /* best-effort */ }
  });
}
