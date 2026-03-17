import { describe, it, expect } from "vitest";
import ts from "typescript";
import { buildGraph, at } from "../test-utils";
import { getAST } from "../../../src/solid/queries/get";

describe("preparePhase", () => {
  const code = `
    function foo() {
      const x = 1;
    }
  `;
  const graph = buildGraph(code);

  it("sets parent links on AST nodes at all nesting levels", () => {
    const ast = getAST(graph);
    const fn = at(Array.from(ast.statements), 0);

    expect(fn.parent).toBe(ast);
    if (ts.isFunctionDeclaration(fn) && fn.body) {
      expect(fn.body.parent).toBe(fn);
      expect(at(Array.from(fn.body.statements), 0).parent).toBe(fn.body);
    }
  });

  it("produces consistent results on repeated builds", () => {
    const graph2 = buildGraph(code);
    expect(graph.functions.length).toBe(graph2.functions.length);
    expect(getAST(graph).statements.length).toBe(getAST(graph2).statements.length);
  });
});
