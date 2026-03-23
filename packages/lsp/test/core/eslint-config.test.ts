/**
 * ESLint Config Extraction Tests
 *
 * Tests extractOverrides and extractGlobalIgnores directly with config objects.
 * No subprocess spawning — pure unit tests of the extraction logic.
 */
import { describe, it, expect } from "vitest";
import { extractOverrides, extractGlobalIgnores, mergeOverrides, EMPTY_ESLINT_RESULT } from "../../src/core/eslint-config";

describe("extractOverrides", () => {
  it("extracts solid/ rules that differ from manifest defaults", () => {
    const overrides = extractOverrides([
      { rules: { "no-console": "error", "solid/signal-call": "error", "solid/no-banner-comments": "off" } },
      { rules: { "solid/derived-signal": "warn", "solid/signal-call": "warn" } },
    ]);

    expect(overrides).toHaveProperty("signal-call");
    expect(overrides).toHaveProperty("no-banner-comments");
    expect(overrides).toHaveProperty("derived-signal");
  });

  it("excludes non-solid rules", () => {
    const overrides = extractOverrides([
      { rules: { "no-console": "error", "solid/signal-call": "warn" } },
    ]);

    expect(overrides).not.toHaveProperty("no-console");
  });

  it("applies later config objects over earlier ones", () => {
    const overrides = extractOverrides([
      { rules: { "solid/signal-call": "error" } },
      { rules: { "solid/signal-call": "warn" } },
    ]);

    expect(overrides["signal-call"]).toBe("warn");
  });

  it("preserves rules not overridden by later configs", () => {
    const overrides = extractOverrides([
      { rules: { "solid/no-banner-comments": "off", "solid/derived-signal": "warn" } },
      { rules: { "solid/signal-call": "warn" } },
    ]);

    expect(overrides["no-banner-comments"]).toBe("off");
    expect(overrides["derived-signal"]).toBe("warn");
  });

  it("filters out numeric severity matching manifest default", () => {
    const overrides = extractOverrides([
      { rules: { "solid/signal-call": 2 } },
    ]);

    expect(overrides).not.toHaveProperty("signal-call");
  });

  it("maps 0 to off when it differs from default", () => {
    const overrides = extractOverrides([
      { rules: { "solid/no-banner-comments": 0 } },
    ]);

    expect(overrides["no-banner-comments"]).toBe("off");
  });

  it("handles array format [severity, options]", () => {
    const overrides = extractOverrides([
      { rules: { "solid/derived-signal": [1, { allowInline: true }] } },
    ]);

    expect(overrides["derived-signal"]).toBe("warn");
  });

  it("filters out all rules matching their manifest default severity", () => {
    const overrides = extractOverrides([
      { plugins: { solid: {} }, files: true, rules: { "solid/signal-call": "error", "solid/no-banner-comments": "error", "solid/derived-signal": "warn" } },
      { rules: { "solid/missing-jsdoc-comments": "off" } },
    ]);

    expect(overrides).not.toHaveProperty("signal-call");
    expect(overrides).not.toHaveProperty("no-banner-comments");
  });

  it("keeps rules whose final severity differs from manifest default", () => {
    const overrides = extractOverrides([
      { rules: { "solid/missing-jsdoc-comments": "off" } },
    ]);

    expect(overrides["missing-jsdoc-comments"]).toBe("off");
  });

  it("returns empty overrides when config has no solid/ rules", () => {
    const overrides = extractOverrides([
      { rules: { "no-console": "error", "react/jsx-no-undef": "warn" } },
    ]);

    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it("returns empty for empty config array", () => {
    const overrides = extractOverrides([]);
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it("returns empty for config without rules", () => {
    const overrides = extractOverrides([{}]);
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it("handles single object config", () => {
    const overrides = extractOverrides([
      { rules: { "solid/signal-call": "error", "solid/derived-signal": "off", "no-unused-vars": "warn" } },
    ]);

    expect(overrides).not.toHaveProperty("signal-call");
    expect(overrides["derived-signal"]).toBe("off");
    expect(overrides).not.toHaveProperty("no-unused-vars");
  });

  it("extracts ganko overrides even when other rules have boolean values", () => {
    const overrides = extractOverrides([
      { rules: { "some-plugin/rule": true, "solid/signal-call": "warn" } },
    ]);

    expect(overrides["signal-call"]).toBe("warn");
  });
});

describe("extractGlobalIgnores", () => {
  it("extracts global ignore patterns from ignores-only config objects", () => {
    const ignores = extractGlobalIgnores([
      { ignores: ["backend/**", "scripts/**"] },
      { rules: { "solid/signal-call": "warn" } },
    ]);

    expect(ignores).toEqual(["backend/**", "scripts/**"]);
  });

  it("returns empty when config has no ignores", () => {
    const ignores = extractGlobalIgnores([
      { rules: { "solid/signal-call": "warn" } },
    ]);

    expect(ignores).toHaveLength(0);
  });

  it("does not treat scoped ignores (with files key) as global", () => {
    const ignores = extractGlobalIgnores([
      { ignores: ["dist/**"], files: true },
    ]);

    expect(ignores).toHaveLength(0);
  });

  it("does not treat ignores with other keys as global", () => {
    const ignores = extractGlobalIgnores([
      { ignores: ["dist/**"], rules: { "solid/signal-call": "warn" } },
    ]);

    expect(ignores).toHaveLength(0);
  });

  it("returns empty for empty config array", () => {
    expect(extractGlobalIgnores([])).toHaveLength(0);
  });
});

describe("mergeOverrides", () => {
  it("returns vscode overrides when eslint overrides are empty", () => {
    const vscode = { "signal-call": "error" as const };
    expect(mergeOverrides({}, vscode)).toBe(vscode);
  });

  it("returns eslint overrides when vscode overrides are empty", () => {
    const eslint = { "signal-call": "warn" as const };
    expect(mergeOverrides(eslint, {})).toBe(eslint);
  });

  it("vscode overrides take priority over eslint overrides", () => {
    const result = mergeOverrides(
      { "signal-call": "error" as const, "derived-signal": "warn" as const },
      { "signal-call": "off" as const },
    );

    expect(result["signal-call"]).toBe("off");
    expect(result["derived-signal"]).toBe("warn");
  });

  it("includes rules from both sources", () => {
    const result = mergeOverrides(
      { "signal-call": "error" as const },
      { "derived-signal": "warn" as const },
    );

    expect(result["signal-call"]).toBe("error");
    expect(result["derived-signal"]).toBe("warn");
  });

  it("returns empty object when both are empty", () => {
    expect(Object.keys(mergeOverrides({}, {}))).toHaveLength(0);
  });
});

describe("EMPTY_ESLINT_RESULT", () => {
  it("has empty overrides and globalIgnores", () => {
    expect(Object.keys(EMPTY_ESLINT_RESULT.overrides)).toHaveLength(0);
    expect(EMPTY_ESLINT_RESULT.globalIgnores).toHaveLength(0);
  });
});
