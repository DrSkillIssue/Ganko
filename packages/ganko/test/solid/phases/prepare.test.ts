import { describe, it, expect } from "vitest";
import ts from "typescript";
import { buildGraph, at } from "../test-utils";
import { getAST } from "../../../src/solid/queries/get";

describe("preparePhase", () => {
  describe("parent links", () => {
    it("validates parent links exist on AST nodes", () => {
      const graph = buildGraph(`const x = 1;`);
      const ast = getAST(graph);

      expect(at(Array.from(ast.statements), 0).parent).toBe(ast);
    });

    it("sets parent links on nested nodes", () => {
      const graph = buildGraph(`
        function foo() {
          const x = 1;
        }
      `);
      const ast = getAST(graph);
      const fn = at(Array.from(ast.statements), 0);

      expect(fn.parent).toBe(ast);
      if (ts.isFunctionDeclaration(fn) && fn.body) {
        expect(fn.body.parent).toBe(fn);
        expect(at(Array.from(fn.body.statements), 0).parent).toBe(fn.body);
      }
    });
  });

  describe("idempotency", () => {
    it("is safe to build graph twice on same code", () => {
      const code = `const x = 1;`;
      const graph1 = buildGraph(code);
      const graph2 = buildGraph(code);

      expect(getAST(graph1).statements.length).toBe(getAST(graph2).statements.length);
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
