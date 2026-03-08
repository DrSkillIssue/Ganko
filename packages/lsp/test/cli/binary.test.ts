/**
 * CLI Binary Regression Tests
 *
 * Verifies that the compiled ganko binary (produced by bun build --compile)
 * handles all CLI arguments correctly. These tests run the actual binary
 * as a subprocess to catch ESM/CJS bundling issues, shebang problems,
 * and argument parsing regressions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const BINARY = join(__dirname, "../../dist/ganko");
const ENTRY = join(__dirname, "../../dist/entry.js");
const BASIC_APP = join(__dirname, "../fixtures/basic-app");

const VERSION_RE = /^ganko \d+\.\d+\.\d+$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function runBinary(args: string[], options?: { cwd?: string; timeout?: number }): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const result = spawnSync(BINARY, args, {
    cwd: options?.cwd,
    encoding: "utf-8",
    timeout: options?.timeout ?? 15000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : 1,
  };
}

function runEntry(args: string[], options?: { cwd?: string; timeout?: number }): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const result = spawnSync("node", [ENTRY, ...args], {
    cwd: options?.cwd,
    encoding: "utf-8",
    timeout: options?.timeout ?? 15000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : 1,
  };
}

describe("ganko binary", () => {
  it("compiled binary exists", () => {
    expect(existsSync(BINARY)).toBe(true);
  });

  it("JS entry exists", () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  describe("--help", () => {
    it("prints help and exits 0 from binary", () => {
      const { stdout, exitCode } = runBinary(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ganko - Solid.js Language Server & Linter");
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("--stdio");
      expect(stdout).toContain("lint");
    });

    it("prints help and exits 0 from entry.js", () => {
      const { stdout, exitCode } = runEntry(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ganko - Solid.js Language Server & Linter");
    });

    it("accepts -h shorthand", () => {
      const { stdout, exitCode } = runBinary(["-h"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ganko - Solid.js Language Server & Linter");
    });
  });

  describe("--version", () => {
    it("prints version and exits 0 from binary", () => {
      const { stdout, exitCode } = runBinary(["--version"]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toMatch(VERSION_RE);
    });

    it("prints version and exits 0 from entry.js", () => {
      const { stdout, exitCode } = runEntry(["--version"]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toMatch(VERSION_RE);
    });

    it("binary and entry.js report the same version", () => {
      const binary = runBinary(["--version"]);
      const entry = runEntry(["--version"]);
      expect(binary.stdout.trim()).toBe(entry.stdout.trim());
    });
  });

  describe("lint subcommand", () => {
    it("exits 1 when errors are found", () => {
      const { exitCode } = runBinary(["lint", "--no-cross-file"], { cwd: BASIC_APP });
      expect(exitCode).toBe(1);
    });

    it("produces text output by default", () => {
      const { stdout, exitCode } = runBinary(["lint", "--no-cross-file"], { cwd: BASIC_APP });
      expect(exitCode).toBe(1);
      expect(stdout).toContain("problem");
      expect(stdout).toContain("error");
    });

    it("produces valid JSON with --format json", () => {
      const { stdout, exitCode } = runBinary(
        ["lint", "--format", "json", "--no-cross-file"],
        { cwd: BASIC_APP },
      );
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0]).toHaveProperty("file");
      expect(parsed[0]).toHaveProperty("rule");
      expect(parsed[0]).toHaveProperty("severity");
      expect(parsed[0]).toHaveProperty("message");
    });

    it("binary and entry.js produce identical lint output", () => {
      const binary = runBinary(
        ["lint", "--format", "json", "--no-cross-file"],
        { cwd: BASIC_APP },
      );
      const entry = runEntry(
        ["lint", "--format", "json", "--no-cross-file"],
        { cwd: BASIC_APP },
      );
      expect(binary.exitCode).toBe(entry.exitCode);

      const sortDiagnostics = (arr: { file: string; line: number; column: number }[]) =>
        arr.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

      expect(sortDiagnostics(JSON.parse(binary.stdout))).toEqual(
        sortDiagnostics(JSON.parse(entry.stdout)),
      );
    });
  });

  describe("--stdio (LSP mode)", () => {
    it("does not crash on startup from binary", () => {
      const result = spawnSync(BINARY, ["--stdio"], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
        input: "",
      });

      const crashed = result.stderr?.includes("Dynamic require") ?? false;
      expect(crashed).toBe(false);

      const hasRequireError = result.stderr?.includes("is not supported") ?? false;
      expect(hasRequireError).toBe(false);
    });

    it("does not crash on startup from entry.js", () => {
      const result = spawnSync("node", [ENTRY, "--stdio"], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
        input: "",
      });

      const crashed = result.stderr?.includes("Dynamic require") ?? false;
      expect(crashed).toBe(false);
    });

    it("responds to LSP initialize request", () => {
      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { capabilities: {} },
      });
      const message = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n${initRequest}`;

      const result = spawnSync(BINARY, ["--stdio"], {
        encoding: "utf-8",
        timeout: 5000,
        input: message,
      });

      const output = result.stdout ?? "";
      expect(output).toContain("Content-Length:");
      expect(output).toContain("jsonrpc");
    });
  });

  describe("--log-file", () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it("CLI lint writes logs to file when --log-file is set", () => {
      tempDir = mkdtempSync(join(tmpdir(), "ganko-logfile-test-"));
      const logPath = join(tempDir, "lint.log");

      const result = spawnSync("node", [ENTRY, "lint", "--verbose", "--log-file", logPath, "--no-cross-file"], {
        cwd: BASIC_APP,
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      expect(existsSync(logPath)).toBe(true);
      const logContent = readFileSync(logPath, "utf-8");
      expect(logContent.length).toBeGreaterThan(0);
      expect(logContent).toContain("[info]");
      expect(logContent).toContain("project root:");
    });

    it("CLI lint writes to both stderr and file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "ganko-logfile-test-"));
      const logPath = join(tempDir, "dual.log");

      const result = spawnSync("node", [ENTRY, "lint", "--verbose", "--log-file", logPath, "--no-cross-file"], {
        cwd: BASIC_APP,
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const logContent = readFileSync(logPath, "utf-8");
      const stderr = result.stderr ?? "";

      expect(stderr).toContain("[info]");
      expect(logContent).toContain("[info]");
    });

    it("LSP stdio mode writes logs to file when --log-file is set", () => {
      tempDir = mkdtempSync(join(tmpdir(), "ganko-logfile-test-"));
      const logPath = join(tempDir, "lsp.log");

      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { capabilities: {} },
      });
      const message = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n${initRequest}`;

      spawnSync("node", [ENTRY, "--stdio", "--log-file", logPath], {
        encoding: "utf-8",
        timeout: 5000,
        input: message,
      });

      expect(existsSync(logPath)).toBe(true);
      const logContent = readFileSync(logPath, "utf-8");
      expect(logContent.length).toBeGreaterThan(0);
      expect(logContent).toContain("ganko server starting");
    });

    it("log file contains ISO timestamps", () => {
      tempDir = mkdtempSync(join(tmpdir(), "ganko-logfile-test-"));
      const logPath = join(tempDir, "timestamps.log");

      spawnSync("node", [ENTRY, "lint", "--verbose", "--log-file", logPath, "--no-cross-file"], {
        cwd: BASIC_APP,
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const logContent = readFileSync(logPath, "utf-8");
      const firstLine = logContent.split("\n")[0] ?? "";
      expect(firstLine).toMatch(ISO_TIMESTAMP_RE);
    });
  });
});
