/**
 * ESLint Config Reader Tests
 *
 * Tests for loading ESLint flat config files and extracting ganko
 * rule overrides (filtered against manifest defaults), global ignores,
 * and the VS Code priority merge.
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { loadESLintConfig, mergeOverrides, EMPTY_ESLINT_RESULT } from "../../src/core/eslint-config";

const FIXTURES_DIR = join(__dirname, "../fixtures/eslint-configs");

describe("loadESLintConfig", () => {
  describe("flat array config", () => {
    it("extracts solid/ rules that differ from manifest defaults", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      expect(result.overrides).toHaveProperty("signal-call");
      expect(result.overrides).toHaveProperty("no-banner-comments");
      expect(result.overrides).toHaveProperty("derived-signal");
    });

    it("excludes non-solid rules", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      expect(result.overrides).not.toHaveProperty("no-console");
    });

    it("applies later config objects over earlier ones", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      /** flat-array.mjs: first config sets signal-call to "error", second overrides to "warn" */
      expect(result.overrides["signal-call"]).toBe("warn");
    });

    it("preserves rules not overridden by later configs", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      expect(result.overrides["no-banner-comments"]).toBe("off");
      expect(result.overrides["derived-signal"]).toBe("warn");
    });

    it("returns empty globalIgnores when config has none", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      expect(result.globalIgnores).toHaveLength(0);
    });
  });

  describe("numeric severity", () => {
    it("filters out numeric severity matching manifest default", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "numeric-severity.mjs");

      /** signal-call: 2 → "error" matches default "error" → filtered */
      expect(result.overrides).not.toHaveProperty("signal-call");
    });

    it("maps 0 to off when it differs from default", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "numeric-severity.mjs");

      expect(result.overrides["no-banner-comments"]).toBe("off");
    });

    it("handles array format [severity, options]", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "numeric-severity.mjs");

      /** [1, { allowInline: true }] → "warn" ≠ default "error" → kept */
      expect(result.overrides["derived-signal"]).toBe("warn");
    });
  });

  describe("single object config", () => {
    it("filters out rules matching manifest default severity", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "single-object.mjs");

      /** signal-call: "error" matches default "error" → filtered */
      expect(result.overrides).not.toHaveProperty("signal-call");
    });

    it("keeps rules differing from manifest default", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "single-object.mjs");

      expect(result.overrides["derived-signal"]).toBe("off");
    });

    it("excludes non-solid rules from single object", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "single-object.mjs");

      expect(result.overrides).not.toHaveProperty("no-unused-vars");
    });
  });

  describe("no solid rules", () => {
    it("returns empty overrides when config has no solid/ rules", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "no-solid-rules.mjs");

      expect(Object.keys(result.overrides)).toHaveLength(0);
    });
  });

  describe("empty config", () => {
    it("returns empty result for empty config array", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "empty.mjs");

      expect(Object.keys(result.overrides)).toHaveLength(0);
      expect(result.globalIgnores).toHaveLength(0);
    });
  });

  describe("missing config", () => {
    it("returns EMPTY_ESLINT_RESULT when explicit path does not exist", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "nonexistent.mjs");

      expect(result).toBe(EMPTY_ESLINT_RESULT);
    });

    it("returns EMPTY_ESLINT_RESULT when no config found in directory", async () => {
      const result = await loadESLintConfig(join(FIXTURES_DIR, "nonexistent-dir"));

      expect(result).toBe(EMPTY_ESLINT_RESULT);
    });
  });

  describe("default severity filtering", () => {
    it("filters out all rules matching their manifest default severity", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "recommended-spread.mjs");

      /** signal-call "error" and no-banner-comments "error" match defaults → filtered */
      expect(result.overrides).not.toHaveProperty("signal-call");
      expect(result.overrides).not.toHaveProperty("no-banner-comments");
    });

    it("keeps rules whose final severity differs from manifest default", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "recommended-spread.mjs");

      /** missing-jsdoc-comments "off" ≠ default "error" → kept */
      expect(result.overrides["missing-jsdoc-comments"]).toBe("off");
    });

    it("keeps recommended rules that set non-default severity", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "recommended-spread.mjs");

      /** derived-signal "warn" ≠ default "error" → kept */
      expect(result.overrides["derived-signal"]).toBe("warn");
    });

    it("produces exactly 2 overrides from a config with 2 non-default rules", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "recommended-spread.mjs");

      expect(Object.keys(result.overrides)).toHaveLength(2);
    });
  });

  describe("global ignores", () => {
    it("extracts global ignore patterns from ignores-only config objects", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "global-ignores.mjs");

      expect(result.globalIgnores).toEqual(["backend/**", "scripts/**"]);
    });

    it("extracts overrides alongside global ignores", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "global-ignores.mjs");

      expect(result.overrides["signal-call"]).toBe("warn");
    });

    it("does not treat scoped ignores (with files key) as global", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "scoped-ignores.mjs");

      expect(result.globalIgnores).toHaveLength(0);
    });

    it("still extracts overrides from scoped-ignores config", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "scoped-ignores.mjs");

      expect(result.overrides["signal-call"]).toBe("warn");
    });

    it("does not treat ignores with languageOptions as global (regression: passthrough keys)", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "global-ignores-with-language-options.mjs");

      /** The ignores entry has languageOptions — per ESLint semantics it is NOT global. */
      expect(result.globalIgnores).toHaveLength(0);
      expect(result.overrides["signal-call"]).toBe("warn");
    });
  });

  describe("non-standard rule values (regression: strict schema)", () => {
    it("extracts ganko overrides even when other rules have boolean values", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "boolean-rule-value.mjs");

      /** A boolean rule value from another plugin must not cause the entire config to be rejected. */
      expect(result.overrides["signal-call"]).toBe("warn");
    });
  });

  describe("relative imports (regression: importFresh must preserve directory)", () => {
    it("loads a config that uses a relative import to a sibling module", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "relative-import.mjs");

      /** If importFresh copies the file to tmpdir(), relative import fails
       * and EMPTY_ESLINT_RESULT is returned — both overrides would be missing. */
      expect(result.overrides["signal-call"]).toBe("warn");
      expect(result.overrides["no-banner-comments"]).toBe("off");
    });

    it("does not leave temporary files in the fixtures directory", async () => {
      await loadESLintConfig(FIXTURES_DIR, "relative-import.mjs");

      const { readdirSync } = await import("node:fs");
      const files = readdirSync(FIXTURES_DIR);
      const tempFiles = files.filter((f) => f.startsWith(".ganko-eslint-"));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe("CommonJS config (regression: importFresh must preserve .cjs extension)", () => {
    it("loads a .cjs config and extracts overrides", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "cjs-config.cjs");

      /** If importFresh renames .cjs to .mjs, the CJS module.exports syntax
       * is interpreted as ESM, causing a parse error and EMPTY_ESLINT_RESULT. */
      expect(result.overrides["signal-call"]).toBe("warn");
      expect(result.overrides["no-banner-comments"]).toBe("off");
    });
  });

  describe("function export (regression: Zod rejects non-object/array exports)", () => {
    it("returns EMPTY_ESLINT_RESULT for a config that exports a function", async () => {
      const result = await loadESLintConfig(FIXTURES_DIR, "function-export.mjs");

      /** A function export is not a valid ESLint flat config. Zod validation
       * must reject it gracefully rather than crashing. */
      expect(result).toBe(EMPTY_ESLINT_RESULT);
    });
  });

  describe("config reload (regression: importFresh cache-busting)", () => {
    it("returns fresh results when the same config is loaded twice", async () => {
      const first = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");
      const second = await loadESLintConfig(FIXTURES_DIR, "flat-array.mjs");

      /** Both calls must return equivalent results — importFresh must bypass
       * the module cache on each call. */
      expect(second.overrides["signal-call"]).toBe(first.overrides["signal-call"]);
      expect(Object.keys(second.overrides)).toEqual(Object.keys(first.overrides));
    });
  });
});

