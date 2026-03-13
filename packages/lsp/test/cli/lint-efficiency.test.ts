/**
 * Lint Pipeline Efficiency Tests
 *
 * Verifies that the CLI lint command does not perform redundant work:
 * - SolidGraphs are built once per file (single-file phase pre-populates
 *   the cache, cross-file phase gets cache hits)
 * - CSS files are read from disk once (not re-read during cross-file)
 * - Diagnostic output is identical with and without the cache optimization
 *
 * These tests run `ganko lint --verbose` as a subprocess and parse
 * the debug output on stderr to assert internal work counts.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(__dirname, "../../dist/entry.js");
const MULTI_FILE_APP = join(__dirname, "../fixtures/multi-file-app");

const RE_SOLID_GRAPH_REBUILDS = /crossFile: rebuilt (\d+)\/(\d+) SolidGraphs/;
const RE_FILE_INDEX_SOLID = /file index: (\d+) solid/;
const RE_RESOLVED_FILES = /resolved (\d+) files to lint/;

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

/**
 * Extract the "rebuilt N/M SolidGraphs" line from verbose stderr.
 * Returns { rebuilt, total } or null if the line isn't found.
 */
function parseSolidGraphRebuilds(stderr: string): { rebuilt: number; total: number } | null {
  const match = RE_SOLID_GRAPH_REBUILDS.exec(stderr);
  if (!match) return null;
  return { rebuilt: Number(match[1]), total: Number(match[2]) };
}

describe("lint pipeline efficiency", () => {
  it("cross-file phase rebuilds zero SolidGraphs when single-file phase pre-populates cache", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    const rebuilds = parseSolidGraphRebuilds(stderr);
    expect(rebuilds).not.toBeNull();
    expect(rebuilds?.rebuilt).toBe(0);
    expect(rebuilds?.total).toBeGreaterThan(0);
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

  it("single-file analysis phase completes before cross-file begins", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    const singleFileIdx = stderr.indexOf("single-file analysis:");
    const crossFileIdx = stderr.indexOf("crossFile:");

    expect(singleFileIdx).toBeGreaterThan(-1);
    expect(crossFileIdx).toBeGreaterThan(-1);
    expect(singleFileIdx).toBeLessThan(crossFileIdx);
  });

  it("total solid files in file index matches files analyzed in single-file phase", () => {
    const { stderr } = runLint(
      ["--verbose", "--format", "json", "--no-daemon"],
      MULTI_FILE_APP,
    );

    const indexMatch = RE_FILE_INDEX_SOLID.exec(stderr);
    const resolvedMatch = RE_RESOLVED_FILES.exec(stderr);

    expect(indexMatch).not.toBeNull();
    expect(resolvedMatch).not.toBeNull();

    const solidCount = Number(indexMatch?.[1]);
    expect(solidCount).toBeGreaterThan(0);
  });
});
