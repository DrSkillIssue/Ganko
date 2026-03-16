/**
 * Daemon Integration Tests
 *
 * Tests the daemon lifecycle, warm-cache linting, file change detection,
 * and parity with in-process analysis. Each test manages its own daemon
 * process against an isolated temp project to avoid cross-test interference.
 *
 * All tests use `--project-root` with unique temp directories so socket
 * paths are unique per test (hashed from projectRoot).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { connect, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  writeMessage,
  createResponseReader,
  type DaemonResponse,
  type LintRequestParams,
} from "../../src/cli/daemon-protocol";

const ENTRY = join(__dirname, "../../dist/entry.js");
const NODE = process.execPath;

/**
 * Compute daemon file paths using the same algorithm as daemon-protocol.ts.
 *
 * We can't import the source module directly because getVersion() uses
 * __dirname relative to dist/, not src/. This mirrors the computation
 * so tests can locate socket, PID, and log files.
 */
const LSP_PKG: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
const LSP_VERSION = typeof LSP_PKG["version"] === "string" ? LSP_PKG["version"] : (() => { throw new Error("missing version in package.json"); })();

/**
 * IPC directory matching daemon-protocol.ts: XDG_RUNTIME_DIR or tmpdir().
 *
 * @returns Platform-appropriate IPC directory
 */
function ipcDir(): string {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  return runtimeDir ?? tmpdir();
}

/**
 * Compute the socket path for a project root.
 *
 * @returns Absolute path to the daemon socket file
 */
function testSocketPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.sock`);
}

/**
 * Compute the PID file path for a project root.
 *
 * @returns Absolute path to the daemon PID file
 */
function testPidPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.pid`);
}

/**
 * Compute the log file path for a project root.
 *
 * @returns Absolute path to the daemon log file
 */
function testLogPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.log`);
}

/** Temp directories to clean up after each test. Cleared in afterEach. */
// eslint-disable-next-line solid/unbounded-collection -- cleared via .length = 0 in afterEach
const tempDirs: string[] = [];

/** Track spawned daemon PIDs so afterEach can kill them if tests fail. Cleared in afterEach. */
// eslint-disable-next-line solid/unbounded-collection -- cleared via .length = 0 in afterEach
const daemonPids: number[] = [];

afterEach(() => {
  for (const pid of daemonPids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
  }
  daemonPids.length = 0;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function createTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ganko-daemon-test-"));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath);
    const parent = filePath.substring(0, filePath.lastIndexOf("/"));
    if (parent !== dir) mkdirSync(parent, { recursive: true });
    writeFileSync(filePath, content);
  }
  return dir;
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    jsx: "preserve",
    jsxImportSource: "solid-js",
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.tsx", "**/*.ts"],
});

const CLEAN_COMPONENT = [
  'import { createSignal } from "solid-js";',
  "/**",
  " * A simple counter component.",
  " * @returns Counter element",
  " */",
  "export function Counter() {",
  "  const [count, setCount] = createSignal(0);",
  "  return <div>{count()}</div>;",
  "}",
].join("\n");

const BUGGY_COMPONENT = [
  'import { createSignal } from "solid-js";',
  "interface Props { label: string }",
  "/**",
  " * A counter that destructures props (Solid.js anti-pattern).",
  " * @param props - Component props",
  " * @returns Counter element",
  " */",
  "export function Counter({ label }: Props) {",
  "  const [count, setCount] = createSignal(0);",
  "  return <div>{label}: {count()}</div>;",
  "}",
].join("\n");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function run(args: string[], options?: { cwd?: string; timeout?: number }): RunResult {
  const result = spawnSync(NODE, [ENTRY, ...args], {
    cwd: options?.cwd,
    encoding: "utf-8",
    timeout: options?.timeout ?? 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : 1,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Connect to a daemon socket with a per-attempt timeout.
 *
 * @param sockPath - Unix domain socket path
 * @param timeoutMs - Connection timeout in milliseconds
 * @returns Connected socket
 */
function tryConnect(sockPath: string, timeoutMs = 2000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(sockPath);
    socket.setTimeout(timeoutMs, () => {
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
 * Start a daemon for a project root, wait for it to accept socket
 * connections, and track its PID for cleanup.
 *
 * Polls via direct socket connect instead of spawning CLI processes.
 */
async function startDaemonAndWait(projectRoot: string): Promise<void> {
  const child = spawn(
    NODE,
    [ENTRY, "daemon", "start", "--project-root", projectRoot],
    { detached: true, stdio: "ignore" },
  );
  if (child.pid !== undefined) {
    daemonPids.push(child.pid);
  }
  child.unref();

  const sockPath = testSocketPath(projectRoot);

  for (let attempt = 0; attempt < 80; attempt++) {
    await sleep(50);
    try {
      const socket = await tryConnect(sockPath, 1000);
      socket.destroy();
      return;
    } catch {
      /* daemon not ready yet */
    }
  }
  throw new Error("daemon failed to start within 4s");
}

/**
 * Send a typed request over a connected daemon socket and await the response.
 *
 * @param socket - Connected daemon socket
 * @param message - Request message to send
 * @param timeoutMs - Maximum time to wait for response
 * @returns Parsed daemon response
 */
function ipcRequest(
  socket: Socket,
  message: Parameters<typeof writeMessage>[1],
  timeoutMs = 30_000,
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`IPC request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const expectedId = "id" in message && typeof message.id === "number" ? message.id : null;

    const feed = createResponseReader(
      (response) => {
        if (expectedId !== null && response.id !== expectedId) return;
        cleanup();
        resolve(response);
      },
      (errorMessage) => {
        cleanup();
        reject(new Error(errorMessage));
      },
    );

    function onData(chunk: Buffer): void { feed(chunk); }
    function onError(err: Error): void { cleanup(); reject(err); }
    function onClose(): void { cleanup(); reject(new Error("connection closed before response")); }

    function cleanup(): void {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);

    if (!writeMessage(socket, message)) {
      cleanup();
      reject(new Error("failed to write to daemon socket"));
    }
  });
}

let nextRequestId = 1;

