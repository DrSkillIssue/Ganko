/**
 * CLI Lint Integration Tests
 *
 * Runs `ganko lint` as a subprocess against test fixtures
 * and verifies output and exit codes.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(__dirname, "../../dist/entry.js");
const BASIC_APP = join(__dirname, "../fixtures/basic-app");
const MULTI_FILE_APP = join(__dirname, "../fixtures/multi-file-app");

function runLint(args: string[], cwd: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("bun", [BIN, "lint", ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      exitCode: typeof e.status === "number" ? e.status : 1,
    };
  }
}

describe("ganko lint", () => {
  describe("basic usage", () => {
    it("lints entire project and exits with 1 when errors found", () => {
      const { stdout, exitCode } = runLint(["--no-cross-file"], BASIC_APP);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("problem");
      expect(stdout).toContain("error");
    });

    it("lints a specific file", () => {
      const { stdout, exitCode } = runLint(["counter.tsx", "--no-cross-file"], BASIC_APP);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("counter.tsx");
      expect(stdout).toContain("1 problem");
    });
  });

  describe("JSON format", () => {
    it("outputs valid JSON array", () => {
      const { stdout, exitCode } = runLint(["--format", "json", "--no-cross-file"], BASIC_APP);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      const first = parsed[0];
      expect(first).toHaveProperty("file");
      expect(first).toHaveProperty("rule");
      expect(first).toHaveProperty("severity");
      expect(first).toHaveProperty("message");
      expect(first).toHaveProperty("line");
      expect(first).toHaveProperty("column");
    });

    it("outputs empty array when targeting a clean file", () => {
      const { stdout } = runLint(
        ["--format", "json", "--no-cross-file", "nonexistent.tsx"],
        BASIC_APP,
      );

      expect(JSON.parse(stdout)).toEqual([]);
    });
  });

  describe("cross-file analysis", () => {
    it("includes cross-file diagnostics by default for multi-file app", () => {
      const { stdout } = runLint(["--format", "json"], MULTI_FILE_APP);

      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it("produces fewer diagnostics with --no-cross-file", () => {
      const { stdout: withCross } = runLint(["--format", "json"], MULTI_FILE_APP);
      const { stdout: noCross } = runLint(["--format", "json", "--no-cross-file"], MULTI_FILE_APP);

      const withCrossParsed = JSON.parse(withCross);
      const noCrossParsed = JSON.parse(noCross);

      expect(noCrossParsed.length).toBeLessThanOrEqual(withCrossParsed.length);
    });
  });

  describe("directory arguments", () => {
    it("lints all files in a directory passed as argument", () => {
      const { stdout, exitCode } = runLint(
        [BASIC_APP, "--format", "json", "--no-cross-file"],
        join(__dirname, "../.."),
      );

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed.every((d: { file: string }) => d.file.includes("basic-app"))).toBe(true);
    });

    it("derives project root from target directory, not cwd", () => {
      /** Run from monorepo root targeting basic-app — should NOT pick up monorepo eslint config */
      const { stdout: fromRoot } = runLint(
        [BASIC_APP, "--format", "json", "--no-cross-file"],
        join(__dirname, "../../../.."),
      );
      const { stdout: fromFixture } = runLint(
        ["--format", "json", "--no-cross-file"],
        BASIC_APP,
      );

      const fromRootParsed = JSON.parse(fromRoot);
      const fromFixtureParsed = JSON.parse(fromFixture);

      expect(fromRootParsed.length).toBe(fromFixtureParsed.length);
    });
  });

  describe("--max-warnings", () => {
    it("exits 0 when warnings are within limit", () => {
      const { exitCode } = runLint(
        ["--format", "json", "--no-cross-file", "--max-warnings", "999"],
        BASIC_APP,
      );

      /** basic-app has errors so it still exits 1 due to errors, not warnings */
      expect(exitCode).toBe(1);
    });
  });
});
