import { describe, expect, it } from "vitest";
import { GraphCache, buildLayoutGraph } from "../src";
import { buildGraph as buildSolidGraph } from "./solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "./css/test-utils";

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
