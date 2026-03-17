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
  const graph = buildGraph(`
    import { createSignal } from "solid-js";
    import { foo, bar } from "module-a";
    import baz from "module-b";
    import * as mod from "module-c";
    import { x } from "solid-js";

    function foo() { return 1; }
    function foo() { return 2; }
    const arrow = () => 1;
    const expr = function named() { return 1; };

    function MyComponent() {
      return <div class="foo" id="bar">Hello {name}</div>;
    }

    const frag = <>Hello</>;
    const comp = <MyComponent />;
    const nested = <div><span/><span/></div>;

    createSignal(0);
    foo(1, 2, 3);
    obj.method();
    obj.map(x => x);
    arr.map(y => y);

    class Foo { bar() {} }
    const Baz = class Bar {};
  `);

  describe("function entities", () => {
    it("creates entities for declarations, arrow functions, and function expressions", () => {
      // Declaration (foo appears twice)
      const foos = getFunctionsByName(graph, "foo");
      expect(foos.length).toBe(2);

      // Arrow function
      const arrows = graph.functions.filter(f => f.variableName === "arrow");
      expect(arrows.length).toBe(1);

      // Function expression
      const named = graph.functions.find(f => f.name === "named");
      expect(named).toBeDefined();
      expect(named?.variableName).toBe("expr");
    });

    it("detects component functions and JSX return", () => {
      expect(graph.componentFunctions.length).toBe(1);
      expect(at(graph.componentFunctions, 0).name).toBe("MyComponent");
      expect(at(graph.componentFunctions, 0).hasJSXReturn).toBe(true);
    });

    it("indexes functions by node", () => {
      const fn = graph.functions.find(f => f.name === "foo");
      expect(fn).toBeDefined();
      if (!fn) return;
      const found = getFunctionByNode(graph, fn.node);
      expect(found).toBe(fn);
    });
  });

  describe("call entities", () => {
    it("creates call entities for function calls, method calls, and arguments", () => {
      // Function calls exist
      expect(graph.calls.length).toBeGreaterThan(0);

      // Arguments
      const fooCall = graph.calls.find(c => c.arguments.length === 3);
      expect(fooCall).toBeDefined();

      // Solid primitive
      const signalCalls = getCallsByPrimitive(graph, "createSignal");
      expect(signalCalls.length).toBe(1);

      // Method name index
      const mapCalls = getCallsByMethodName(graph, "map");
      expect(mapCalls.length).toBe(2);

      // Node index
      const anyCall = at(graph.calls, 0);
      const found = graph.callsByNode.get(anyCall.node);
      expect(found).toBe(anyCall);
    });
  });

  describe("JSX element entities", () => {
    it("creates elements for DOM, fragments, components, attributes, children, and tag index", () => {
      // DOM element
      const div = graph.jsxElements.find(e => e.tag === "div" && e.isDomElement);
      expect(div).toBeDefined();
      expect(div?.attributes.length).toBe(2);
      expect(div?.children.length).toBeGreaterThan(0);

      // Fragment
      const frag = graph.jsxElements.find(e => e.tag === null);
      expect(frag).toBeDefined();

      // Component element
      const comp = graph.jsxElements.find(e => e.tag === "MyComponent");
      expect(comp).toBeDefined();
      expect(comp?.isDomElement).toBe(false);

      // Tag index
      const spans = getJSXElementsByTag(graph, "span");
      expect(spans.length).toBe(2);
    });
  });

  describe("import entities", () => {
    it("creates imports with specifiers for named, default, and namespace patterns", () => {
      // Named imports
      const moduleA = getImportsBySource(graph, "module-a");
      expect(moduleA.length).toBe(1);
      expect(at(moduleA, 0).specifiers.length).toBe(2);

      // Default import
      const moduleB = getImportsBySource(graph, "module-b");
      expect(moduleB.length).toBe(1);
      const defaultSpec = at(moduleB, 0).specifiers.find(s => s.kind === "default");
      expect(defaultSpec).toBeDefined();

      // Namespace import
      const moduleC = getImportsBySource(graph, "module-c");
      expect(moduleC.length).toBe(1);
      const nsSpec = at(moduleC, 0).specifiers.find(s => s.kind === "namespace");
      expect(nsSpec).toBeDefined();

      // Multi-source index (solid-js has 2 imports)
      const solidImports = getImportsBySource(graph, "solid-js");
      expect(solidImports.length).toBe(2);

      // hasImportFrom
      expect(hasImportFrom(graph, "solid-js")).toBe(true);
      expect(hasImportFrom(graph, "react")).toBe(false);
    });
  });

  describe("class entities", () => {
    it("creates class entities for declarations and expressions with name index", () => {
      expect(graph.classes.length).toBe(2);

      const foo = graph.classes.find(c => c.name === "Foo");
      expect(foo).toBeDefined();

      const bar = graph.classes.find(c => c.name === "Bar");
      expect(bar).toBeDefined();

      const foos = graph.classesByName.get("Foo");
      expect(foos?.length).toBe(1);
    });
  });
});
