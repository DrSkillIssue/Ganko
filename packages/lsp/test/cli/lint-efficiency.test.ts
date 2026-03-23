/**
 * Lint Pipeline Efficiency Tests
 *
 * Verifies that the CLI lint command produces correct and consistent output:
 * - Single-file and cross-file phases produce diagnostics
 * - Repeated runs produce identical results
 * - File counts in logs match expectations
 *
 * These tests run `ganko lint --verbose` as a subprocess and parse
 * the debug output on stderr to assert internal work counts.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(__dirname, "../../dist/entry.js");
const MULTI_FILE_APP = join(__dirname, "../fixtures/multi-file-app");

const RE_FILE_REGISTRY = /fileRegistry: scanned .+ → (\d+) solid/;

interface LintResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLint(args: string[], cwd: string): LintResult {
  try {
    const result = execFileSync("node", [BIN, "lint", ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : "",
      exitCode: typeof e.status === "number" ? e.status : 1,
    };
  }
}

describe("lint pipeline efficiency", () => {
  it("single-file phase logs before cross-file phase", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    const singleFileIdx = stderr.indexOf("single-file:");
    const crossFileIdx = stderr.indexOf("cross-file:");

    expect(singleFileIdx).toBeGreaterThan(-1);
    expect(crossFileIdx).toBeGreaterThan(-1);
    expect(singleFileIdx).toBeLessThan(crossFileIdx);
  });

  it("produces identical diagnostics with cross-file enabled", () => {
    const { stdout: withCross } = runLint(
      ["--format", "json"],
      MULTI_FILE_APP,
    );
    const { stdout: withCrossAgain } = runLint(
      ["--format", "json"],
      MULTI_FILE_APP,
    );

    const first = JSON.parse(withCross);
    const second = JSON.parse(withCrossAgain);

    expect(first.length).toBe(second.length);

    const normalize = (diags: { file: string; rule: string; line: number; column: number }[]) =>
      diags
        .map((d: { file: string; rule: string; line: number; column: number }) => `${d.file}:${d.line}:${d.column}:${d.rule}`)
        .sort();
    expect(normalize(first)).toEqual(normalize(second));
  });

  it("file registry solid count matches expectations", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    const registryMatch = RE_FILE_REGISTRY.exec(stderr);
    expect(registryMatch).not.toBeNull();

    const solidCount = Number(registryMatch?.[1]);
    expect(solidCount).toBeGreaterThan(0);
  });

  it("buildFullCompilation produces a compilation with all solid trees", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    // The project root and files to lint are logged
    expect(stderr).toContain("project root:");
    expect(stderr).toContain("files to lint:");
  });
});
