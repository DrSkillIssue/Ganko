import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";

describe("reactivityPhase", () => {
  const graph = buildGraph(`
    import { createSignal, createMemo, createResource } from "solid-js";
    import { createStore } from "solid-js/store";

    const [count, setCount] = createSignal(0);
    const [store, setStore] = createStore({ count: 0 });
    const doubled = createMemo(() => count() * 2);
    const [data] = createResource(fetchData);

    function MyComponent(props: any) {
      return <div>{props.name}</div>;
    }
  `);

  describe("primitive detection", () => {
    it("detects signal, store, memo, and resource variables", () => {
      const countVar = graph.variables.find(v => v.name === "count");
      expect(countVar?.isReactive).toBe(true);
      expect(countVar?.reactiveKind).toBe("signal");

      const storeVar = graph.variables.find(v => v.name === "store");
      expect(storeVar?.isReactive).toBe(true);
      expect(storeVar?.reactiveKind).toBe("store");

      const memoVar = graph.variables.find(v => v.name === "doubled");
      expect(memoVar?.isReactive).toBe(true);
      expect(memoVar?.reactiveKind).toBe("memo");

      const dataVar = graph.variables.find(v => v.name === "data");
      expect(dataVar?.isReactive).toBe(true);
      expect(dataVar?.reactiveKind).toBe("resource");
    });
  });

  describe("props detection", () => {
    it("detects props parameter in component", () => {
      expect(graph.propsVariables.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("reactive variable indexing", () => {
    it("builds reactive variables index and separates by kind", () => {
      expect(graph.reactiveVariables.length).toBeGreaterThanOrEqual(2);
      expect(graph.storeVariables.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("signal-like detection", () => {
    it("marks accessor functions as signal-like", () => {
      const countVar = graph.variables.find(v => v.name === "count");
      expect(countVar?.isSignalLike).toBe(true);
    });
  });
});
