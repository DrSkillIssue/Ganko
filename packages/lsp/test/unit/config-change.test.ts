import { describe, it, expect } from "vitest";
import { handleConfigurationChange, createServerState } from "../../src/server/handlers/lifecycle";
import type { ConfigurationChangePayload } from "@drskillissue/ganko-shared";

function makePayload(overrides: Record<string, unknown> = {}): ConfigurationChangePayload {
  return {
    settings: {
      solid: {
        trace: "off" as const,
        logLevel: "info" as const,
        rules: {},
        useESLintConfig: true,
        accessibilityPolicy: "wcag-aa" as const,
        exclude: [],
        enableTypeScriptDiagnostics: false,
        ...overrides,
      },
    },
  };
}

describe("handleConfigurationChange", () => {
  it("returns all-false when nothing changed", () => {
    const state = createServerState();
    const result = handleConfigurationChange(makePayload(), state);
    expect(result.rebuildIndex).toBe(false);
    expect(result.reloadEslint).toBe(false);
    expect(result.rediagnose).toBe(false);
  });

  it("returns rediagnose when TS diagnostics toggle changes", () => {
    const state = createServerState();
    state.config.enableTsDiagnostics = false;
    const result = handleConfigurationChange(makePayload({ enableTypeScriptDiagnostics: true }), state);
    expect(result.rediagnose).toBe(true);
    expect(state.config.enableTsDiagnostics).toBe(true);
  });

  it("returns rebuildIndex when exclude changes", () => {
    const state = createServerState();
    state.config.exclude = [];
    const result = handleConfigurationChange(makePayload({ exclude: ["dist/**"] }), state);
    expect(result.rebuildIndex).toBe(true);
  });

  it("returns reloadEslint when useESLintConfig changes", () => {
    const state = createServerState();
    state.config.useESLintConfig = true;
    const result = handleConfigurationChange(makePayload({ useESLintConfig: false }), state);
    expect(result.reloadEslint).toBe(true);
  });

  it("returns reloadEslint when eslintConfigPath changes", () => {
    const state = createServerState();
    state.config.eslintConfigPath = undefined;
    const result = handleConfigurationChange(makePayload({ eslintConfigPath: "./eslint.config.js" }), state);
    expect(result.reloadEslint).toBe(true);
  });

  it("returns multiple flags when multiple things change simultaneously", () => {
    const state = createServerState();
    state.config.exclude = [];
    state.config.useESLintConfig = true;
    state.config.enableTsDiagnostics = false;
    const result = handleConfigurationChange(makePayload({
      exclude: ["dist/**"],
      useESLintConfig: false,
      enableTypeScriptDiagnostics: true,
    }), state);
    expect(result.rebuildIndex).toBe(true);
    expect(result.reloadEslint).toBe(true);
    expect(result.rediagnose).toBe(true);
  });

  it("updates state unconditionally even when no flags are set", () => {
    const state = createServerState();
    const result = handleConfigurationChange(makePayload({
      rules: { "signal-call": "off" as const },
    }), state);
    expect(result.rediagnose).toBe(true);
    expect(state.config.vscodeOverrides).toEqual({ "signal-call": "off" });
  });

  it("returns all-false for null payload", () => {
    const state = createServerState();
    const result = handleConfigurationChange({ settings: {} }, state);
    expect(result.rebuildIndex).toBe(false);
    expect(result.reloadEslint).toBe(false);
    expect(result.rediagnose).toBe(false);
  });

  it("TS toggle ON→OFF sets enableTsDiagnostics to false", () => {
    const state = createServerState();
    state.config.enableTsDiagnostics = true;
    const result = handleConfigurationChange(makePayload({ enableTypeScriptDiagnostics: false }), state);
    expect(result.rediagnose).toBe(true);
    expect(state.config.enableTsDiagnostics).toBe(false);
  });
});