describe("mergeOverrides", () => {
  it("returns vscode overrides when eslint overrides are empty", () => {
    const vscode = { "signal-call": "error" as const };
    const result = mergeOverrides({}, vscode);

    expect(result).toBe(vscode);
  });

  it("returns eslint overrides when vscode overrides are empty", () => {
    const eslint = { "signal-call": "warn" as const };
    const result = mergeOverrides(eslint, {});

    expect(result).toBe(eslint);
  });

  it("vscode overrides take priority over eslint overrides", () => {
    const eslint = {
      "signal-call": "error" as const,
      "derived-signal": "warn" as const,
    };
    const vscode = {
      "signal-call": "off" as const,
    };

    const result = mergeOverrides(eslint, vscode);

    expect(result["signal-call"]).toBe("off");
    expect(result["derived-signal"]).toBe("warn");
  });

  it("includes rules from both sources", () => {
    const eslint = { "signal-call": "error" as const };
    const vscode = { "derived-signal": "warn" as const };

    const result = mergeOverrides(eslint, vscode);

    expect(result["signal-call"]).toBe("error");
    expect(result["derived-signal"]).toBe("warn");
  });

  it("returns empty object when both are empty", () => {
    const result = mergeOverrides({}, {});

    /** Fast path: returns vscodeOverrides directly */
    expect(Object.keys(result)).toHaveLength(0);
  });
});
