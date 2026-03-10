import { describe, expect, it } from "vitest";
import { GraphCache, buildLayoutGraph, type Diagnostic } from "../src";
import { buildGraph as buildSolidGraph } from "./solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "./css/test-utils";

function fakeDiag(file: string, line: number, rule = "test-rule"): Diagnostic {
  return {
    file,
    rule,
    messageId: "test",
    message: `test diagnostic at line ${line}`,
    severity: "warn",
    loc: {
      start: { line, column: 0 },
      end: { line, column: 10 },
    },
  };
}

function createSolidGraph(filePath: string, marker: string) {
  return buildSolidGraph(
    `
      import "./layout.css";

      export function App() {
        return <div class="row">${marker}</div>;
      }
    `,
    filePath,
  );
}

function createCSSGraph(content: string) {
  return buildCSSGraphMultiple([
    {
      path: "/project/layout.css",
      content,
    },
  ]);
}

describe("GraphCache", () => {
  it("reuses cached LayoutGraph when solid versions and css generation stay the same", () => {
    const cache = new GraphCache();
    const solidPath = "/project/App.tsx";
    const solid = createSolidGraph(solidPath, "v1");
    const css = createCSSGraph(".row { display: flex; }");

    let solidBuildCalls = 0;
    const solidGraph = cache.getSolidGraph(solidPath, "1", () => {
      solidBuildCalls++;
      return solid;
    });
    expect(solidBuildCalls).toBe(1);
    expect(cache.getSolidGraph(solidPath, "1", () => solidGraph)).toBe(solidGraph);
    expect(solidBuildCalls).toBe(1);

    let cssBuildCalls = 0;
    const cssGraph = cache.getCSSGraph(() => {
      cssBuildCalls++;
      return css;
    });
    expect(cssBuildCalls).toBe(1);
    expect(cache.getCSSGraph(() => cssGraph)).toBe(cssGraph);
    expect(cssBuildCalls).toBe(1);

    let layoutBuildCalls = 0;
    const first = cache.getLayoutGraph(() => {
      layoutBuildCalls++;
      return buildLayoutGraph(cache.getAllSolidGraphs(), cssGraph);
    });
    const second = cache.getLayoutGraph(() => {
      layoutBuildCalls++;
      return buildLayoutGraph(cache.getAllSolidGraphs(), cssGraph);
    });

    expect(layoutBuildCalls).toBe(1);
    expect(second).toBe(first);
    expect(cache.getCachedLayoutGraph()).toBe(first);
  });

  it("rebuilds LayoutGraph when a solid file version changes", () => {
    const cache = new GraphCache();
    const solidPath = "/project/App.tsx";
    const solidV1 = createSolidGraph(solidPath, "v1");
    const solidV2 = createSolidGraph(solidPath, "v2");
    const cssGraph = cache.getCSSGraph(() => createCSSGraph(".row { display: flex; }") );

    cache.getSolidGraph(solidPath, "1", () => solidV1);
    const first = cache.getLayoutGraph(() => buildLayoutGraph(cache.getAllSolidGraphs(), cssGraph));

    cache.getSolidGraph(solidPath, "2", () => solidV2);
    const second = cache.getLayoutGraph(() => buildLayoutGraph(cache.getAllSolidGraphs(), cssGraph));

    expect(second).not.toBe(first);
    expect(cache.getCachedLayoutGraph()).toBe(second);
  });

  it("setSolidGraph pre-populates cache, preventing getSolidGraph rebuilds", () => {
    const cache = new GraphCache();
    const pathA = "/project/A.tsx";
    const pathB = "/project/B.tsx";
    const graphA = createSolidGraph(pathA, "a");
    const graphB = createSolidGraph(pathB, "b");

    cache.setSolidGraph(pathA, "1", graphA);
    cache.setSolidGraph(pathB, "1", graphB);

    expect(cache.hasSolidGraph(pathA, "1")).toBe(true);
    expect(cache.hasSolidGraph(pathB, "1")).toBe(true);

    let buildCalls = 0;
    const buildSpy = () => { buildCalls++; return graphA; };

    const retrieved = cache.getSolidGraph(pathA, "1", buildSpy);
    expect(retrieved).toBe(graphA);
    expect(buildCalls).toBe(0);

    const retrievedB = cache.getSolidGraph(pathB, "1", buildSpy);
    expect(retrievedB).toBe(graphB);
    expect(buildCalls).toBe(0);

    expect(cache.getAllSolidGraphs()).toHaveLength(2);
  });

  it("setSolidGraph graph is usable for cross-file analysis without rebuild", () => {
    const cache = new GraphCache();
    const solidPath = "/project/App.tsx";
    const solidGraph = createSolidGraph(solidPath, "v1");
    const cssGraph = cache.getCSSGraph(() => createCSSGraph(".row { display: flex; }"));

    cache.setSolidGraph(solidPath, "1", solidGraph);

    let solidBuildCalls = 0;
    cache.getSolidGraph(solidPath, "1", () => {
      solidBuildCalls++;
      return solidGraph;
    });
    expect(solidBuildCalls).toBe(0);

    const allGraphs = cache.getAllSolidGraphs();
    expect(allGraphs).toHaveLength(1);
    expect(allGraphs[0]).toBe(solidGraph);

    let layoutBuildCalls = 0;
    cache.getLayoutGraph(() => {
      layoutBuildCalls++;
      return buildLayoutGraph(allGraphs, cssGraph);
    });
    expect(layoutBuildCalls).toBe(1);

    cache.getLayoutGraph(() => {
      layoutBuildCalls++;
      return buildLayoutGraph(allGraphs, cssGraph);
    });
    expect(layoutBuildCalls).toBe(1);
  });

  describe("cross-file diagnostics cache (debounce flow)", () => {
    it("invalidate deletes per-file cache for the changed file", () => {
      const cache = new GraphCache();
      const changedFile = "/project/GoalCard.tsx";
      const otherFile = "/project/CommandQueue.tsx";

      // Simulate initial cross-file results populating the per-file cache
      cache.setCachedCrossFileResults([
        fakeDiag(changedFile, 42, "css-layout-sibling-alignment-outlier"),
        fakeDiag(changedFile, 55, "css-layout-dynamic-slot-no-reserved-space"),
        fakeDiag(otherFile, 10, "css-layout-sibling-alignment-outlier"),
      ]);

      // Verify both files have cached cross-file diagnostics
      expect(cache.getCachedCrossFileDiagnostics(changedFile)).toHaveLength(2);
      expect(cache.getCachedCrossFileDiagnostics(otherFile)).toHaveLength(1);

      // Phase 1: invalidate the changed file (simulates evictFileCache)
      cache.invalidate(changedFile);

      // Changed file's per-file cache is deleted
      expect(cache.getCachedCrossFileDiagnostics(changedFile)).toHaveLength(0);
      // Other file's per-file cache is STILL present (stale but not cleared)
      expect(cache.getCachedCrossFileDiagnostics(otherFile)).toHaveLength(1);
      // Workspace-level results are nulled
      expect(cache.getCachedCrossFileResults()).toBeNull();
    });

    it("BUG: changed file loses cross-file diagnostics after debounce flow", () => {
      const cache = new GraphCache();
      const changedFile = "/project/GoalCard.tsx";
      const otherFile = "/project/CommandQueue.tsx";

      // === Setup: initial cross-file results are cached ===
      cache.setCachedCrossFileResults([
        fakeDiag(changedFile, 42, "css-layout-sibling-alignment-outlier"),
        fakeDiag(otherFile, 10, "css-layout-sibling-alignment-outlier"),
      ]);

      expect(cache.getCachedCrossFileDiagnostics(changedFile)).toHaveLength(1);
      expect(cache.getCachedCrossFileDiagnostics(otherFile)).toHaveLength(1);

      // === Phase 1: evictFileCache(changedFile) ===
      cache.invalidate(changedFile);

      // === Phase 2: publishFileDiagnostics(changedFile, includeCrossFile=false) ===
      // This path calls getCachedCrossFileDiagnostics to merge with single-file.
      // After invalidate, the changed file has NO cached cross-file diagnostics.
      const phase2CrossFile = cache.getCachedCrossFileDiagnostics(changedFile);
      expect(phase2CrossFile).toHaveLength(0); // BUG EVIDENCE: zero cross-file diags sent to editor

      // === Phase 3: rediagnoseAffected rebuilds cross-file results ===
      // The slow path runs, producing fresh results with UPDATED line numbers.
      // (In reality the line shifted from 42 to 43 because user added a line)
      cache.setCachedCrossFileResults([
        fakeDiag(changedFile, 43, "css-layout-sibling-alignment-outlier"), // line shifted!
        fakeDiag(otherFile, 10, "css-layout-sibling-alignment-outlier"),
      ]);

      // After Phase 3, per-file cache IS repopulated for the changed file
      const postPhase3 = cache.getCachedCrossFileDiagnostics(changedFile);
      expect(postPhase3).toHaveLength(1);
      const diag = postPhase3[0];
      expect(diag).toBeDefined();
      expect(diag?.loc.start.line).toBe(43); // correct line number

      // BUT: the editor still shows the Phase 2 publication (0 cross-file diags).
      // The changed file was excluded from rediagnoseAffected, so this fresh
      // cache entry is NEVER sent to the editor. The user sees missing diagnostics.
      // This is the bug: the cache is correct but the editor is never notified.
    });
  });

  it("rebuilds LayoutGraph when css generation is invalidated", () => {
    const cache = new GraphCache();
    const solidPath = "/project/App.tsx";
    cache.getSolidGraph(solidPath, "1", () => createSolidGraph(solidPath, "v1"));

    const cssV1 = cache.getCSSGraph(() => createCSSGraph(".row { display: flex; }") );
    const first = cache.getLayoutGraph(() => buildLayoutGraph(cache.getAllSolidGraphs(), cssV1));

    cache.invalidate("/project/layout.css");
    expect(cache.getCachedLayoutGraph()).toBeNull();

    const cssV2 = cache.getCSSGraph(() => createCSSGraph(".row { display: grid; }") );
    const second = cache.getLayoutGraph(() => buildLayoutGraph(cache.getAllSolidGraphs(), cssV2));

    expect(second).not.toBe(first);
    expect(cache.getCachedLayoutGraph()).toBe(second);
  });
});
