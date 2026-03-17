import { describe, it, expect } from "vitest";
import { SolidPlugin } from "../../src";
import { buildGraph } from "./test-utils";

describe("SolidPlugin.build() integration", () => {
  it("has solid kind and supports expected extensions", () => {
    expect(SolidPlugin.kind).toBe("solid");
    expect(SolidPlugin.extensions).toContain(".tsx");
    expect(SolidPlugin.extensions).toContain(".jsx");
    expect(SolidPlugin.extensions).toContain(".ts");
    expect(SolidPlugin.extensions).toContain(".js");
  });

  // Single comprehensive graph covering: graph building, all phases,
  // and reactivity analysis. Replaces 3 buildGraph calls with 1.
  const graph = buildGraph(`
    import { createSignal, createEffect } from "solid-js";

    export function Counter() {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        console.log("Count:", count());
      });

      return (
        <div>
          <span>{count()}</span>
          <button onClick={() => setCount(c => c + 1)}>+</button>
        </div>
      );
    }
  `);

  it("builds complete graph with all phases from TSX source", () => {
    expect(graph.kind).toBe("solid");
    expect(graph.functions.length).toBeGreaterThan(0);
    expect(graph.variables.length).toBeGreaterThan(0);
    expect(graph.calls.length).toBeGreaterThan(0);
    expect(graph.jsxElements.length).toBeGreaterThan(0);
    expect(graph.imports.length).toBe(1);
    expect(graph.exports.length).toBe(1);
  });

  it("detects reactive variables", () => {
    const countVar = graph.variables.find(v => v.name === "count");
    expect(countVar?.isReactive).toBe(true);
  });
});
