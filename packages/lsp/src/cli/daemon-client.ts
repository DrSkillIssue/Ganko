/**
 * Daemon Client
 *
 * Connects to a running ganko daemon over IPC, or auto-starts one if
 * none is running (Biome's ensure_daemon pattern). Provides typed
 * request/response methods for lint, status, and shutdown.
 */
import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  daemonSocketPath,
  MAX_CONNECT_RETRIES,
  CONNECT_RETRY_DELAY_MS,
  CONNECT_TIMEOUT_MS,
  writeMessage,
  createResponseReader,
  type DaemonResponse,
  type LintRequestParams,
} from "./daemon-protocol";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Attempt a single connection to the daemon socket with a timeout.
 *
 * M5: Prevents hanging forever if the OS socket layer is stuck.
 */
function tryConnect(sockPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(sockPath);

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error("connection timeout"));
    });

    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

/**
 * Spawn the daemon as a detached background process.
 *
 * Uses the same Node binary and ganko entry point, passing the
 * `daemon start --project-root <root>` subcommand. The child is
 * detached and unref'd so it survives the parent's exit.
 */
/** Detect Bun-compiled single-file executable where process.execPath IS the CLI binary. */
function isBunCompiled(): boolean {
  return process.versions["bun"] !== undefined && process.execPath === process.argv[0];
}

function spawnDaemon(projectRoot: string): void {
  const args = isBunCompiled()
    ? ["daemon", "start", "--project-root", projectRoot]
    : [resolve(__dirname, "entry.js"), "daemon", "start", "--project-root", projectRoot];
  const child = spawn(
    process.execPath,
    args,
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();
}

/**
 * Connect to a running daemon, auto-starting one if needed.
 *
 * Retries up to MAX_CONNECT_RETRIES times with CONNECT_RETRY_DELAY_MS
 * between attempts. On first failure, spawns a daemon and keeps retrying.
 *
 * @param projectRoot - Absolute project root path
 * @returns Connected socket, or null if connection failed after all retries
 */
export async function ensureDaemon(projectRoot: string): Promise<Socket | null> {
  const sockPath = daemonSocketPath(projectRoot);
  let spawned = false;

  for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt++) {
    try {
      return await tryConnect(sockPath);
    } catch {
      if (!spawned) {
        spawnDaemon(projectRoot);
        spawned = true;
      }
      await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }

  return null;
}

/** Check if a daemon is running without starting one. */
export async function probeDaemon(projectRoot: string): Promise<Socket | null> {
  const sockPath = daemonSocketPath(projectRoot);
  try {
    return await tryConnect(sockPath);
  } catch {
    return null;
  }
}

let nextRequestId = 1;

/**
 * Send a request and wait for the response with matching id.
 *
 * @param socket - Connected daemon socket
 * @param requestId - The request id to match the response against
 * @param timeoutMs - Maximum time to wait (default 130s)
 */
function awaitResponse(
  socket: Socket,
  requestId: number,
  timeoutMs = 130_000,
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Daemon request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const feed = createResponseReader(
      (response) => {
        if (response.id === requestId) {
          cleanup();
          resolve(response);
        }
      },
      (errorMessage) => {
        cleanup();
        reject(new Error(errorMessage));
      },
    );

    function onData(chunk: Buffer): void {
      feed(chunk);
    }

    function onError(err: Error): void {
      cleanup();
      reject(err);
    }

    function onClose(): void {
      cleanup();
      reject(new Error("Daemon connection closed before response"));
    }

    function cleanup(): void {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

/**
 * Request the daemon to lint files and return diagnostics.
 */
function sendRequest(socket: Socket, message: Parameters<typeof writeMessage>[1]): void {
  if (!writeMessage(socket, message)) {
    throw new Error("failed to write to daemon socket (socket destroyed)");
  }
}

/**
 * Request the daemon to lint files and return diagnostics.
 */
export function requestLint(
  socket: Socket,
  params: LintRequestParams,
): Promise<DaemonResponse> {
  const id = nextRequestId++;
  sendRequest(socket, { kind: "lint-request", id, params });
  return awaitResponse(socket, id);
}

/**
 * Request daemon status.
 */
export function requestStatus(socket: Socket): Promise<DaemonResponse> {
  const id = nextRequestId++;
  sendRequest(socket, { kind: "status-request", id });
  return awaitResponse(socket, id);
}

/**
 * Request daemon shutdown.
 */
export function requestShutdown(socket: Socket): Promise<DaemonResponse> {
  const id = nextRequestId++;
  sendRequest(socket, { kind: "shutdown-request", id });
  return awaitResponse(socket, id);
}

/**
 * Stop a running daemon for the given project root.
 *
 * @returns true if daemon was stopped, false if none was running
 */
export async function stopDaemon(projectRoot: string): Promise<boolean> {
  const socket = await probeDaemon(projectRoot);
  if (socket === null) return false;
  try {
    await requestShutdown(socket);
  } catch {
    /** H4: Connection closed during shutdown is expected — the daemon exits after flushing. */
  } finally {
    socket.destroy();
  }
  return true;
}
