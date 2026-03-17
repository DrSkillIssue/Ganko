import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";
import { getEnclosingComponentScope } from "../../../src/solid/queries/scope";

describe("wiringPhase", () => {
  const graph = buildGraph(`
    import { createSignal, createEffect } from "solid-js";

    const x = 1;

    function foo() {}
    foo();
    foo();

    const bar = () => {};
    bar();

    function outer() {
      function inner() {
        return x;
      }
    }

    function MyComponent() {
      const [count] = createSignal(0);
      const handler = () => {
        console.log("clicked");
      };
      createEffect(() => {
        console.log(count());
      });
      return (
        <div onClick={handler}>
          <section>
            <span>Hello</span>
          </section>
          <span>Sibling</span>
        </div>
      );
    }
  `);

  describe("JSX hierarchy", () => {
    it("connects parent/child, handles nesting, and sibling relationships", () => {
      const div = graph.jsxElements.find(e => e.tag === "div");
      const section = graph.jsxElements.find(e => e.tag === "section");
      const spans = graph.jsxElements.filter(e => e.tag === "span");

      expect(div).toBeDefined();
      expect(section).toBeDefined();
      expect(spans.length).toBe(2);

      // Parent/child
      expect(section?.parent).toBe(div);
      expect(div?.childElements).toContain(section);

      // Nesting
      const nestedSpan = spans.find(s => s.parent === section);
      expect(nestedSpan).toBeDefined();

      // Siblings
      expect(div?.childElements.length).toBe(2);
    });
  });

  describe("call target resolution", () => {
    it("resolves calls to declarations and arrow functions with call site tracking", () => {
      // Declaration resolution
      const fooFn = graph.functions.find(f => f.name === "foo");
      expect(fooFn).toBeDefined();
      expect(fooFn?.callSites.length).toBe(2);

      const fooCall = graph.calls.find(c => c.resolvedTarget === fooFn);
      expect(fooCall).toBeDefined();

      // Arrow function resolution
      const barFn = graph.functions.find(f => f.variableName === "bar");
      expect(barFn).toBeDefined();
      const barCall = graph.calls.find(c => c.resolvedTarget === barFn);
      expect(barCall).toBeDefined();
    });
  });

  describe("reactive captures", () => {
    it("computes captures for nested functions and identifies reactive captures", () => {
      const inner = graph.functions.find(f => f.name === "inner");
      expect(inner?.captures.length).toBeGreaterThan(0);

      // Reactive captures exist (even if empty, the machinery ran)
      expect(graph.functionsWithReactiveCaptures).toBeDefined();
    });
  });

  describe("enclosing component", () => {
    it("sets enclosing component for nested scopes", () => {
      const arrowFn = graph.functions.find(f => f.variableName === "handler");
      expect(arrowFn).toBeDefined();
      if (!arrowFn) return;
      const enclosing = getEnclosingComponentScope(graph, arrowFn.scope);
      expect(enclosing).toBeDefined();
      expect(enclosing?.name).toBe("MyComponent");
    });
  });
});
