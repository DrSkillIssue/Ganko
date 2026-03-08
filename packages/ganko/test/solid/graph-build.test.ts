import { describe, it, expect } from "vitest";
import { SolidPlugin } from "../../src";
import { buildGraph } from "./test-utils";

describe("SolidPlugin.build() integration", () => {
  describe("plugin properties", () => {
    it("has solid kind", () => {
      expect(SolidPlugin.kind).toBe("solid");
    });

    it("supports expected extensions", () => {
      expect(SolidPlugin.extensions).toContain(".tsx");
      expect(SolidPlugin.extensions).toContain(".jsx");
      expect(SolidPlugin.extensions).toContain(".ts");
      expect(SolidPlugin.extensions).toContain(".js");
    });
  });

  describe("graph building", () => {
    it("builds graph from TSX source", () => {
      const graph = buildGraph(`
        function App() {
          return <div>Hello</div>;
        }
      `);
      
      expect(graph.kind).toBe("solid");
      expect(graph.functions.length).toBe(1);
      expect(graph.jsxElements.length).toBe(1);
    });

    it("builds complete graph with all phases", () => {
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
      
      expect(graph.functions.length).toBeGreaterThan(0);
      expect(graph.variables.length).toBeGreaterThan(0);
      expect(graph.calls.length).toBeGreaterThan(0);
      expect(graph.jsxElements.length).toBeGreaterThan(0);
      expect(graph.imports.length).toBe(1);
      expect(graph.exports.length).toBe(1);
    });
  });

  describe("reactivity analysis", () => {
    it("detects reactive variables", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
      `);
      
      const countVar = graph.variables.find(v => v.name === "count");
      expect(countVar?.isReactive).toBe(true);
    });
  });
});
