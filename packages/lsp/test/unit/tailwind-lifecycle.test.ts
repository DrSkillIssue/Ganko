import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeTracker {
  readonly currentCompilation: object;
  readonly previousCompilation: object | null;
  invalidateCrossFileResults(): void;
  setCachedCrossFileResults(_allDiagnostics: readonly unknown[]): void;
}

function createTracker(): FakeTracker {
  return {
    currentCompilation: {},
    previousCompilation: null,
    invalidateCrossFileResults() {},
    setCachedCrossFileResults() {},
  };
}

function createBatchableValidator(css: string | null) {
  return {
    has(_className: string) { return css !== null; },
    resolve(_className: string) { return css; },
    preloadBatch(_classNames: readonly string[], _results: readonly (string | null)[]) {},
  };
}

describe("tailwind lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("starts enrichment before the full program build and uses enriched tailwind for the initial tracker", async () => {
    const order: string[] = [];
    const tailwindValidator = {
      has(_className: string) { return true; },
      resolve(_className: string) { return ".flex { display: flex; }"; },
    };
    const batchableValidator = {
      ...tailwindValidator,
      preloadBatch(_classNames: readonly string[], _results: readonly (string | null)[]) {},
    };
    const tracker = createTracker();

    const createProject = vi.fn(() => ({
      async watchProgramReady() {
        order.push("watchProgramReady");
      },
    }));
    const runEnrichment = vi.fn(async () => {
      order.push("runEnrichment");
      return {
        registry: { solidFiles: new Set<string>(), cssFiles: new Set<string>(), loadAllCSSContent: () => [] },
        layout: { root: { path: "/workspace" }, packagePaths: new Set<string>() },
        tailwindValidator,
        batchableValidator,
        externalCustomProperties: undefined,
        tailwindState: { validator: batchableValidator, reResolve: async () => {} },
        evaluator: null,
      };
    });
    const buildEnrichedCompilationTracker = vi.fn(async (deps: { tailwindValidator: unknown }) => {
      order.push("buildTracker");
      expect(deps.tailwindValidator).toBe(tailwindValidator);
      return tracker;
    });

    vi.doMock("@drskillissue/ganko", () => ({
      SolidPlugin: {},
      setActivePolicy() {},
    }));
    vi.doMock("../../src/core/project", () => ({ createProject }));
    vi.doMock("../../src/core/enrichment", () => ({ runEnrichment, buildEnrichedCompilationTracker }));
    vi.doMock("../../src/core/eslint-config", () => ({
      EMPTY_ESLINT_RESULT: { overrides: {}, globalIgnores: [] },
      loadESLintConfig: vi.fn(async () => ({ overrides: {}, globalIgnores: [] })),
      mergeOverrides: vi.fn(() => ({})),
    }));
    vi.doMock("../../src/server/diagnostic-pipeline", () => ({
      runDiagnosticPipelineBatch() {},
      propagateTsDiagnosticsAsync() {},
    }));
    vi.doMock("../../src/core/compilation-diagnostic-producer", () => ({
      createCompilationDiagnosticProducer: () => ({ runAll: () => new Map() }),
    }));
    vi.doMock("../../src/server/session-mutator", () => ({
      SessionMutator: class {
        buildSession() { return { id: 1 }; }
      },
    }));

    const { handleInitialized, createServerState } = await import("../../src/server/handlers/lifecycle");

    const state = createServerState();
    state.rootPath = "/workspace";
    state.rootUri = "file:///workspace";
    state.config.useESLintConfig = false;

    const context = {
      log: { isLevelEnabled: () => false, info() {}, warning() {} },
      graphCache: createTracker(),
      diagManager: { evict() {}, clear() {} },
      docManager: { openPaths: () => [] },
      resolveReady() {},
      resolveContent() { return null; },
      setProject() { return {}; },
      session: null,
      phase: { tag: "initializing" },
    };
    const connection = { console: { log() {} } };

    await handleInitialized({}, state, connection as never, context as never);

    expect(createProject).toHaveBeenCalledOnce();
    expect(runEnrichment).toHaveBeenCalledOnce();
    expect(buildEnrichedCompilationTracker).toHaveBeenCalledOnce();
    expect(order).toEqual(["runEnrichment", "watchProgramReady", "buildTracker"]);
    expect(context.graphCache).toBe(tracker);
  });

  it("refreshes the active tailwind validator and tracker after tailwind entry changes", async () => {
    const oldValidator = createBatchableValidator(null);
    const newValidator = createBatchableValidator(".bg-brand { background: blue; }");
    const rebuiltTracker = createTracker();
    const buildEnrichedCompilationTracker = vi.fn(async (deps: { tailwindValidator: unknown; batchableValidator: unknown }) => {
      expect(deps.tailwindValidator).toBe(newValidator);
      expect(deps.batchableValidator).toBe(newValidator);
      return rebuiltTracker;
    });

    vi.doMock("../../src/core/enrichment", () => ({ buildEnrichedCompilationTracker }));
    vi.doMock("../../src/server/session-mutator", () => ({
      SessionMutator: class {
        buildSession() { return { id: 2 }; }
      },
    }));

    const { createWorkspaceChangeHandler } = await import("../../src/server/workspace-change-handler");

    const phase = {
      tag: "enriched",
      project: {},
      handlerCtx: {},
      registry: {
        addFile() {},
        removeFile() {},
        getCSSContent() { return '@import "tailwindcss";'; },
      },
      layout: { root: { path: "/workspace" }, packagePaths: new Set<string>() },
      tailwindValidator: oldValidator,
      batchableValidator: oldValidator,
      externalCustomProperties: undefined,
      tailwindState: {
        validator: oldValidator,
        async reResolve() {
          this.validator = newValidator;
        },
      },
      evaluator: null,
    };

    const context = {
      phase,
      graphCache: createTracker(),
      log: { isLevelEnabled: () => false, info() {} },
      diagManager: { evict() {}, clear() {} },
      docManager: { openPaths: () => [] },
      resolveContent() { return null; },
      session: null,
    };

    const handler = createWorkspaceChangeHandler();
    await handler.processFileEvents(context as never, [{ path: "/workspace/app.css", kind: "changed" }]);

    expect(buildEnrichedCompilationTracker).toHaveBeenCalledOnce();
    expect(context.phase.tailwindValidator).toBe(newValidator);
    expect(context.phase.batchableValidator).toBe(newValidator);
    expect(context.graphCache).toBe(rebuiltTracker);
  });
});
