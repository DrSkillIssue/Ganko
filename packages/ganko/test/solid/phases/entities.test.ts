import { describe, it, expect } from "vitest";
import { buildGraph, at } from "../test-utils";
import { 
  getFunctionByNode, 
  getFunctionsByName, 
  getCallsByPrimitive, 
  getCallsByMethodName,
  getJSXElementsByTag,
  getImportsBySource,
  hasImportFrom,
} from "../../../src/solid/queries/get";

describe("entitiesPhase", () => {
  describe("function entities", () => {
    it("creates function entity for function declaration", () => {
      const graph = buildGraph(`
        function foo() {
          return 1;
        }
      `);
      
      expect(graph.functions.length).toBe(1);
      expect(at(graph.functions, 0).name).toBe("foo");
    });

    it("creates function entity for arrow function", () => {
      const graph = buildGraph(`
        const foo = () => 1;
      `);
      
      expect(graph.functions.length).toBe(1);
      expect(at(graph.functions, 0).variableName).toBe("foo");
    });

    it("creates function entity for function expression", () => {
      const graph = buildGraph(`
        const foo = function bar() {
          return 1;
        };
      `);
      
      expect(graph.functions.length).toBe(1);
      expect(at(graph.functions, 0).name).toBe("bar");
      expect(at(graph.functions, 0).variableName).toBe("foo");
    });

    it("detects component functions by name", () => {
      const graph = buildGraph(`
        function MyComponent() {
          return <div>Hello</div>;
        }
      `);
      
      expect(graph.componentFunctions.length).toBe(1);
      expect(at(graph.componentFunctions, 0).name).toBe("MyComponent");
    });

    it("detects JSX return in function", () => {
      const graph = buildGraph(`
        function Component() {
          return <div>Hello</div>;
        }
      `);
      
      expect(at(graph.functions, 0).hasJSXReturn).toBe(true);
    });

    it("indexes functions by node", () => {
      const graph = buildGraph(`
        function foo() {}
      `);
      
      const fn = at(graph.functions, 0);
      const found = getFunctionByNode(graph, fn.node);
      expect(found).toBe(fn);
    });

    it("indexes functions by name", () => {
      const graph = buildGraph(`
        function foo() {}
        function foo() {}
      `);
      
      const fns = getFunctionsByName(graph, "foo");
      expect(fns.length).toBe(2);
    });
  });

  describe("call entities", () => {
    it("creates call entity for function call", () => {
      const graph = buildGraph(`
        foo();
      `);
      
      expect(graph.calls.length).toBe(1);
    });

    it("creates call entity for method call", () => {
      const graph = buildGraph(`
        obj.method();
      `);
      
      expect(graph.calls.length).toBe(1);
    });

    it("creates argument entities for call arguments", () => {
      const graph = buildGraph(`
        foo(1, 2, 3);
      `);
      
      expect(at(graph.calls, 0).arguments.length).toBe(3);
    });

    it("detects Solid primitive calls", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        createSignal(0);
      `);
      
      const signalCalls = getCallsByPrimitive(graph, "createSignal");
      expect(signalCalls.length).toBe(1);
    });

    it("indexes calls by method name", () => {
      const graph = buildGraph(`
        obj.map(x => x);
        arr.map(y => y);
      `);
      
      const mapCalls = getCallsByMethodName(graph, "map");
      expect(mapCalls.length).toBe(2);
    });

    it("indexes calls by node", () => {
      const graph = buildGraph(`
        foo();
      `);
      
      const call = at(graph.calls, 0);
      const found = graph.callsByNode.get(call.node);
      expect(found).toBe(call);
    });
  });

  describe("JSX element entities", () => {
    it("creates JSX element entity for JSX element", () => {
      const graph = buildGraph(`
        const el = <div>Hello</div>;
      `);
      
      expect(graph.jsxElements.length).toBe(1);
      expect(at(graph.jsxElements, 0).tag).toBe("div");
    });

    it("creates JSX element entity for JSX fragment", () => {
      const graph = buildGraph(`
        const el = <>Hello</>;
      `);
      
      expect(graph.jsxElements.length).toBe(1);
      expect(at(graph.jsxElements, 0).tag).toBeNull();
    });

    it("detects DOM elements", () => {
      const graph = buildGraph(`
        const el = <div>Hello</div>;
      `);
      
      expect(at(graph.jsxElements, 0).isDomElement).toBe(true);
    });

    it("detects component elements", () => {
      const graph = buildGraph(`
        const el = <MyComponent />;
      `);
      
      expect(at(graph.jsxElements, 0).isDomElement).toBe(false);
    });

    it("creates attribute entities", () => {
      const graph = buildGraph(`
        const el = <div class="foo" id="bar">Hello</div>;
      `);
      
      expect(at(graph.jsxElements, 0).attributes.length).toBe(2);
    });

    it("creates child entities", () => {
      const graph = buildGraph(`
        const el = <div>Hello {name}</div>;
      `);
      
      expect(at(graph.jsxElements, 0).children.length).toBeGreaterThan(0);
    });

    it("indexes JSX by tag", () => {
      const graph = buildGraph(`
        const el = <div><span/><span/></div>;
      `);
      
      const spans = getJSXElementsByTag(graph, "span");
      expect(spans.length).toBe(2);
    });
  });

  describe("import entities", () => {
    it("creates import entity for import declaration", () => {
      const graph = buildGraph(`
        import { foo } from "module";
      `);
      
      expect(graph.imports.length).toBe(1);
      expect(at(graph.imports, 0).source).toBe("module");
    });

    it("creates specifier entities for named imports", () => {
      const graph = buildGraph(`
        import { foo, bar } from "module";
      `);
      
      expect(at(graph.imports, 0).specifiers.length).toBe(2);
    });

    it("handles default imports", () => {
      const graph = buildGraph(`
        import foo from "module";
      `);
      
      expect(graph.imports.length).toBe(1);
      const defaultSpec = at(graph.imports, 0).specifiers.find(s => s.kind === "default");
      expect(defaultSpec).toBeDefined();
    });

    it("handles namespace imports", () => {
      const graph = buildGraph(`
        import * as mod from "module";
      `);
      
      expect(graph.imports.length).toBe(1);
      const nsSpec = at(graph.imports, 0).specifiers.find(s => s.kind === "namespace");
      expect(nsSpec).toBeDefined();
    });

    it("indexes imports by source", () => {
      const graph = buildGraph(`
        import { foo } from "solid-js";
        import { bar } from "solid-js";
      `);
      
      const solidImports = getImportsBySource(graph, "solid-js");
      expect(solidImports.length).toBe(2);
    });

    it("checks if import exists from source", () => {
      const graph = buildGraph(`
        import { foo } from "solid-js";
      `);
      
      expect(hasImportFrom(graph, "solid-js")).toBe(true);
      expect(hasImportFrom(graph, "react")).toBe(false);
    });
  });

  describe("class entities", () => {
    it("creates class entity for class declaration", () => {
      const graph = buildGraph(`
        class Foo {
          bar() {}
        }
      `);
      
      expect(graph.classes.length).toBe(1);
      expect(at(graph.classes, 0).name).toBe("Foo");
    });

    it("creates class entity for class expression", () => {
      const graph = buildGraph(`
        const Foo = class Bar {};
      `);
      
      expect(graph.classes.length).toBe(1);
      expect(at(graph.classes, 0).name).toBe("Bar");
    });

    it("indexes classes by name", () => {
      const graph = buildGraph(`
        class Foo {}
      `);
      
      const foos = graph.classesByName.get("Foo");
      expect(foos?.length).toBe(1);
    });
  });
});
