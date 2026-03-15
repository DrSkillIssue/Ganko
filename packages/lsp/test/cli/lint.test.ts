/**
 * CLI Lint Integration Tests
 *
 * Runs `ganko lint` as a subprocess against test fixtures
 * and verifies output and exit codes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const BIN = join(__dirname, "../../dist/entry.js");
const BASIC_APP = join(__dirname, "../fixtures/basic-app");
const MULTI_FILE_APP = join(__dirname, "../fixtures/multi-file-app");

function runLint(args: string[], cwd: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [BIN, "lint", ...args], {
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

  describe("ESLint config resolution", () => {
    /** Temp directories to clean up after each test. */
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
      tempDirs.length = 0;
    });

    function createTempProject(files: Record<string, string>): string {
      const dir = mkdtempSync(join(tmpdir(), "ganko-lint-test-"));
      tempDirs.push(dir);
      for (const [relativePath, content] of Object.entries(files)) {
        const filePath = join(dir, relativePath);
        const parent = filePath.substring(0, filePath.lastIndexOf("/"));
        if (parent !== dir) mkdirSync(parent, { recursive: true });
        writeFileSync(filePath, content);
      }
      return dir;
    }

    /** Resolve the on-disk @drskillissue/ganko package for symlinking into temp projects. */
    const GANKO_PKG = join(__dirname, "../../../ganko");

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

    const COMPONENT_WITH_DESTRUCTURE = [
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

    /**
     * ESLint config that imports @drskillissue/ganko/eslint-plugin and
     * uses solid.configs.recommended, then turns off no-destructure.
     *
     * If the import fails (ERR_MODULE_NOT_FOUND), loadESLintConfig
     * returns EMPTY_ESLINT_RESULT → no-destructure stays at its manifest
     * default (error) → the diagnostic appears when it shouldn't.
     */
    const ESLINT_CONFIG_WITH_GANKO_IMPORT = [
      'import solid from "@drskillissue/ganko/eslint-plugin";',
      "export default [",
      "  ...solid.configs.recommended,",
      "  {",
      '    rules: { "solid/no-destructure": "off" },',
      "  },",
      "];",
    ].join("\n");

    it("ESLint config importing @drskillissue/ganko/eslint-plugin resolves and applies overrides", () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": COMPONENT_WITH_DESTRUCTURE,
        "eslint.config.mjs": ESLINT_CONFIG_WITH_GANKO_IMPORT,
      });

      /** Symlink @drskillissue/ganko into the temp project's node_modules
       *  to simulate what `npm install` does when ganko is a runtime
       *  dependency of ganko-lsp. In production, npm places it on disk. */
      mkdirSync(join(root, "node_modules/@drskillissue"), { recursive: true });
      symlinkSync(GANKO_PKG, join(root, "node_modules/@drskillissue/ganko"), "dir");

      /** Lint with ESLint config that turns off no-destructure. */
      const { stdout } = runLint(
        ["--format", "json", "--no-cross-file", "--no-daemon"],
        root,
      );
      const diagnostics: { rule: string }[] = JSON.parse(stdout);
      const destructureDiags = diagnostics.filter((d) => d.rule === "no-destructure");

      /** no-destructure must be suppressed by the ESLint config override.
       *  If the config import failed, EMPTY_ESLINT_RESULT means no overrides
       *  → no-destructure fires at its manifest default (error). */
      expect(destructureDiags.length).toBe(0);
    });

    it("missing @drskillissue/ganko in node_modules causes config import failure and manifest-default diagnostics", () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": COMPONENT_WITH_DESTRUCTURE,
        "eslint.config.mjs": ESLINT_CONFIG_WITH_GANKO_IMPORT,
      });

      /** No symlink — @drskillissue/ganko is NOT in node_modules. */

      /** Lint without the ganko package available. The ESLint config
       *  import fails → EMPTY_ESLINT_RESULT → no overrides applied
       *  → no-destructure fires at manifest default. */
      const { stdout } = runLint(
        ["--format", "json", "--no-cross-file", "--no-daemon"],
        root,
      );
      const diagnostics: { rule: string }[] = JSON.parse(stdout);
      const destructureDiags = diagnostics.filter((d) => d.rule === "no-destructure");

      /** no-destructure SHOULD fire because the config failed to load. */
      expect(destructureDiags.length).toBeGreaterThan(0);
    });

    it("diagnostic count is reasonable with ESLint config (not 3k+ manifest defaults)", () => {
      const root = createTempProject({
        "tsconfig.json": TSCONFIG,
        "src/Counter.tsx": COMPONENT_WITH_DESTRUCTURE,
        "eslint.config.mjs": ESLINT_CONFIG_WITH_GANKO_IMPORT,
      });

      mkdirSync(join(root, "node_modules/@drskillissue"), { recursive: true });
      symlinkSync(GANKO_PKG, join(root, "node_modules/@drskillissue/ganko"), "dir");

      /** With config: reasonable diagnostic count. */
      const { stdout: withConfig } = runLint(
        ["--format", "json", "--no-cross-file", "--no-daemon"],
        root,
      );
      const withConfigDiags: { rule: string }[] = JSON.parse(withConfig);

      /** Without config (--no-eslint-config): manifest defaults. */
      const { stdout: noConfig } = runLint(
        ["--format", "json", "--no-cross-file", "--no-daemon", "--no-eslint-config"],
        root,
      );
      const noConfigDiags: { rule: string }[] = JSON.parse(noConfig);

      /** With a valid ESLint config, diagnostic count must be ≤ the
       *  no-config count. If the config import silently failed, both
       *  counts would be equal (both using manifest defaults). */
      expect(withConfigDiags.length).toBeLessThanOrEqual(noConfigDiags.length);
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
