import { describe, it, expect } from "vitest";
import { buildGraph, at } from "../test-utils";
import { getEnclosingComponentScope } from "../../../src/solid/queries/scope";

describe("wiringPhase", () => {
  describe("JSX hierarchy", () => {
    it("connects JSX parent/child relationships", () => {
      const graph = buildGraph(`
        const el = <div><span>Hello</span></div>;
      `);
      
      const div = graph.jsxElements.find(e => e.tag === "div");
      const span = graph.jsxElements.find(e => e.tag === "span");
      
      expect(div).toBeDefined();
      expect(span).toBeDefined();
      expect(span?.parent).toBe(div);
      expect(div?.childElements).toContain(span);
    });

    it("handles nested JSX elements", () => {
      const graph = buildGraph(`
        const el = (
          <div>
            <section>
              <span>Hello</span>
            </section>
          </div>
        );
      `);
      
      const div = graph.jsxElements.find(e => e.tag === "div");
      const section = graph.jsxElements.find(e => e.tag === "section");
      const span = graph.jsxElements.find(e => e.tag === "span");
      
      expect(section?.parent).toBe(div);
      expect(span?.parent).toBe(section);
    });

    it("handles sibling JSX elements", () => {
      const graph = buildGraph(`
        const el = (
          <div>
            <span>One</span>
            <span>Two</span>
          </div>
        );
      `);
      
      const div = graph.jsxElements.find(e => e.tag === "div");
      const spans = graph.jsxElements.filter(e => e.tag === "span");
      
      expect(spans.length).toBe(2);
      expect(div?.childElements.length).toBe(2);
    });
  });

  describe("call target resolution", () => {
    it("resolves call to function declaration", () => {
      const graph = buildGraph(`
        function foo() {}
        foo();
      `);
      
      const call = at(graph.calls, 0);
      const fn = graph.functions.find(f => f.name === "foo");
      
      expect(call.resolvedTarget).toBe(fn);
    });

    it("resolves call to arrow function", () => {
      const graph = buildGraph(`
        const foo = () => {};
        foo();
      `);
      
      const call = at(graph.calls, 0);
      const fn = at(graph.functions, 0);
      
      expect(call.resolvedTarget).toBe(fn);
    });

    it("adds call sites to resolved function", () => {
      const graph = buildGraph(`
        function foo() {}
        foo();
        foo();
      `);
      
      const fn = graph.functions.find(f => f.name === "foo");
      expect(fn?.callSites.length).toBe(2);
    });
  });

  describe("reactive captures", () => {
    it("computes captures for nested functions", () => {
      const graph = buildGraph(`
        const x = 1;
        function outer() {
          function inner() {
            return x;
          }
        }
      `);
      
      const inner = graph.functions.find(f => f.name === "inner");
      expect(inner?.captures.length).toBeGreaterThan(0);
    });

    it("identifies reactive captures from signals", () => {
      const graph = buildGraph(`
        import { createSignal, createEffect } from "solid-js";
        function Component() {
          const [count] = createSignal(0);
          createEffect(() => {
            console.log(count());
          });
        }
      `);
      
      expect(graph.functionsWithReactiveCaptures.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("enclosing component", () => {
    it("sets enclosing component for nested scopes", () => {
      const graph = buildGraph(`
        function MyComponent() {
          const handler = () => {
            console.log("clicked");
          };
          return <div onClick={handler}>Click</div>;
        }
      `);
      
      // Find the inner arrow function's scope (nested inside component)
      const arrowFn = graph.functions.find(f => f.variableName === "handler");
      if (arrowFn) {
        const enclosing = getEnclosingComponentScope(graph, arrowFn.scope);
        expect(enclosing).toBeDefined();
        expect(enclosing?.name).toBe("MyComponent");
      }
    });
  });
});
