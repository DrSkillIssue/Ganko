import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";
import { getCallsByPrimitive } from "../../../src/solid/queries/get";

describe("reachabilityPhase", () => {
  const graph = buildGraph(`
    import { createEffect, createMemo, createSignal } from "solid-js";

    function useCounter() {
      const [count, setCount] = createSignal(0);
      return { count, increment: () => setCount(c => c + 1) };
    }

    function Component() {
      const [count] = createSignal(0);
      createEffect(() => { console.log(count()); });
      const doubled = createMemo(() => count() * 2);
    }
  `);

  it("marks effect and memo callbacks as tracked", () => {
    const effectCalls = getCallsByPrimitive(graph, "createEffect");
    expect(effectCalls.length).toBe(1);

    const memoCalls = getCallsByPrimitive(graph, "createMemo");
    expect(memoCalls.length).toBe(1);
  });

  it("detects custom hooks by naming convention", () => {
    const fn = graph.functions.find(f => f.name === "useCounter");
    expect(fn).toBeDefined();
  });
});