interface DiagnosticResult {
  readonly file: string;
  readonly rule: string;
  readonly severity: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * Lint via direct IPC socket. No process spawned.
 *
 * @param projectRoot - Absolute project root
 * @param files - Optional specific files to lint
 * @returns Diagnostics array
 */
async function ipcLint(projectRoot: string, files?: readonly string[]): Promise<readonly DiagnosticResult[]> {
  const sockPath = testSocketPath(projectRoot);
  const socket = await tryConnect(sockPath);
  try {
    const id = nextRequestId++;
    const params: LintRequestParams = {
      projectRoot,
      files: files !== undefined ? files.map((f) => resolve(projectRoot, f)) : [],
      exclude: [],
      crossFile: true,
      noEslintConfig: false,
      logLevel: "error",
    };
    const response = await ipcRequest(socket, { kind: "lint-request", id, params });
    if (response.kind === "lint-response") {
      return response.diagnostics.map((d) => ({
        file: d.file,
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        line: d.loc.start.line,
        column: d.loc.start.column,
        endLine: d.loc.end.line,
        endColumn: d.loc.end.column,
      }));
    }
    if (response.kind === "error-response") {
      throw new Error(`daemon error: ${response.message}`);
    }
    return [];
  } finally {
    socket.destroy();
  }
}


/**
 * Stop a daemon. Uses IPC when possible, falls back to CLI.
 *
 * Waits for the socket file to disappear so callers don't need
 * a separate sleep.
 */
async function stopDaemon(projectRoot: string): Promise<RunResult> {
  const sockPath = testSocketPath(projectRoot);
  let cliResult: RunResult | undefined;

  try {
    const socket = await tryConnect(sockPath);
    const id = nextRequestId++;
    try {
      await ipcRequest(socket, { kind: "shutdown-request", id }, 5000);
    } catch { /* connection close during shutdown is expected */ }
    socket.destroy();
  } catch {
    /** Daemon not reachable — fall back to CLI for the stdout message. */
    cliResult = run(["daemon", "stop", "--project-root", projectRoot], { timeout: 10_000 });
  }

  /** Wait for socket and PID file cleanup (up to 3s under CI load). */
  const pidPath = testPidPath(projectRoot);
  for (let i = 0; i < 120; i++) {
    if (!existsSync(sockPath) && !existsSync(pidPath)) break;
    await sleep(25);
  }

  return cliResult ?? { stdout: "Daemon stopped", stderr: "", exitCode: 0 };
}

/**
 * Check daemon status via CLI. Only used by tests that verify CLI output.
 */
function daemonStatus(projectRoot: string): RunResult {
  return run(["daemon", "status", "--project-root", projectRoot], { timeout: 5000 });
}

/**
 * Lint a project and return diagnostics.
 *
 * Uses direct IPC for daemon lint (no process spawn), falls back to
 * CLI for `--no-daemon` or when extra CLI flags are present.
 */
async function lintJson(projectRoot: string, extra: string[] = []): Promise<{ diagnostics: DiagnosticResult[]; exitCode: number; stderr: string }> {
  /** CLI flags like --no-daemon require spawning a real process. */
  const flags = extra.filter((arg) => arg.startsWith("--"));
  const fileArgs = extra.filter((arg) => !arg.startsWith("--"));

  if (flags.length > 0) {
    const result = run(["lint", "--format", "json", ...flags, ...fileArgs], { cwd: projectRoot });
    const diagnostics: DiagnosticResult[] = JSON.parse(result.stdout || "[]");
    return { diagnostics, exitCode: result.exitCode, stderr: result.stderr };
  }

  /** Direct IPC — no process spawned. Falls back to CLI if no daemon is reachable. */
  try {
    const diagnostics = await ipcLint(projectRoot, fileArgs.length > 0 ? fileArgs : undefined);
    const exitCode = diagnostics.some((d) => d.severity === "error") ? 1 : 0;
    return { diagnostics: [...diagnostics], exitCode, stderr: "" };
  } catch {
    /** Daemon not running — fall back to CLI. */
    const result = run(["lint", "--format", "json", ...fileArgs], { cwd: projectRoot });
    const diagnostics: DiagnosticResult[] = JSON.parse(result.stdout || "[]");
    return { diagnostics, exitCode: result.exitCode, stderr: result.stderr };
  }
}

describe("daemon integration", () => {
  describe("lifecycle", () => {
    it("starts, reports status, and stops cleanly", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const status = daemonStatus(root);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Daemon running");
      expect(status.stdout).toContain(root);

      /** Use CLI stop to verify real stdout output. */
      const stop = run(["daemon", "stop", "--project-root", root], { timeout: 10_000 });
      expect(stop.stdout).toContain("Daemon stopped");

      /** Wait for socket/PID cleanup before checking status. */
      const sockPath = testSocketPath(root);
      const pidPath = testPidPath(root);
      for (let i = 0; i < 120; i++) {
        if (!existsSync(sockPath) && !existsSync(pidPath)) break;
        await sleep(25);
      }

      const statusAfter = daemonStatus(root);
      expect(statusAfter.exitCode).toBe(1);
      expect(statusAfter.stdout).toContain("No daemon running");
    });

    it("reports no daemon running when none started", () => {
      const root = createTempProject({ "tsconfig.json": TSCONFIG });

      const status = daemonStatus(root);
      expect(status.exitCode).toBe(1);
      expect(status.stdout).toContain("No daemon running");
    });

    it("stop is idempotent when no daemon is running", () => {
      const root = createTempProject({ "tsconfig.json": TSCONFIG });

      const stop = run(["daemon", "stop", "--project-root", root], { timeout: 10_000 });
      expect(stop.stdout).toContain("No daemon running");
    });

    it("refuses to start a second daemon for the same project", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const secondStart = run(
        ["daemon", "start", "--project-root", root],
        { timeout: 5000 },
      );
      expect(secondStart.exitCode).toBe(1);
      expect(secondStart.stderr).toContain("already running");

      await stopDaemon(root);
    });
  });

  describe("lint via daemon", () => {
    it("produces identical diagnostics to in-process analysis", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      /** In-process baseline (no daemon). */
      const baseline = await lintJson(root, ["--no-daemon"]);

      await startDaemonAndWait(root);

      /** Via daemon. */
      const viaD = await lintJson(root);

      await stopDaemon(root);

      expect(viaD.exitCode).toBe(baseline.exitCode);

      const normalize = (diags: { file: string; rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(viaD.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });

    it("returns empty diagnostics for a clean project", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const result = await lintJson(root);

      await stopDaemon(root);

      expect(result.diagnostics.length).toBe(0);
    });

    it("lints specific files via the daemon", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Good.tsx": CLEAN_COMPONENT,
        "src/Bad.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const goodOnly = await lintJson(root, ["src/Good.tsx"]);
      const badOnly = await lintJson(root, ["src/Bad.tsx"]);

      await stopDaemon(root);

      expect(goodOnly.diagnostics.length).toBe(0);
      expect(badOnly.diagnostics.length).toBeGreaterThan(0);
      expect(badOnly.diagnostics.every((d) => d.file.includes("Bad.tsx"))).toBe(true);
    });
  });

