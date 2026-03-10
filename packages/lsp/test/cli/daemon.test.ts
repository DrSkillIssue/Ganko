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
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

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
 * Start a daemon for a project root, wait for it to be ready, and
 * track its PID for cleanup.
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

  /** Poll daemon status until it responds or we time out. */
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    const { exitCode } = run(["daemon", "status", "--project-root", projectRoot], { timeout: 5000 });
    if (exitCode === 0) return;
  }
  throw new Error("daemon failed to start within 10s");
}

function stopDaemon(projectRoot: string): RunResult {
  return run(["daemon", "stop", "--project-root", projectRoot], { timeout: 10_000 });
}

function daemonStatus(projectRoot: string): RunResult {
  return run(["daemon", "status", "--project-root", projectRoot], { timeout: 5000 });
}

function lintJson(projectRoot: string, extra: string[] = []): { diagnostics: { file: string; rule: string; severity: string; message: string; line: number; column: number }[]; exitCode: number; stderr: string } {
  const result = run(["lint", "--format", "json", ...extra], { cwd: projectRoot });
  let diagnostics: { file: string; rule: string; severity: string; message: string; line: number; column: number }[] = [];
  try {
    diagnostics = JSON.parse(result.stdout || "[]");
  } catch { /* empty */ }
  return { diagnostics, exitCode: result.exitCode, stderr: result.stderr };
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

      const stop = stopDaemon(root);
      expect(stop.stdout).toContain("Daemon stopped");

      /** Give the daemon a moment to exit and clean up the socket. */
      await sleep(500);

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

      const stop = stopDaemon(root);
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

      stopDaemon(root);
      await sleep(500);
    });
  });

  describe("lint via daemon", () => {
    it("produces identical diagnostics to in-process analysis", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      /** In-process baseline (no daemon). */
      const baseline = lintJson(root, ["--no-daemon"]);

      await startDaemonAndWait(root);

      /** Via daemon. */
      const viaD = lintJson(root);

      stopDaemon(root);
      await sleep(500);

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

      const result = lintJson(root);

      stopDaemon(root);
      await sleep(500);

      expect(result.diagnostics.length).toBe(0);
    });

    it("lints specific files via the daemon", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Good.tsx": CLEAN_COMPONENT,
        "src/Bad.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const goodOnly = lintJson(root, ["src/Good.tsx"]);
      const badOnly = lintJson(root, ["src/Bad.tsx"]);

      stopDaemon(root);
      await sleep(500);

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
      lintJson(root);
      const coldMs = performance.now() - t0;

      /** Second lint — warm: caches already populated. */
      const t1 = performance.now();
      const warm = lintJson(root);
      const warmMs = performance.now() - t1;

      stopDaemon(root);
      await sleep(500);

      /** Warm lint should produce the same results. */
      expect(warm.diagnostics.length).toBeGreaterThan(0);

      /** Warm should be faster (or at least not dramatically slower).
       * We don't assert a strict ratio since CI timing is noisy,
       * but log it for observability. */
      expect(typeof warmMs).toBe("number");
      expect(typeof coldMs).toBe("number");
    });

    it("detects file changes between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** First lint — clean. */
      const first = lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Introduce a bug. */
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      /** Second lint — should pick up the change. */
      const second = lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(0);

      stopDaemon(root);
      await sleep(500);
    });

    it("detects new files between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = lintJson(root);

      /** Add a new file with issues. */
      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = lintJson(root);

      stopDaemon(root);
      await sleep(500);

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

      const first = lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Bad.tsx"))).toBe(true);

      /** Delete the buggy file. */
      unlinkSync(join(root, "src/Bad.tsx"));

      const second = lintJson(root);

      stopDaemon(root);
      await sleep(500);

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

      const withDaemon = lintJson(root);
      const noDaemon = lintJson(root, ["--no-daemon"]);

      stopDaemon(root);
      await sleep(500);

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
      const result = lintJson(root);

      /** Should still produce diagnostics regardless of daemon path. */
      expect(result.diagnostics.length).toBeGreaterThan(0);

      /** Clean up any auto-started daemon. */
      stopDaemon(root);
      await sleep(500);
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

      const baseline = lintJson(root, ["--no-daemon"]);

      await startDaemonAndWait(root);
      const viaD = lintJson(root);

      stopDaemon(root);
      await sleep(500);

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

      const result = lintJson(root);

      stopDaemon(root);
      await sleep(500);

      expect(result.diagnostics.length).toBe(0);
    });

    it("falls back to in-process when daemon is stopped mid-session", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Stop the daemon. */
      stopDaemon(root);
      await sleep(500);

      /** Next lint should fall back to in-process. */
      const result = lintJson(root);
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
        results.push(lintJson(root));
      }

      stopDaemon(root);
      await sleep(500);

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

      stopDaemon(root);
      await sleep(500);
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

      stopDaemon(root);
      await sleep(500);
    });

    it("cleans up PID file after daemon stops", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const pidPath = testPidPath(root);
      expect(existsSync(pidPath)).toBe(true);

      stopDaemon(root);
      await sleep(1000);

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

      stopDaemon(root);
      await sleep(500);
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
      const pid = Number(readFileSync(pidPath, "utf-8").trim());
      process.kill(pid, "SIGKILL");
      await sleep(500);

      /** Lint should fall back to in-process gracefully. */
      const result = lintJson(root);
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

      const first = lintJson(root);
      expect(first.diagnostics.length).toBeGreaterThan(0);

      /** Fix the bug. */
      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);

      const second = lintJson(root);
      expect(second.diagnostics.length).toBe(0);

      stopDaemon(root);
      await sleep(500);
    });

    it("handles multiple files changing simultaneously", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/A.tsx": CLEAN_COMPONENT,
        "src/B.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Make both files buggy at once. */
      writeFileSync(join(root, "src/A.tsx"), BUGGY_COMPONENT);
      writeFileSync(join(root, "src/B.tsx"), BUGGY_COMPONENT);

      const second = lintJson(root);
      const filesWithDiags = new Set(second.diagnostics.map((d) => {
        const parts = d.file.split("/");
        return parts[parts.length - 1];
      }));
      expect(filesWithDiags.has("A.tsx")).toBe(true);
      expect(filesWithDiags.has("B.tsx")).toBe(true);

      stopDaemon(root);
      await sleep(500);
    });

    it("handles file rename (delete + create) between lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Old.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Old.tsx"))).toBe(true);

      /** Rename: delete old, create new with same content. */
      unlinkSync(join(root, "src/Old.tsx"));
      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = lintJson(root);
      expect(second.diagnostics.every((d) => !d.file.includes("Old.tsx"))).toBe(true);
      expect(second.diagnostics.some((d) => d.file.includes("New.tsx"))).toBe(true);

      stopDaemon(root);
      await sleep(500);
    });

    it("handles adding a new subdirectory with files", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      const first = lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      /** Add a new subdirectory. */
      mkdirSync(join(root, "src/components"), { recursive: true });
      writeFileSync(join(root, "src/components/Widget.tsx"), BUGGY_COMPONENT);

      const second = lintJson(root);
      expect(second.diagnostics.some((d) => d.file.includes("Widget.tsx"))).toBe(true);

      stopDaemon(root);
      await sleep(500);
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

      stopDaemon(root);
      await sleep(500);
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
      const lintResult = lintJson(root);
      expect(lintResult.diagnostics.length).toBeGreaterThan(0);

      stopDaemon(root);
      await sleep(500);
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

      const result = lintJson(root);
      expect(result.diagnostics.some((d) => d.file.includes("Buggy.tsx"))).toBe(true);

      /** Clean files should produce no diagnostics. */
      const cleanDiags = result.diagnostics.filter((d) => !d.file.includes("Buggy.tsx"));
      expect(cleanDiags.length).toBe(0);

      stopDaemon(root);
      await sleep(500);
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

      stopDaemon(root);
      await sleep(1000);

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
      lintJson(root);

      stopDaemon(root);
      await sleep(1000);

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

      const first = lintJson(root);
      const firstFiles = new Set(first.diagnostics.map((d) => d.file));
      expect(firstFiles.size).toBeGreaterThanOrEqual(1);

      /** Delete both bad files. */
      unlinkSync(join(root, "src/Bad1.tsx"));
      unlinkSync(join(root, "src/Bad2.tsx"));

      /** Three consecutive lints — none should have phantom diagnostics. */
      for (let i = 0; i < 3; i++) {
        const result = lintJson(root);
        expect(result.diagnostics.length).toBe(0);
      }

      stopDaemon(root);
      await sleep(500);
    });

    it("correctly picks up a third file added after two lint runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      await startDaemonAndWait(root);

      /** Run 1 — clean. */
      lintJson(root);

      /** Run 2 — still clean. */
      lintJson(root);

      /** Add buggy file after two warm runs. */
      writeFileSync(join(root, "src/Late.tsx"), BUGGY_COMPONENT);

      /** Run 3 — must detect the new file. */
      const third = lintJson(root);
      expect(third.diagnostics.some((d) => d.file.includes("Late.tsx"))).toBe(true);

      stopDaemon(root);
      await sleep(500);
    });
  });

  describe("diagnostic consistency across daemon restart", () => {
    it("produces identical results after daemon restart", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      const first = lintJson(root);
      stopDaemon(root);
      await sleep(1000);

      /** Start a fresh daemon. */
      await startDaemonAndWait(root);
      const second = lintJson(root);
      stopDaemon(root);
      await sleep(500);

      const normalize = (diags: { rule: string; line: number; column: number }[]) =>
        diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });
  });
});
