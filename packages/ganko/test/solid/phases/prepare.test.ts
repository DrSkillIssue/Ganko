import { describe, it, expect } from "vitest";
import { buildGraph, at } from "../test-utils";
import { getAST } from "../../../src/solid/queries/get";

describe("preparePhase", () => {
  describe("parent links", () => {
    it("validates parent links exist on AST nodes", () => {
      const graph = buildGraph(`const x = 1;`);
      const ast = getAST(graph);
      
      expect(at(ast.body, 0).parent).toBe(ast);
    });

    it("sets parent links on nested nodes", () => {
      const graph = buildGraph(`
        function foo() {
          const x = 1;
        }
      `);
      const ast = getAST(graph);
      const fn = at(ast.body, 0);
      
      expect(fn.parent).toBe(ast);
      if (fn.type === "FunctionDeclaration" && fn.body) {
        expect(fn.body.parent).toBe(fn);
        expect(at(fn.body.body, 0).parent).toBe(fn.body);
      }
    });
  });

  describe("idempotency", () => {
    it("is safe to build graph twice on same code", () => {
      const code = `const x = 1;`;
      const graph1 = buildGraph(code);
      const graph2 = buildGraph(code);
      
      expect(getAST(graph1).body.length).toBe(getAST(graph2).body.length);
    });

    it("produces consistent results on repeated builds", () => {
      const code = `
        function Component() {
          return <div>Hello</div>;
        }
      `;
      
      const graph1 = buildGraph(code);
      const graph2 = buildGraph(code);
      
      expect(graph1.functions.length).toBe(graph2.functions.length);
      expect(graph1.jsxElements.length).toBe(graph2.jsxElements.length);
    });
  });
});