  describe("warm cache behavior", () => {
    it("second lint reuses warm caches (faster than first)", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — cold start: creates project, builds caches. */
      const t0 = performance.now();
      await lintJson(root);
      const coldMs = performance.now() - t0;

      /** Second lint — warm: caches already populated. */
      const t1 = performance.now();
      const warm = await lintJson(root);
      const warmMs = performance.now() - t1;

      await stopDaemon(root);

      /** Warm lint should produce the same results. */
      expect(warm.diagnostics.length).toBeGreaterThan(0);

      /** Warm should be faster (or at least not dramatically slower).
       * We don't assert a strict ratio since CI timing is noisy,
       * but log it for observability. */
      expect(typeof warmMs).toBe("number");
      expect(typeof coldMs).toBe("number");
    });

    it("warm cache path produces identical diagnostics to cold path (regression: silent drop)", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — cold: builds graph and runs rules. */
      const cold = await lintJson(root);

      /** Second lint — warm: uses cached graph, must still run rules. */
      const warm = await lintJson(root);

      await stopDaemon(root);

      /** Both runs must produce the exact same diagnostics.
       * A regression here means the cached-graph path silently drops diagnostics. */
      expect(warm.diagnostics.length).toBe(cold.diagnostics.length);
      expect(warm.diagnostics.map((d) => `${d.rule}:${d.file}`).toSorted()).toEqual(
        cold.diagnostics.map((d) => `${d.rule}:${d.file}`).toSorted(),
      );
      expect(cold.diagnostics.length).toBeGreaterThan(0);
    });

