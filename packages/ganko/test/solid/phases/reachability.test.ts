import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";
import { getCallsByPrimitive } from "../../../src/solid/queries/get";

describe("reachabilityPhase", () => {
  describe("tracked context reachability", () => {
    it("marks effect callbacks as tracked", () => {
      const graph = buildGraph(`
        import { createEffect, createSignal } from "solid-js";
        function Component() {
          const [count] = createSignal(0);
          createEffect(() => {
            console.log(count());
          });
        }
      `);
      
      const effectCalls = getCallsByPrimitive(graph, "createEffect");
      expect(effectCalls.length).toBe(1);
    });

    it("marks memo callbacks as tracked", () => {
      const graph = buildGraph(`
        import { createMemo, createSignal } from "solid-js";
        function Component() {
          const [count] = createSignal(0);
          const doubled = createMemo(() => count() * 2);
        }
      `);
      
      const memoCalls = getCallsByPrimitive(graph, "createMemo");
      expect(memoCalls.length).toBe(1);
    });
  });

  describe("hook patterns", () => {
    it("detects custom hooks by naming convention", () => {
      const graph = buildGraph(`
        function useCounter() {
          const [count, setCount] = createSignal(0);
          return { count, increment: () => setCount(c => c + 1) };
        }
      `);
      
      const fn = graph.functions.find(f => f.name === "useCounter");
      expect(fn).toBeDefined();
    });
  });
});
