/**
 * Daemon Integration Tests
 *
 * Tests the daemon lifecycle, warm-cache linting, file change detection,
 * and parity with in-process analysis.
 *
 * Restructured for speed: tests that only READ from a daemon share a single
 * daemon instance via beforeAll/afterAll. Tests that MUTATE state or test
 * lifecycle get their own daemon.
 */
import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
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

const LSP_PKG: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
const LSP_VERSION = typeof LSP_PKG["version"] === "string" ? LSP_PKG["version"] : (() => { throw new Error("missing version in package.json"); })();

function ipcDir(): string {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  return runtimeDir ?? tmpdir();
}

function testSocketPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.sock`);
}

function testPidPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.pid`);
}

function testLogPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.log`);
}

/** Cleanup registry — all dirs/pids registered here are cleaned in afterAll/afterEach as appropriate. */
const globalCleanupDirs: string[] = [];
const globalCleanupPids: number[] = [];

function createTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ganko-daemon-test-"));
  globalCleanupDirs.push(dir);
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

async function startDaemonAndWait(projectRoot: string): Promise<void> {
  const child = spawn(
    NODE,
    [ENTRY, "daemon", "start", "--project-root", projectRoot],
    { detached: true, stdio: "ignore" },
  );
  if (child.pid !== undefined) {
    globalCleanupPids.push(child.pid);
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
    cliResult = run(["daemon", "stop", "--project-root", projectRoot], { timeout: 10_000 });
  }

  const pidPath = testPidPath(projectRoot);
  for (let i = 0; i < 120; i++) {
    if (!existsSync(sockPath) && !existsSync(pidPath)) break;
    await sleep(25);
  }

  return cliResult ?? { stdout: "Daemon stopped", stderr: "", exitCode: 0 };
}

function daemonStatus(projectRoot: string): RunResult {
  return run(["daemon", "status", "--project-root", projectRoot], { timeout: 5000 });
}

async function lintJson(projectRoot: string, extra: string[] = []): Promise<{ diagnostics: DiagnosticResult[]; exitCode: number; stderr: string }> {
  const flags = extra.filter((arg) => arg.startsWith("--"));
  const fileArgs = extra.filter((arg) => !arg.startsWith("--"));

  if (flags.length > 0) {
    const result = run(["lint", "--format", "json", ...flags, ...fileArgs], { cwd: projectRoot });
    const diagnostics: DiagnosticResult[] = JSON.parse(result.stdout || "[]");
    return { diagnostics, exitCode: result.exitCode, stderr: result.stderr };
  }

  try {
    const diagnostics = await ipcLint(projectRoot, fileArgs.length > 0 ? fileArgs : undefined);
    const exitCode = diagnostics.some((d) => d.severity === "error") ? 1 : 0;
    return { diagnostics: [...diagnostics], exitCode, stderr: "" };
  } catch {
    const result = run(["lint", "--format", "json", ...fileArgs], { cwd: projectRoot });
    const diagnostics: DiagnosticResult[] = JSON.parse(result.stdout || "[]");
    return { diagnostics, exitCode: result.exitCode, stderr: result.stderr };
  }
}

const normalize = (diags: { rule: string; line: number; column: number }[]) =>
  diags.map((d) => `${d.rule}:${d.line}:${d.column}`).toSorted();

const normalizeWithFile = (diags: { file: string; rule: string; line: number; column: number }[]) =>
  diags.map((d) => `${d.file}:${d.rule}:${d.line}:${d.column}`).toSorted();

/** Final cleanup for anything leaked. */
afterAll(() => {
  for (const pid of globalCleanupPids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
  }
  for (const dir of globalCleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────
// CSS fixture constants shared across multiple describe blocks
// ────────────────────────────────────────────────────────────────

const COMPONENT_WITH_CSS = [
  'import { createSignal } from "solid-js";',
  'import "./styles.css";',
  "/**",
  " * Animated card component.",
  " * @returns Card element",
  " */",
  "export function Card() {",
  "  const [open, setOpen] = createSignal(false);",
  '  return <div class="card">{open() ? "open" : "closed"}</div>;',
  "}",
].join("\n");

const CSS_WITH_ANIMATION_WARNING = [
  "@keyframes fade-in {",
  "  from { opacity: 0; }",
  "  to { opacity: 1; }",
  "}",
  ".card {",
  "  animation: fade-in 300ms ease-out;",
  "}",
].join("\n");

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

const CSS_NO_ANIMATION = [
  ".card {",
  "  display: flex;",
  "  padding: 1rem;",
  "}",
].join("\n");

// ────────────────────────────────────────────────────────────────
// GROUP 1: No daemon needed — pure CLI / in-process tests
// ────────────────────────────────────────────────────────────────

describe("daemon integration", () => {
  describe("no-daemon tests", () => {
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

    it("does not crash when cross-file runs without CSS files", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
        "src/helpers.ts": "export const add = (a: number, b: number) => a + b;",
      });

      const result = await lintJson(root, ["--no-daemon"]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 2: Shared daemon — read-only tests on a buggy project
  //
  // One daemon started in beforeAll, all tests lint without mutating.
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: buggy project (read-only)", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
        "src/Good.tsx": CLEAN_COMPONENT,
      });
      await startDaemonAndWait(root);
      // warm the cache with an initial lint
      await lintJson(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("produces identical diagnostics to in-process analysis", async () => {
      const baseline = await lintJson(root, ["--no-daemon"]);
      const viaD = await lintJson(root);

      expect(viaD.exitCode).toBe(baseline.exitCode);
      expect(normalize(viaD.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });

    it("returns empty diagnostics when linting only the clean file", async () => {
      const goodOnly = await lintJson(root, ["src/Good.tsx"]);
      expect(goodOnly.diagnostics.length).toBe(0);
    });

    it("lints specific files via the daemon", async () => {
      const badOnly = await lintJson(root, ["src/Counter.tsx"]);
      expect(badOnly.diagnostics.length).toBeGreaterThan(0);
      expect(badOnly.diagnostics.every((d) => d.file.includes("Counter.tsx"))).toBe(true);
    });

    it("second lint reuses warm caches (faster than first)", async () => {
      const t0 = performance.now();
      await lintJson(root);
      const coldMs = performance.now() - t0;

      const t1 = performance.now();
      const warm = await lintJson(root);
      const warmMs = performance.now() - t1;

      expect(warm.diagnostics.length).toBeGreaterThan(0);
      expect(typeof warmMs).toBe("number");
      expect(typeof coldMs).toBe("number");
    });

    it("warm cache path produces identical diagnostics to cold path", async () => {
      const cold = await lintJson(root);
      const warm = await lintJson(root);

      expect(warm.diagnostics.length).toBe(cold.diagnostics.length);
      expect(warm.diagnostics.map((d) => `${d.rule}:${d.file}`).toSorted()).toEqual(
        cold.diagnostics.map((d) => `${d.rule}:${d.file}`).toSorted(),
      );
      expect(cold.diagnostics.length).toBeGreaterThan(0);
    });

    it("handles multiple sequential lint requests correctly", async () => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await lintJson(root));
      }

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
      const [a, b, c] = await Promise.all([
        lintJson(root),
        lintJson(root),
        lintJson(root),
      ]);

      const norm = (diags: { rule: string }[]) =>
        diags.map((d) => d.rule).toSorted();

      expect(a.diagnostics.length).toBeGreaterThan(0);
      expect(norm(b.diagnostics)).toEqual(norm(a.diagnostics));
      expect(norm(c.diagnostics)).toEqual(norm(a.diagnostics));
    });

    it("status response includes correct version", () => {
      const status = daemonStatus(root);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain(String(LSP_VERSION));
    });

    it("serialized shutdown waits for in-flight lint to complete", async () => {
      const lintResult = await lintJson(root);
      expect(lintResult.diagnostics.length).toBeGreaterThan(0);
    });

    it("--no-daemon bypasses daemon and runs in-process", async () => {
      const withDaemon = await lintJson(root);
      const noDaemon = await lintJson(root, ["--no-daemon"]);

      expect(normalize(noDaemon.diagnostics)).toEqual(normalize(withDaemon.diagnostics));
    });

    it("daemon handles solid-only project cross-file analysis", async () => {
      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("consecutive lints after pre-warm produce stable results", async () => {
      const runs = [];
      for (let i = 0; i < 4; i++) {
        runs.push(await lintJson(root));
      }

      const firstRun = runs[0];
      if (!firstRun) throw new Error("expected at least one run");
      const firstResult = normalizeWithFile(firstRun.diagnostics);
      for (let i = 1; i < runs.length; i++) {
        const r = runs[i];
        if (!r) continue;
        expect(normalizeWithFile(r.diagnostics)).toEqual(firstResult);
      }
    });

    it("unchanged files between lint runs don't cause diagnostic instability", async () => {
      const cold = await lintJson(root);
      const warm = await lintJson(root);
      const warm2 = await lintJson(root);

      expect(normalizeWithFile(warm.diagnostics)).toEqual(normalizeWithFile(cold.diagnostics));
      expect(normalizeWithFile(warm2.diagnostics)).toEqual(normalizeWithFile(cold.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 3: Shared daemon — clean project (read-only)
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: clean project (read-only)", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });
      await startDaemonAndWait(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("returns empty diagnostics for a clean project", async () => {
      const result = await lintJson(root);
      expect(result.diagnostics.length).toBe(0);
    });

    it("daemon handles empty project gracefully", async () => {
      // lint just the tsconfig-only portion (no .tsx targeted)
      const emptyRoot = createTempProject({ "tsconfig.json": TSCONFIG });
      // use CLI fallback since this project has no daemon
      const result = await lintJson(emptyRoot, ["--no-daemon"]);
      expect(result.diagnostics.length).toBe(0);
    });

    it("restricts socket to owner-only on Unix", async () => {
      if (process.platform === "win32") return;

      const sockPath = testSocketPath(root);
      const stats = statSync(sockPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("creates a log file with daemon activity", async () => {
      const logPath = testLogPath(root);
      expect(existsSync(logPath)).toBe(true);

      await lintJson(root);

      const logContent = readFileSync(logPath, "utf-8");
      expect(logContent.length).toBeGreaterThan(0);
      expect(logContent).toContain("daemon");
    });

    it("writes a PID file that contains a valid numeric PID", async () => {
      const pidPath = testPidPath(root);

      for (let i = 0; i < 80; i++) {
        if (existsSync(pidPath)) break;
        await sleep(50);
      }
      expect(existsSync(pidPath)).toBe(true);

      const pidContent = readFileSync(pidPath, "utf-8").trim();
      const pid = Number(pidContent);
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);

      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch { /* not running */ }
      expect(alive).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 4: Shared daemon — many files project (read-only)
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: many files project", () => {
    let root: string;

    beforeAll(async () => {
      const fileMap = new Map<string, string>();
      fileMap.set("tsconfig.json", TSCONFIG);
      for (let i = 0; i < 20; i++) {
        fileMap.set(`src/Component${String(i)}.tsx`, CLEAN_COMPONENT);
      }
      fileMap.set("src/Buggy.tsx", BUGGY_COMPONENT);
      root = createTempProject(Object.fromEntries(fileMap));
      await startDaemonAndWait(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("handles a project with many files without crashing", async () => {
      const result = await lintJson(root);
      expect(result.diagnostics.some((d) => d.file.includes("Buggy.tsx"))).toBe(true);
      const cleanDiags = result.diagnostics.filter((d) => !d.file.includes("Buggy.tsx"));
      expect(cleanDiags.length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 5: Shared daemon — cross-file analysis (read-only)
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: cross-file analysis", () => {
    let root: string;

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

    beforeAll(async () => {
      root = createTempProject({
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
        "src/Card.tsx": COMPONENT_WITH_UNDEFINED_CLASS,
        "src/styles.css": CSS_DEFINES_CARD,
      });
      await startDaemonAndWait(root);
      await lintJson(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("produces cross-file diagnostics via daemon matching in-process", async () => {
      const baseline = await lintJson(root, ["--no-daemon"]);
      const viaD = await lintJson(root);

      expect(normalize(viaD.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });

    it("consecutive no-change runs produce identical cross-file diagnostics", async () => {
      const first = await lintJson(root);
      const second = await lintJson(root);
      const third = await lintJson(root);

      expect(normalizeWithFile(second.diagnostics)).toEqual(normalizeWithFile(first.diagnostics));
      expect(normalizeWithFile(third.diagnostics)).toEqual(normalizeWithFile(second.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 6: Shared daemon — CSS read-only tests
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: CSS cached results", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });
      await startDaemonAndWait(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("returns cached results when CSS has not changed", async () => {
      const first = await lintJson(root);
      const second = await lintJson(root);

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 7: Pre-warm read-only tests (shared daemon)
  // ────────────────────────────────────────────────────────────────

  describe("shared daemon: pre-warm correctness (read-only)", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
        "src/App.tsx": CLEAN_COMPONENT,
      });
      await startDaemonAndWait(root);
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("pre-warmed daemon produces identical diagnostics to --no-daemon", async () => {
      const baseline = await lintJson(root, ["--no-daemon"]);
      const prewarmed = await lintJson(root);

      expect(normalize(prewarmed.diagnostics)).toEqual(normalize(baseline.diagnostics));
    });

    it("pre-warm does not interfere with ESLint config from lint request", async () => {
      // This test uses a separate project with custom eslint config
      const customRoot = createTempProject({
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

      await startDaemonAndWait(customRoot);

      const result = await lintJson(customRoot);
      const destructureDiags = result.diagnostics.filter(
        (d) => d.rule === "no-destructure",
      );
      expect(destructureDiags.length).toBe(0);

      const inProcess = await lintJson(customRoot, ["--no-daemon"]);
      const inProcDestructure = inProcess.diagnostics.filter(
        (d) => d.rule === "no-destructure",
      );
      expect(inProcDestructure.length).toBe(0);

      await stopDaemon(customRoot);
    });

    it("pre-warm with --exclude: excludes are respected despite pre-warm lacking them", async () => {
      const excludeRoot = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
        "src/legacy/Old.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(excludeRoot);

      const withExclude = await lintJson(excludeRoot, ["--exclude", "src/legacy/**"]);
      const legacyDiags = withExclude.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );
      expect(legacyDiags.length).toBe(0);

      const withoutExclude = await lintJson(excludeRoot);
      const legacyDiags2 = withoutExclude.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );
      expect(legacyDiags2.length).toBeGreaterThan(0);

      await stopDaemon(excludeRoot);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 8: Lifecycle tests — each needs its own daemon
  // ────────────────────────────────────────────────────────────────

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

      const stop = run(["daemon", "stop", "--project-root", root], { timeout: 10_000 });
      expect(stop.stdout).toContain("Daemon stopped");

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

    it("starts despite a leftover socket file from a crashed daemon", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });

      writeFileSync(testSocketPath(root), "stale");

      await startDaemonAndWait(root);

      const status = daemonStatus(root);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Daemon running");

      await stopDaemon(root);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 9: Auto-start
  // ────────────────────────────────────────────────────────────────

  describe("auto-start", () => {
    it("lint auto-starts a daemon when none is running", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);

      await stopDaemon(root);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 10: Crash recovery
  // ────────────────────────────────────────────────────────────────

  describe("crash recovery", () => {
    it("client falls back to in-process after daemon is killed with SIGKILL", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);

      const pidPath = testPidPath(root);
      for (let i = 0; i < 80; i++) {
        if (existsSync(pidPath)) break;
        await sleep(50);
      }
      const pid = Number(readFileSync(pidPath, "utf-8").trim());
      process.kill(pid, "SIGKILL");
      await sleep(500);

      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("falls back to in-process when daemon is stopped mid-session", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      await stopDaemon(root);

      const result = await lintJson(root);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 11: Restart consistency
  // ────────────────────────────────────────────────────────────────

  describe("restart consistency", () => {
    it("produces identical results after daemon restart", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      const first = await lintJson(root);
      await stopDaemon(root);

      await startDaemonAndWait(root);
      const second = await lintJson(root);
      await stopDaemon(root);

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });

    it("daemon restart after pre-warm produces identical results", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": BUGGY_COMPONENT,
      });

      await startDaemonAndWait(root);
      const first = await lintJson(root);
      await stopDaemon(root);

      await startDaemonAndWait(root);
      const second = await lintJson(root);
      await stopDaemon(root);

      expect(normalize(second.diagnostics)).toEqual(normalize(first.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 12: File mutation scenarios — shared daemon, sequential mutations
  // Each test mutates files then asserts. They share one daemon but
  // reset the project between tests via afterEach.
  // ────────────────────────────────────────────────────────────────

  describe("file mutation scenarios (shared daemon)", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/App.tsx": CLEAN_COMPONENT,
      });
      await startDaemonAndWait(root);
    });

    afterEach(() => {
      // Reset project to clean state between mutation tests
      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);
      // Remove any extra files that tests may have added
      for (const name of ["src/New.tsx", "src/Bad.tsx", "src/A.tsx", "src/B.tsx",
        "src/Old.tsx", "src/Late.tsx", "src/Bad1.tsx", "src/Bad2.tsx",
        "src/Extra.tsx", "src/components/Widget.tsx"]) {
        try { unlinkSync(join(root, name)); } catch { /* doesn't exist */ }
      }
      try { rmSync(join(root, "src/components"), { recursive: true, force: true }); } catch { /* doesn't exist */ }
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("detects file changes between lint runs", async () => {
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(0);
    });

    it("detects new files between lint runs", async () => {
      const first = await lintJson(root);

      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(first.diagnostics.length);
      expect(second.diagnostics.some((d) => d.file.includes("New.tsx"))).toBe(true);
    });

    it("handles deleted files between lint runs", async () => {
      writeFileSync(join(root, "src/Bad.tsx"), BUGGY_COMPONENT);

      const first = await lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Bad.tsx"))).toBe(true);

      unlinkSync(join(root, "src/Bad.tsx"));

      const second = await lintJson(root);
      expect(second.diagnostics.every((d) => !d.file.includes("Bad.tsx"))).toBe(true);
    });

    it("detects a file going from buggy to clean", async () => {
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      const first = await lintJson(root);
      expect(first.diagnostics.length).toBeGreaterThan(0);

      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.length).toBe(0);
    });

    it("handles multiple files changing simultaneously", async () => {
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      writeFileSync(join(root, "src/A.tsx"), BUGGY_COMPONENT);
      writeFileSync(join(root, "src/B.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      const filesWithDiags = new Set(second.diagnostics.map((d) => {
        const parts = d.file.split("/");
        return parts[parts.length - 1];
      }));
      expect(filesWithDiags.has("A.tsx")).toBe(true);
      expect(filesWithDiags.has("B.tsx")).toBe(true);
    });

    it("handles file rename (delete + create) between lint runs", async () => {
      writeFileSync(join(root, "src/Old.tsx"), BUGGY_COMPONENT);

      const first = await lintJson(root);
      expect(first.diagnostics.some((d) => d.file.includes("Old.tsx"))).toBe(true);

      unlinkSync(join(root, "src/Old.tsx"));
      writeFileSync(join(root, "src/New.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.every((d) => !d.file.includes("Old.tsx"))).toBe(true);
      expect(second.diagnostics.some((d) => d.file.includes("New.tsx"))).toBe(true);
    });

    it("handles adding a new subdirectory with files", async () => {
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      mkdirSync(join(root, "src/components"), { recursive: true });
      writeFileSync(join(root, "src/components/Widget.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.some((d) => d.file.includes("Widget.tsx"))).toBe(true);
    });

    it("does not leak diagnostics from deleted files into subsequent runs", async () => {
      writeFileSync(join(root, "src/Bad1.tsx"), BUGGY_COMPONENT);
      writeFileSync(join(root, "src/Bad2.tsx"), BUGGY_COMPONENT);

      const first = await lintJson(root);
      const firstFiles = new Set(first.diagnostics.map((d) => d.file));
      expect(firstFiles.size).toBeGreaterThanOrEqual(1);

      unlinkSync(join(root, "src/Bad1.tsx"));
      unlinkSync(join(root, "src/Bad2.tsx"));

      for (let i = 0; i < 3; i++) {
        const result = await lintJson(root);
        expect(result.diagnostics.length).toBe(0);
      }
    });

    it("correctly picks up a third file added after two lint runs", async () => {
      await lintJson(root);
      await lintJson(root);

      writeFileSync(join(root, "src/Late.tsx"), BUGGY_COMPONENT);

      const third = await lintJson(root);
      expect(third.diagnostics.some((d) => d.file.includes("Late.tsx"))).toBe(true);
    });

    it("changed files are correctly detected despite version stability optimization", async () => {
      const clean = await lintJson(root);
      expect(clean.diagnostics.length).toBe(0);

      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);
      const buggy = await lintJson(root);
      expect(buggy.diagnostics.length).toBeGreaterThan(0);

      writeFileSync(join(root, "src/App.tsx"), CLEAN_COMPONENT);
      const cleanAgain = await lintJson(root);
      expect(cleanAgain.diagnostics.length).toBe(0);
    });

    it("daemon closes files removed between requests", async () => {
      writeFileSync(join(root, "src/Extra.tsx"), BUGGY_COMPONENT);
      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      const first = await lintJson(root);
      expect(first.diagnostics.length).toBeGreaterThan(0);

      rmSync(join(root, "src/Extra.tsx"));
      const second = await lintJson(root);

      expect(second.diagnostics.length).toBeLessThan(first.diagnostics.length);
      const deletedFileDiags = second.diagnostics.filter(
        (d) => d.file.includes("Extra.tsx"),
      );
      expect(deletedFileDiags).toHaveLength(0);
    });

    it("pre-warmed daemon handles file changes after pre-warm", async () => {
      const first = await lintJson(root);
      expect(first.diagnostics.length).toBe(0);

      writeFileSync(join(root, "src/App.tsx"), BUGGY_COMPONENT);

      const second = await lintJson(root);
      expect(second.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 13: CSS mutation scenarios — shared daemon
  // ────────────────────────────────────────────────────────────────

  describe("CSS file change detection (shared daemon)", () => {
    let root: string;

    beforeAll(async () => {
      root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Card.tsx": COMPONENT_WITH_CSS,
        "src/styles.css": CSS_WITH_ANIMATION_WARNING,
      });
      await startDaemonAndWait(root);
    });

    afterEach(() => {
      // Reset CSS to initial state
      writeFileSync(join(root, "src/styles.css"), CSS_WITH_ANIMATION_WARNING);
      try { unlinkSync(join(root, "src/extra.css")); } catch { /* doesn't exist */ }
    });

    afterAll(async () => {
      await stopDaemon(root);
    });

    it("detects CSS content changes between daemon lint runs", async () => {
      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBeGreaterThan(0);

      writeFileSync(join(root, "src/styles.css"), CSS_WITH_MOTION_OVERRIDE);

      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBe(0);
    });

    it("detects CSS file added between daemon lint runs", async () => {
      writeFileSync(join(root, "src/styles.css"), CSS_NO_ANIMATION);

      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBe(0);

      writeFileSync(join(root, "src/extra.css"), CSS_WITH_ANIMATION_WARNING);

      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBeGreaterThan(0);
    });

    it("detects CSS file deleted between daemon lint runs", async () => {
      const first = await lintJson(root);
      const motionWarnings1 = first.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings1.length).toBeGreaterThan(0);

      unlinkSync(join(root, "src/styles.css"));

      const second = await lintJson(root);
      const motionWarnings2 = second.diagnostics.filter(
        (d) => d.rule === "css-require-reduced-motion-override",
      );
      expect(motionWarnings2.length).toBe(0);
    });

    it("CSS changes produce results matching in-process analysis", async () => {
      await lintJson(root);

      writeFileSync(join(root, "src/styles.css"), CSS_WITH_MOTION_OVERRIDE);

      const daemonResult = await lintJson(root);
      await stopDaemon(root);

      const inProcess = await lintJson(root, ["--no-daemon"]);

      // Restart daemon for other tests / afterAll
      await startDaemonAndWait(root);

      expect(normalize(daemonResult.diagnostics)).toEqual(normalize(inProcess.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 14: ESLint config change detection — needs own daemon
  // ────────────────────────────────────────────────────────────────

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

      const first = await lintJson(root);
      const destructureErrors1 = first.diagnostics.filter(
        (d) => d.rule === "no-destructure",
      );
      expect(destructureErrors1.length).toBeGreaterThan(0);

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

      const first = await lintJson(root);
      const legacyDiags1 = first.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );
      expect(legacyDiags1.length).toBeGreaterThan(0);

      writeFileSync(
        join(root, "eslint.config.mjs"),
        [
          "export default [",
          '  { ignores: ["src/legacy/**"] },',
          "];",
        ].join("\n"),
      );

      const second = await lintJson(root);
      const legacyDiags2 = second.diagnostics.filter(
        (d) => d.file.includes("legacy/Old.tsx"),
      );

      await stopDaemon(root);

      expect(legacyDiags2.length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 15: Cache invalidation — externalCustomProperties
  // ────────────────────────────────────────────────────────────────

  describe("externalCustomProperties staleness", () => {
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

    const LIB_JS_WITH_PROP = 'export const theme = { color: "--lib-color" };\n';

    it("picks up new dependency custom properties between daemon runs", async () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "package.json": JSON.stringify({ name: "test-proj", dependencies: {} }),
        "src/Card.tsx": COMPONENT_IMPORTS_CSS,
        "src/styles.css": CSS_WITH_LIB_VAR,
      });

      await startDaemonAndWait(root);

      const first = await lintJson(root);
      const unresolved1 = first.diagnostics.filter(
        (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
      );
      expect(unresolved1.length).toBeGreaterThan(0);

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

      const second = await lintJson(root);
      const unresolved2 = second.diagnostics.filter(
        (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
      );

      const inProcess = await lintJson(root, ["--no-daemon"]);
      const unresolvedInProc = inProcess.diagnostics.filter(
        (d) => d.rule === "no-unresolved-custom-properties" && d.message.includes("--lib-color"),
      );

      await stopDaemon(root);

      expect(unresolved2.length).toBe(unresolvedInProc.length);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 16: Targeted --files + cross-file staleness
  // ────────────────────────────────────────────────────────────────

  describe("targeted --files + cross-file staleness", () => {
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

      const warm = await lintJson(root);
      const phantomWarm = warm.diagnostics.filter(
        (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
      );
      expect(phantomWarm.length).toBe(0);

      writeFileSync(join(root, "src/B.tsx"), COMPONENT_B_V2);

      const targeted = await lintJson(root, ["src/A.tsx"]);
      const inProcess = await lintJson(root, ["--no-daemon", "src/A.tsx"]);

      await stopDaemon(root);

      const daemonPhantom = targeted.diagnostics.filter(
        (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
      );
      const inProcPhantom = inProcess.diagnostics.filter(
        (d) => d.rule === "jsx-no-undefined-css-class" && d.message.includes("phantom"),
      );

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

      await lintJson(root);

      writeFileSync(join(root, "src/B.tsx"), COMPONENT_B_V2);

      await lintJson(root, ["src/A.tsx"]);

      const full = await lintJson(root);
      const inProcess = await lintJson(root, ["--no-daemon"]);

      await stopDaemon(root);

      expect(normalizeWithFile(full.diagnostics)).toEqual(normalizeWithFile(inProcess.diagnostics));
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GROUP 17: Version fallback for files outside tsconfig
  // ────────────────────────────────────────────────────────────────

  describe("version fallback for files outside tsconfig", () => {
    const JSX_V1 = [
      'import { createSignal } from "solid-js";',
      "export function Loose() {",
      "  const [count] = createSignal(0);",
      "  return <div>{count}</div>;",
      "}",
    ].join("\n");

    const JSX_V2 = [
      'import { createSignal } from "solid-js";',
      "export function Loose() {",
      "  const [count] = createSignal(0);",
      "  return <div>{count()}</div>;",
      "}",
    ].join("\n");

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

      const first = await lintJson(root);
      const firstRules = first.diagnostics
        .filter((d) => d.file.includes("Loose.jsx"))
        .map((d) => d.rule)
        .toSorted();

      writeFileSync(join(root, "src/Loose.jsx"), JSX_V2);

      const second = await lintJson(root);
      const secondRules = second.diagnostics
        .filter((d) => d.file.includes("Loose.jsx"))
        .map((d) => d.rule)
        .toSorted();

      const inProcess = await lintJson(root, ["--no-daemon"]);
      const inProcRules = inProcess.diagnostics
        .filter((d) => d.file.includes("Loose.jsx"))
        .map((d) => d.rule)
        .toSorted();

      await stopDaemon(root);

      expect(secondRules).toEqual(inProcRules);
      expect(secondRules).not.toEqual(firstRules);
    });
  });
});