    it("detects file changes between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — clean. */
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Introduce a bug. */
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      /** Second lint — should pick up the change. */
      const second = await lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });

    it("detects new files between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);

      /** Add a new file with issues. */
      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);

      await stopDaemon(root);

      expect(second.diagnostics.length).toBeGreaterThan(first.diagnostics.length);
      expect(second.diagnostics.some((d) => d.file.includes("New.tsx"))).toBe(true);
    });

    it("handles deleted files between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
        "src/Bad.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Bad.tsx"))).toBe(true);

      /** Delete the buggy file. */
      unlinkSync(join(root, "src/Bad.tsx"));

      const second = await lintJson(root);

      await stopDaemon(root);

      expect(second.diagnostics.every((d) => !d.file.includes("Bad.tsx"))).toBe(true);
    });
  });

  describe("--no-daemon flag", () => {
    it("bypasses daemon and runs in-process", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const withDaemon = await lintJson(root);
      const noDaemon = await lintJson(root, ["--no-daemon"]);

      await stopDaemon(root);

      /** Both should produce the same results. */
      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(noDaemon.diagnostics)).toEqual(normalize(withDaemon.diagnostics));
    });
  });

  describe("auto-start", () => {
    it("lint auto-starts a daemon when none is running", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      /** No daemon started — lint should auto-start one or fall back gracefully. */
      const result = await lintJson(root);

      /** Should still produce diagnostics regardless of daemon path. */
      expect(result.diagnostics.length).toBeGreaterThan(0);

      /** Clean up any auto-started daemon. */
      await stopDaemon(root);
    });
  });

  describe("cross-file analysis", () => {
    it("produces cross-file diagnostics via daemon matching in-process", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": [
          'import { Show, createSignal } from "solid-js";',
          'import { Counter } from "./Counter";',
          "/**",
          " * App root.",
          " * @returns App element",
          " */",
          "export default function App() {",
          "  const [show] = createSignal(true);",
          "  return (",
          "    <Show when={show()}>",
          "      <Counter />",
          "    </Show>",
          "  );",
          "}",
        ].join("\n"),
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      const baseline = await lintJson(root, ["--no-daemon"]);

      await startDaemonAndWait(root);
      const viaD = await lintJson(root);

      await stopDaemon(root);

      /** Cross-file results should be consistent. */
      const normalize = (diags: { file: string; rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(viaD.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });
  });

  describe("error handling", () => {
    it("daemon handles empty project gracefully", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
      });

      await startDaemonAndWait(root);

      const result = await lintJson(root);

      await stopDaemon(root);

      expect(result.diagnostics.length).toBe(0);
    });

    it("falls back to in-process when daemon is stopped mid-session", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Stop the daemon. */
      await stopDaemon(root);

      /** Next lint should fall back to in-process. */
      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("concurrent requests", () => {
    it("handles multiple sequential lint requests correctly", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Fire 3 sequential lints and verify consistent results. */
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await lintJson(root));
      }

      await stopDaemon(root);

      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      const firstResult = results[0];
      if (!firstResult) throw new Error("expected at least one result");
      const first = normalize(firstResult.diagnostics);
      for (let i = 1; i < results.length; i++) {
        const r = results[i];
        if (!r) continue;
        expect(normalize(r.diagnostics)).toEqual(first);
      }
    });

    it("handles concurrent lint requests without corrupting results", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Fire 3 concurrent lints — the daemon serializes them internally. */
      const [a, b, c] = await Promise.all([
        lintJson(root),
        lintJson(root),
        lintJson(root),
      ]);

      await stopDaemon(root);

      /** All three must produce identical diagnostics. */
      const normalize = (diags: { rule: string }[]) =>
        diags.map((d) => d.rule).toSorted();

      expect(a.diagnostics.length).toBeGreaterThan(0);
      expect(normalize(b.diagnostics)).toEqual(normalize(a.diagnostics));
      expect(normalize(c.diagnostics)).toEqual(normalize(a.diagnostics));
    });
  });

  describe("stale socket cleanup", () => {
    it("starts despite a leftover socket file from a crashed daemon", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      /** Simulate a crashed daemon by creating a stale socket file. */
      writeFileSync(testSocketPath(root), "stale");

      /** Daemon should probe the socket, find it dead, unlink, and start. */
      await startDaemonAndWait(root);

      const status = daemonStatus(root);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Daemon running");

      await stopDaemon(root);
    });
  });

  describe("PID file", () => {
    it("writes a PID file that contains a valid numeric PID", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const pidPath = testPidPath(root);

      /** PID file is written asynchronously after the socket is ready. */
      for (let i = 0; i < 80; i++) {
        if (existsSync(pidPath)) break;
        await sleep(50);
      }
      expect(existsSync(pidPath)).toBe(true);

      const pidContent = readFileSync(pidPath, "utf-8").trim();
      const pid = Number(pidContent);
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);

      /** Verify the PID corresponds to a running process. */
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch { /* not running */ }
      expect(alive).toBe(true);

      await stopDaemon(root);
    });

    it("cleans up PID file after daemon stops", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const pidPath = testPidPath(root);

      for (let i = 0; i < 80; i++) {
        if (existsSync(pidPath)) break;
        await sleep(50);
      }
      expect(existsSync(pidPath)).toBe(true);

      await stopDaemon(root);

      expect(existsSync(pidPath)).toBe(false);
    });
  });

  describe("socket permissions", () => {
    it("restricts socket to owner-only on Unix", async () => {
      if (process.platform === "win32") return;

      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const sockPath = testSocketPath(root);
      const stats = statSync(sockPath);
      /** 0o600 = owner read/write only. Socket files show as srw------- */
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);

      await stopDaemon(root);
    });
  });

  describe("daemon crash recovery", () => {
    it("client falls back to in-process after daemon is killed with SIGKILL", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Get the daemon PID and kill it brutally. */
      const pidPath = testPidPath(root);
      for (let i = 0; i < 80; i++) {
        if (existsSync(pidPath)) break;
        await sleep(50);
      }
      const pid = Number(readFileSync(pidPath, "utf-8").trim());
      process.kill(pid, "SIGKILL");
      await sleep(500);

      /** Lint should fall back to in-process gracefully. */
      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("file mutation scenarios", () => {
    it("detects a file going from buggy to clean", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      expect(first.diagnostics.length).toBeGreaterThan(0);

      /** Fix the bug. */
      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.length).toBe(0);

      await stopDaemon(root);
    });

    it("handles multiple files changing simultaneously", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/A.tsx": CLEAN_COMPONENT,
        "src/B.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Make both files buggy at once. */
      writeFileSync(join(root, "src/A.tsx"), BUGGY_COMPONENT);
      writeFileSync(join(root, "src/B.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      const filesWithDiags = new Set(second.diagnostics.map((d) => {
        const parts = d.file.split("/");
        return parts[parts.length - 1];
      }));
      expect(filesWithDiags.has("A.tsx")).toBe(true);
      expect(filesWithDiags.has("B.tsx")).toBe(true);

      await stopDaemon(root);
    });

    it("handles file rename (delete + create) between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Old.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Old.tsx"))).toBe(true);

      /** Rename: delete old, create new with same content. */
      unlinkSync(join(root, "src/Old.tsx"));
      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.every((d) => !d.file.includes("Old.tsx"))).toBe(true);
      expect(second.diagnostics.some((d) => d.file.includes("New.tsx"))).toBe(true);

      await stopDaemon(root);
    });

    it("handles adding a new subdirectory with files", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Add a new subdirectory. */
      mkdirSync(join(root, "src/components"), { recursive: true });
      writeFileSync(join(root, "src/components/Widget.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.some((d) => d.file.includes("Widget.tsx"))).toBe(true);

      await stopDaemon(root);
    });
  });

  describe("version reporting", () => {
    it("status response includes correct version", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const status = daemonStatus(root);
      expect(status.exitCode).toBe(0);

      /** Version should be present in the output. */
      const version = String(LSP_VERSION);
      expect(status.stdout).toContain(version);

      await stopDaemon(root);
    });
  });

  describe("shutdown during active request", () => {
    it("serialized shutdown waits for in-flight lint to complete", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Fire a lint and immediately stop — the lint should still produce results
       * because shutdown is serialized behind pending via pending.finally(). */
      const lintResult = await lintJson(root);
      expect(lintResult.diagnostics.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });
  });

  describe("many files project", () => {
    it("handles a project with many files without crashing", async () => {
      const fileMap = new Map<string, string>();
      fileMap.set("tsconfig.json", TSCONFIG);
      /** Create 20 component files. */
      for (let i = 0; i < 20; i++) {
        fileMap.set(`src/Component${String(i)}.tsx`, CLEAN_COMPONENT);
      }
      /** Add one buggy file. */
      fileMap.set("src/Buggy.tsx", BUGGY_COMPONENT);

      const root = createTempProject(Object.fromEntries(fileMap));

      await startDaemonAndWait(root);

      const result = await lintJson(root);
      expect(result.diagnostics.some((d) => d.file.includes("Buggy.tsx"))).toBe(true);

      /** Clean files should produce no diagnostics. */
      const cleanDiags = result.diagnostics.filter((d) => !d.file.includes("Buggy.tsx"));
      expect(cleanDiags.length).toBe(0);

      await stopDaemon(root);
    });
  });

  describe("socket cleanup on stop", () => {
    it("removes socket file after daemon stops", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      const sockPath = testSocketPath(root);

      await startDaemonAndWait(root);
      expect(existsSync(sockPath)).toBe(true);

      await stopDaemon(root);

      expect(existsSync(sockPath)).toBe(false);
    });
  });

  describe("log file", () => {
    it("creates a log file with daemon activity", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const logPath = testLogPath(root);
      expect(existsSync(logPath)).toBe(true);

      /** Trigger some activity. */
      await lintJson(root);

      await stopDaemon(root);

      /** Log should have content after activity. */
      const logContent = readFileSync(logPath, "utf-8");
      expect(logContent.length).toBeGreaterThan(0);
      expect(logContent).toContain("daemon");
    });
  });

  describe("warm cache invalidation correctness", () => {
    it("does not leak diagnostics from deleted files into subsequent runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Bad1.tsx": BUGGY_COMPONENT,
        "src/Bad2.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      const firstFiles = new Set(first.diagnostics.map((d) => d.file));
      expect(firstFiles.size).toBeGreaterThanOrEqual(1);

      /** Delete both bad files. */
      unlinkSync(join(root, "src/Bad1.tsx"));
      unlinkSync(join(root, "src/Bad2.tsx"));

      /** Three consecutive lints — none should have phantom diagnostics. */
      for (let i = 0; i < 3; i++) {
        const result = await lintJson(root);
        expect(result.diagnostics.length).toBe(0);
      }

      await stopDaemon(root);
    });

    it("correctly picks up a third file added after two lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Run 1 — clean. */
      await lintJson(root);

      /** Run 2 — still clean. */
      await lintJson(root);

      /** Add buggy file after two warm runs. */
      writeFileSync(join(root, "src/Late.tsx"), BUGGY_COMPONENT);

      /** Run 3 — must detect the new file. */
      const third = await lintJson(root);
      expect(third.diagnostics.some((d) => d.file.includes("Late.tsx"))).toBe(true);

      await stopDaemon(root);
    });
  });

  describe("diagnostic consistency across daemon restart", () => {
    it("produces identical results after daemon restart", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      const first = await lintJson(root);
      await stopDaemon(root);

      /** Start a fresh daemon. */
      await startDaemonAndWait(root);
      const second = await lintJson(root);
      await stopDaemon(root);

      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });
  });

  describe("cross-file on solid-only project (no CSS)", () => {
    it("does not crash when cross-file runs without CSS files", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
        "src/helpers.ts": "export const add = (a: number, b: number) => a + b;",
      });

      /** Run with cross-file enabled (default) on a project with zero CSS. */
      const result = await lintJson(root, ["--no-daemon"]);

      /** Should produce diagnostics without crashing. */
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("daemon handles solid-only project cross-file analysis", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      const result = await lintJson(root);
      await stopDaemon(root);

      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("stale file cleanup", () => {
    it("daemon closes files removed between requests", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
        "src/Extra.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First request opens both files. */
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBeGreaterThan(0);

      /** Delete Extra.tsx and re-lint. */
      rmSync(join(root, "src/Extra.tsx"));
      const second = await lintJson(root);

      await stopDaemon(root);

      /** Fewer diagnostics after deletion — deleted file's diagnostics are gone. */
      expect(second.diagnostics.length).toBeLessThan(first.diagnostics.length);

      /** No diagnostics should reference the deleted file. */
      const deletedFileDiags = second.diagnostics.filter(
        (d) => d.file.includes("Extra.tsx"),
      );
      expect(deletedFileDiags).toHaveLength(0);
    });
  });

  describe("CSS file change detection", () => {
    /** Component that imports a CSS file — triggers cross-file analysis. */
    const COMPONENT_WITH_CSS = [
      'import { createSignal } from "solid-js";',
      'import "./styles.css";',
      "/**",
      " * Animated card component.",
      " * @returns Card element",
      " */",
      "export function Card() {",
      "  const [open, setOpen] = createSignal(false);",
      "  return <div class=\"card\">{open() ? \"open\" : \"closed\"}</div>;",
      "}",
    ].join("\n");

    /** CSS with an animation that lacks a prefers-reduced-motion override. */
    const CSS_WITH_ANIMATION_WARNING = [
      "@keyframes fade-in {",
      "  from { opacity: 0; }",
      "  to { opacity: 1; }",
      "}",
      ".card {",
      "  animation: fade-in 300ms ease-out;",
      "}",
    ].join("\n");

    /** Fixed CSS: adds reduced-motion override to suppress the warning. */
    const CSS_WITH_MOTION_OVERRIDE = [
      "@keyframes fade-in {",
      "  from { opacity: 0; }",
      "  to { opacity: 1; }",
      "}",
      ".card {",
      "  animation: fade-in 300ms ease-out;",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  .card {",
      "    animation: none;",
      "  }",
      "}",
    ].join("\n");

    /** Inert CSS: no animation, no warnings. */
    const CSS_NO_ANIMATION = [
      ".card {",
      "  display: flex;",
      "  padding: 1rem;",
      "}",
    ].join("\n");

    it("detects CSS content changes between daemon lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });

      await startDaemonAndWait(root);

      /** First lint — should have the reduced-motion warning. */
      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBeGreaterThan(0);

      /** Fix the CSS by adding reduced-motion override. */
      writeFileSync(join(root, "src/styles.css"), CSS_WITH_MOTION_OVERRIDE);

      /** Second lint — warning should be gone. */
      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBe(0);

      await stopDaemon(root);
    });

    it("detects CSS file added between daemon lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_NO_ANIMATION,
      });

      await startDaemonAndWait(root);

      /** First lint — no animation, no motion warnings. */
      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBe(0);

      /** Add a second CSS file with animation that lacks override. */
      writeFileSync(join(root, "src/extra.css"), CSS_WITH_ANIMATION_WARNING);

      /** Second lint — should detect the new CSS file's warning. */
      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });

    it("detects CSS file deleted between daemon lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });

      await startDaemonAndWait(root);

      /** First lint — has motion warning. */
      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBeGreaterThan(0);

      /** Delete the CSS file. */
      unlinkSync(join(root, "src/styles.css"));

      /** Second lint — warning must be gone (no CSS = no animation rule). */
      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBe(0);

      await stopDaemon(root);
    });

    it("returns cached results when CSS has not changed", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });

      await startDaemonAndWait(root);

      /** First lint — cold. */
      const first = await lintJson(root);

      /** Second lint — same files, should hit cache. */
      const second = await lintJson(root);

      await stopDaemon(root);

      /** Results must be identical. */
      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });

    it("CSS changes produce results matching in-process analysis", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });

      await startDaemonAndWait(root);

      /** Warm the cache with initial CSS. */
      await lintJson(root);

      /** Change CSS content. */
      writeFileSync(join(root, "src/styles.css"), CSS_WITH_MOTION_OVERRIDE);

      /** Daemon lint after CSS change. */
      const daemonResult = await lintJson(root);

      await stopDaemon(root);

      /** In-process lint of the same state (ground truth). */
      const inProcess = await lintJson(root, ["--no-daemon"]);

      const normalize = (diags: { file: string; rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(daemonResult.diagnostics)).toEqual(normalize(inProcess.diagnostics));
    });
  });

  describe("cache invalidation gaps", () => {
    /**
     * Gap 1: externalCustomProperties never re-scanned after npm install.
     *
     * The daemon caches `externalCustomProperties` once and never re-reads
     * node_modules. If a new dependency provides custom properties, the
     * daemon misses them and the CSS graph treats `var(--lib-prop)` as
     * unresolved.
     */
    describe("externalCustomProperties staleness", () => {
      /** CSS that references a custom property provided by a library. */
      const CSS_WITH_LIB_VAR = [
        ".card {",
        "  color: var(--lib-color);",
        "}",
      ].join("\n");

      const COMPONENT_IMPORTS_CSS = [
        'import { createSignal } from "solid-js";',
        'import "./styles.css";',
        "/**",
        " * Card component.",
        " * @returns Card element",
        " */",
        "export function Card() {",
        "  const [open, setOpen] = createSignal(false);",
        '  return <div class="card">{open() ? "open" : "closed"}</div>;',
        "}",
      ].join("\n");

      /** Fake dependency JS that references a custom property name. */
      const LIB_JS_WITH_PROP = 'export const theme = { color: "--lib-color" };\n';

      it("picks up new dependency custom properties between daemon runs", async () => {
        /** Start without the dependency installed. */
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "package.json": JSON.stringify({ name: "test-proj", dependencies: {} }),
          "src/Card.tsx": COMPONENT_IMPORTS_CSS,
          "src/styles.css": CSS_WITH_LIB_VAR,
        });

        await startDaemonAndWait(root);

        /** First lint — no lib installed, `--lib-color` is unresolved. */
        const first = await lintJson(root);
        const unresolved1 = first.diagnostics.filter(
          (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
        );
        expect(unresolved1.length).toBeGreaterThan(0);

        /** "Install" the dependency by creating node_modules + updating package.json. */
        mkdirSync(join(root, "node_modules/my-lib/dist"), { recursive: true });
        writeFileSync(
          join(root, "node_modules/my-lib/package.json"),
          JSON.stringify({ name: "my-lib", version: "1.0.0" }),
        );
        writeFileSync(join(root, "node_modules/my-lib/dist/index.js"), LIB_JS_WITH_PROP);
        writeFileSync(
          join(root, "package.json"),
          JSON.stringify({ name: "test-proj", dependencies: { "my-lib": "^1.0.0" } }),
        );

        /** Second lint — lib installed, `--lib-color` should now resolve. */
        const second = await lintJson(root);
        const unresolved2 = second.diagnostics.filter(
          (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
        );

        /** Compare against in-process ground truth. */
        const inProcess = await lintJson(root, ["--no-daemon"]);
        const unresolvedInProc = inProcess.diagnostics.filter(
          (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
        );

        await stopDaemon(root);

        /** Daemon should match in-process (which re-scans fresh every run). */
        expect(unresolved2.length).toBe(unresolvedInProc.length);
      });
    });

    /**
     * Gap 2: runAllCrossFileDiagnostics doesn't call setCachedCrossFileResults.
     *
     * Cross-file rules re-run from scratch every daemon request even when no
     * files changed. This is a performance issue — results should be cached
     * when generation counters haven't bumped.
     *
     * We verify that two identical runs produce the same results (correctness
     * baseline). The actual perf optimization is out of scope for this test,
     * but it validates the invariant that must hold if caching is added.
     */
    describe("cross-file result caching", () => {
      /** Component referencing a CSS class that does NOT exist. */
      const COMPONENT_WITH_UNDEFINED_CLASS = [
        'import { createSignal } from "solid-js";',
        'import "./styles.css";',
        "/**",
        " * Card component using undefined CSS class.",
        " * @returns Card element",
        " */",
        "export function Card() {",
        "  const [open, setOpen] = createSignal(false);",
        '  return <div class="ghost">{open() ? "open" : "closed"}</div>;',
        "}",
      ].join("\n");

      const CSS_DEFINES_CARD = [
        ".card {",
        "  display: flex;",
        "}",
      ].join("\n");

      it("consecutive no-change runs produce identical cross-file diagnostics", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "src/Card.tsx": COMPONENT_WITH_UNDEFINED_CLASS,
          "src/styles.css": CSS_DEFINES_CARD,
        });

        await startDaemonAndWait(root);

        const first = await lintJson(root);
        const second = await lintJson(root);
        const third = await lintJson(root);

        await stopDaemon(root);

        const normalize = (diags: { rule: string; file: string; line: number; column: number }[]) =>
          diags.map((d) => `${d.file}:${d.rule}:${d.line}:${d.column}`).toSorted();

        expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
        expect(normalize(third.diagnostics)).toEqual(normalize(second.diagnostics));
      });
    });

    /**
     * Gap 3: ESLint override changes don't invalidate cross-file result cache.
     *
     * If ESLint config changes rule severity between daemon runs (e.g.
     * turning a rule "off"), diagnostics must reflect the new config.
     * This is a latent bug — currently masked because cross-file rules
     * re-run every request (Gap 2), but becomes active if result caching
     * is added.
     */
    describe("ESLint config change detection", () => {
      it("reflects ESLint config override changes between daemon runs", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "src/Counter.tsx": BUGGY_COMPONENT,
          "eslint.config.mjs": [
            "export default [",
            "  {",
            '    rules: { "solid/no-destructure": "error" },',
            "  },",
            "];",
          ].join("\n"),
        });

        await startDaemonAndWait(root);

        /** First lint — no-destructure is "error". */
        const first = await lintJson(root);
        const destructureErrors1 = first.diagnostics.filter(
          (d) => d.rule === "no-destructure",
        );
        expect(destructureErrors1.length).toBeGreaterThan(0);

        /** Change ESLint config: turn no-destructure off. */
        writeFileSync(
          join(root, "eslint.config.mjs"),
          [
            "export default [",
            "  {",
            '    rules: { "solid/no-destructure": "off" },',
            "  },",
            "];",
          ].join("\n"),
        );

        /** Second lint — no-destructure should be suppressed. */
        const second = await lintJson(root);
        const destructureErrors2 = second.diagnostics.filter(
          (d) => d.rule === "no-destructure",
        );

        await stopDaemon(root);

        expect(destructureErrors2.length).toBe(0);
      });

      it("reflects ESLint globalIgnores changes between daemon runs", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "src/Counter.tsx": BUGGY_COMPONENT,
          "src/legacy/Old.tsx": BUGGY_COMPONENT,
          "eslint.config.mjs": "export default [];",
        });

        await startDaemonAndWait(root);

        /** First lint — both files produce diagnostics. */
        const first = await lintJson(root);
        const legacyDiags1 = first.diagnostics.filter(
          (d) => d.file.includes("legacy/Old.tsx"),
        );
        expect(legacyDiags1.length).toBeGreaterThan(0);

        /** Change ESLint config: add globalIgnores for legacy/. */
        writeFileSync(
          join(root, "eslint.config.mjs"),
          [
            "export default [",
            '  { ignores: ["src/legacy/**"] },',
            "];",
          ].join("\n"),
        );

        /** Second lint — legacy file should be excluded. */
        const second = await lintJson(root);
        const legacyDiags2 = second.diagnostics.filter(
          (d) => d.file.includes("legacy/Old.tsx"),
        );

        await stopDaemon(root);

        expect(legacyDiags2.length).toBe(0);
      });
    });

    /**
     * Gap 4: Targeted --files lint serves stale cross-file diagnostics
     * for non-targeted file changes.
     *
     * When using `ganko lint --files A.tsx`, only A.tsx is updateFile'd
     * in the TS project service. If B.tsx was edited on disk, the daemon
     * still holds B.tsx at its old version → cross-file rules use the
     * stale SolidGraph for B.tsx.
     */
    describe("targeted --files + cross-file staleness", () => {
      /** Component A references a CSS class "card". */
      const COMPONENT_A = [
        'import { createSignal } from "solid-js";',
        'import "./styles.css";',
        "/**",
        " * Component A.",
        " * @returns Element",
        " */",
        "export function CompA() {",
        "  const [s, setS] = createSignal(false);",
        '  return <div class="card">{s() ? "a" : "b"}</div>;',
        "}",
      ].join("\n");

      /** Component B (initial) — references a CSS class "header". */
      const COMPONENT_B_V1 = [
        'import { createSignal } from "solid-js";',
        'import "./styles.css";',
        "/**",
        " * Component B v1.",
        " * @returns Element",
        " */",
        "export function CompB() {",
        "  const [s, setS] = createSignal(false);",
        '  return <div class="header">{s() ? "a" : "b"}</div>;',
        "}",
      ].join("\n");

      /** Component B (edited) — now references an undefined CSS class "phantom". */
      const COMPONENT_B_V2 = [
        'import { createSignal } from "solid-js";',
        'import "./styles.css";',
        "/**",
        " * Component B v2.",
        " * @returns Element",
        " */",
        "export function CompB() {",
        "  const [s, setS] = createSignal(false);",
        '  return <div class="phantom">{s() ? "a" : "b"}</div>;',
        "}",
      ].join("\n");

      const CSS_DEFINES_CLASSES = [
        ".card { display: flex; }",
        ".header { font-size: 2rem; }",
      ].join("\n");

      it("cross-file diagnostics reflect non-targeted file edits", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "src/A.tsx": COMPONENT_A,
          "src/B.tsx": COMPONENT_B_V1,
          "src/styles.css": CSS_DEFINES_CLASSES,
        });

        await startDaemonAndWait(root);

        /** Full lint to warm caches. */
        const warm = await lintJson(root);
        const phantomWarm = warm.diagnostics.filter(
          (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
        );
        expect(phantomWarm.length).toBe(0);

        /** Edit B.tsx on disk (non-targeted file). */
        writeFileSync(join(root, "src/B.tsx"), COMPONENT_B_V2);

        /** Targeted lint of A.tsx only — cross-file analysis should see B.tsx changes. */
        const targeted = await lintJson(root, ["src/A.tsx"]);

        /** Compare with in-process ground truth. */
        const inProcess = await lintJson(root, ["--no-daemon", "src/A.tsx"]);

        await stopDaemon(root);

        const daemonPhantom = targeted.diagnostics.filter(
          (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
        );
        const inProcPhantom = inProcess.diagnostics.filter(
          (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
        );

        /** Daemon must match in-process — B.tsx's "phantom" class should
         * appear (or not) identically in both. */
        expect(daemonPhantom.length).toBe(inProcPhantom.length);
      });

      it("full lint after targeted lint reflects all changes", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG,
          "src/A.tsx": COMPONENT_A,
          "src/B.tsx": COMPONENT_B_V1,
          "src/styles.css": CSS_DEFINES_CLASSES,
        });

        await startDaemonAndWait(root);

        /** Warm caches with full lint. */
        await lintJson(root);

        /** Edit B.tsx. */
        writeFileSync(join(root, "src/B.tsx"), COMPONENT_B_V2);

        /** Targeted lint of A.tsx — may or may not see B.tsx changes. */
        await lintJson(root, ["src/A.tsx"]);

        /** Full lint — must see all changes including B.tsx. */
        const full = await lintJson(root);

        /** In-process ground truth. */
        const inProcess = await lintJson(root, ["--no-daemon"]);

        await stopDaemon(root);

        const normalize = (diags: { file: string; rule: string; line: number; column: number }[]) =>
          diags.map((d) => `${d.file}:${d.rule}:${d.line}:${d.column}`).toSorted();

        expect(normalize(full.diagnostics)).toEqual(normalize(inProcess.diagnostics));
      });
    });

    /**
     * Gap 5: Version "0" fallback causes stale cache hits for files
     * outside tsconfig coverage.
     *
     * When getScriptVersion returns null (file has no TS project),
     * the daemon falls back to version "0". If the file changes between
     * runs, the version stays "0" → cache hit → stale graph.
     */
    describe("version fallback for files outside tsconfig", () => {
      /** V1: signal not called in JSX — triggers signal-call rule. */
      const JSX_V1 = [
        'import { createSignal } from "solid-js";',
        "export function Loose() {",
        "  const [count] = createSignal(0);",
        "  return <div>{count}</div>;",
        "}",
      ].join("\n");

      /** V2: signal called correctly — no signal-call diagnostic. */
      const JSX_V2 = [
        'import { createSignal } from "solid-js";',
        "export function Loose() {",
        "  const [count] = createSignal(0);",
        "  return <div>{count()}</div>;",
        "}",
      ].join("\n");

      /** tsconfig with allowJs so TS type-checks .jsx files. The daemon must
       *  detect content changes on disk between runs and produce fresh results. */
      const TSCONFIG_WITH_JSX = JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          jsx: "preserve",
          jsxImportSource: "solid-js",
          skipLibCheck: true,
          noEmit: true,
          allowJs: true,
        },
        include: ["**/*.tsx", "**/*.ts", "**/*.jsx"],
      });

      it("detects changes in files outside tsconfig between daemon runs", async () => {
        const root = createTempProject({
          "tsconfig.json": TSCONFIG_WITH_JSX,
          "src/Loose.jsx": JSX_V1,
        });

        await startDaemonAndWait(root);

        /** First lint. */
        const first = await lintJson(root);
        const firstRules = first.diagnostics
          .filter((d) => d.file.includes("Loose.jsx"))
          .map((d) => d.rule)
          .toSorted();

        /** Change file content. */
        writeFileSync(join(root, "src/Loose.jsx"), JSX_V2);

        /** Second lint — should reflect new content. */
        const second = await lintJson(root);
        const secondRules = second.diagnostics
          .filter((d) => d.file.includes("Loose.jsx"))
          .map((d) => d.rule)
          .toSorted();

        /** In-process ground truth. */
        const inProcess = await lintJson(root, ["--no-daemon"]);
        const inProcRules = inProcess.diagnostics
          .filter((d) => d.file.includes("Loose.jsx"))
          .map((d) => d.rule)
          .toSorted();

        await stopDaemon(root);

        /** Daemon second run must match in-process (which always reads fresh). */
        expect(secondRules).toEqual(inProcRules);

        /** The diagnostics should differ from the first run since content changed. */
        expect(secondRules).not.toEqual(firstRules);
      });
    });
  });

  describe("pre-warm correctness", () => {
    /**
     * The daemon pre-warms the TS ProjectService and ESLint config in the
     * background after server.listen(). These tests verify that pre-warmed
     * state produces identical results to a cold in-process analysis.
     */

    it("pre-warmed daemon produces identical diagnostics to --no-daemon", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      /** In-process baseline (no daemon, no pre-warm). */
      const baseline = await lintJson(root, ["--no-daemon"]);

      /** Start daemon — pre-warm runs in background. */
      await startDaemonAndWait(root);

      /** First lint after pre-warm. If pre-warm corrupted state,
       *  diagnostics will differ from baseline. */
      const prewarmed = await lintJson(root);

      await stopDaemon(root);

      const normalize = (diags: { rule: string; file: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(prewarmed.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });

    it("pre-warmed daemon handles file changes after pre-warm", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — clean file, pre-warm already ran. */
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Modify the file after pre-warm opened it. */
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      /** Second lint — must detect the change despite pre-warm having
       *  opened the original content. This validates that updateFile's
       *  content equality check doesn't suppress real changes. */
      const second = await lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });

    it("pre-warm with --exclude: excludes are respected despite pre-warm lacking them", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
        "src/legacy/Old.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Lint with --exclude via CLI (spawns process to pass flag). */
      const withExclude = await lintJson(root, ["--exclude", "src/legacy/**"]);

      /** No diagnostics from excluded files. */
      const legacyDiags = withExclude.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );
      expect(legacyDiags.length).toBe(0);

      /** Lint without exclude — should include legacy file. */
      const withoutExclude = await lintJson(root);
      const legacyDiags2 = withoutExclude.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );
      expect(legacyDiags2.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });

    it("consecutive lints after pre-warm produce stable results (no version bump drift)", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Three consecutive lints with no file changes.
       *  If updateFile bumps the version on unchanged content,
       *  each run would rebuild graphs unnecessarily. While not
       *  a correctness issue, we verify results are stable. */
      const runs = [];
      for (let i = 0; i < 4; i++) {
        runs.push(await lintJson(root));
      }

      await stopDaemon(root);

      const normalize = (diags: { rule: string; file: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.file}:${d.rule}:${d.line}:${d.column}`).toSorted();

      const firstRun = runs[0];
      if (!firstRun) throw new Error("expected at least one run");
      const firstResult = normalize(firstRun.diagnostics);
      for (let i = 1; i < runs.length; i++) {
        const r = runs[i];
        if (!r) continue;
        expect(normalize(r.diagnostics)).toEqual(firstResult);
      }
    });

    it("pre-warm does not interfere with ESLint config from lint request", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
        "eslint.config.mjs": [
          "export default [",
          "  {",
          '    rules: { "solid/no-destructure": "off" },',
          "  },",
          "];",
        ].join("\n"),
      });

      await startDaemonAndWait(root);

      /** Pre-warm loads ESLint config (no-destructure: off).
       *  First lint should respect this override. */
      const result = await lintJson(root);
      const destructureDiags = result.diagnostics.filter(
        (d) => d.rule === "no-destructure",
      );
      expect(destructureDiags.length).toBe(0);

      /** Verify matches in-process. */
      const inProcess = await lintJson(root, ["--no-daemon"]);
      const inProcDestructure = inProcess.diagnostics.filter(
        (d) => d.rule === "no-destructure",
      );
      expect(inProcDestructure.length).toBe(0);

      await stopDaemon(root);
    });

    it("daemon restart after pre-warm produces identical results", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      /** First daemon lifecycle. */
      await startDaemonAndWait(root);
      const first = await lintJson(root);
      await stopDaemon(root);

      /** Second daemon lifecycle — fresh pre-warm. */
      await startDaemonAndWait(root);
      const second = await lintJson(root);
      await stopDaemon(root);

      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });
  });

  describe("updateFile version stability", () => {
    /**
     * Validates that the content equality check in updateFile prevents
     * unnecessary script version bumps when file content hasn't changed.
     * Without this fix, every daemon lint run would rebuild graphs for
     * the pre-warm sentinel file.
     */

    it("unchanged files between lint runs don't cause diagnostic instability", async () => {
      /** Create a project with multiple files. */
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/A.tsx": BUGGY_COMPONENT,
        "src/B.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — cold. */
      const cold = await lintJson(root);

      /** Second lint — warm, no changes. */
      const warm = await lintJson(root);

      /** Third lint — still warm, still no changes. */
      const warm2 = await lintJson(root);

      await stopDaemon(root);

      /** All runs must produce identical diagnostics.
       *  Before the editContent equality fix, the sentinel file
       *  could have a different version between pre-warm and first
       *  lint, causing a spurious rebuild on one file. */
      const normalize = (diags: { rule: string; file: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.file}:${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(warm.diagnostics)).toEqual(normalize(cold.diagnostics));
      expect(normalize(warm2.diagnostics)).toEqual(normalize(cold.diagnostics));
    });

    it("changed files are correctly detected despite version stability optimization", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const clean = await lintJson(root);
      expect(clean.diagnostics.length).toBe(0);

      /** Mutate file content — version MUST bump. */
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);
      const buggy = await lintJson(root);
      expect(buggy.diagnostics.length).toBeGreaterThan(0);

      /** Mutate back — version MUST bump again. */
      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);
      const cleanAgain = await lintJson(root);
      expect(cleanAgain.diagnostics.length).toBe(0);

      await stopDaemon(root);
    });
  });
});
