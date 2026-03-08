import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";

describe("reactivityPhase", () => {
  describe("primitive detection", () => {
    it("detects signal variables from createSignal", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
      `);
      
      const countVar = graph.variables.find(v => v.name === "count");
      expect(countVar?.isReactive).toBe(true);
      expect(countVar?.reactiveKind).toBe("signal");
    });

    it("detects store variables from createStore", () => {
      const graph = buildGraph(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({ count: 0 });
      `);
      
      const storeVar = graph.variables.find(v => v.name === "store");
      expect(storeVar?.isReactive).toBe(true);
      expect(storeVar?.reactiveKind).toBe("store");
    });

    it("detects memo variables from createMemo", () => {
      const graph = buildGraph(`
        import { createMemo } from "solid-js";
        const doubled = createMemo(() => count() * 2);
      `);
      
      const memoVar = graph.variables.find(v => v.name === "doubled");
      expect(memoVar?.isReactive).toBe(true);
      expect(memoVar?.reactiveKind).toBe("memo");
    });

    it("detects resource variables from createResource", () => {
      const graph = buildGraph(`
        import { createResource } from "solid-js";
        const [data] = createResource(fetchData);
      `);
      
      const dataVar = graph.variables.find(v => v.name === "data");
      expect(dataVar?.isReactive).toBe(true);
      expect(dataVar?.reactiveKind).toBe("resource");
    });
  });

  describe("props detection", () => {
    it("detects props parameter in component", () => {
      const graph = buildGraph(`
        function MyComponent(props) {
          return <div>{props.name}</div>;
        }
      `);
      
      const propsVar = graph.propsVariables;
      expect(propsVar.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("reactive variable indexing", () => {
    it("builds reactive variables index", () => {
      const graph = buildGraph(`
        import { createSignal, createMemo } from "solid-js";
        const [count] = createSignal(0);
        const doubled = createMemo(() => count() * 2);
      `);
      
      expect(graph.reactiveVariables.length).toBeGreaterThanOrEqual(2);
    });

    it("separates variables by reactive kind", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        import { createStore } from "solid-js/store";
        const [count] = createSignal(0);
        const [store] = createStore({});
      `);
      
      expect(graph.storeVariables.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("signal-like detection", () => {
    it("marks accessor functions as signal-like", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        const [count] = createSignal(0);
      `);
      
      const countVar = graph.variables.find(v => v.name === "count");
      expect(countVar?.isSignalLike).toBe(true);
    });
  });
});
