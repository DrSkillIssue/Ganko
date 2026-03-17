import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";
import { getVariablesByName, getVariableByNameInScope } from "../../../src/solid/queries";

describe("scopesPhase", () => {
  const graph = buildGraph(`
    export const x = 1;
    const { a, b } = { a: 1, b: 2 };

    function outer(p1, p2) {
      const x = 2;

      function inner() {
        if (true) {
          const y = 3;
        }
      }
    }

    function foo() {
      const z = 1;
      return x;
    }
  `);

  describe("scope creation", () => {
    it("creates scope entities including program, function, and block scopes", () => {
      expect(graph.scopes.length).toBeGreaterThan(0);
      expect(graph.firstScope).not.toBeNull();

      const programScope = graph.scopes.find(s => s.kind === "program");
      expect(programScope).toBeDefined();
      expect(programScope?.isModuleScope).toBe(true);

      const fnScopes = graph.scopes.filter(s => s.kind === "function");
      expect(fnScopes.length).toBeGreaterThanOrEqual(3);

      const blockScope = graph.scopes.find(s => s.kind === "block");
      expect(blockScope).toBeDefined();
    });
  });

  describe("variable creation", () => {
    it("creates variable entities for declarations, parameters, and destructured bindings", () => {
      expect(graph.variables.length).toBeGreaterThan(0);

      // Declaration
      const xVars = getVariablesByName(graph, "x");
      expect(xVars.length).toBe(2);

      // Parameters
      const p1Var = graph.variables.find(v => v.name === "p1");
      const p2Var = graph.variables.find(v => v.name === "p2");
      expect(p1Var).toBeDefined();
      expect(p2Var).toBeDefined();

      // Destructured bindings
      const aVar = graph.variables.find(v => v.name === "a");
      const bVar = graph.variables.find(v => v.name === "b");
      expect(aVar).toBeDefined();
      expect(bVar).toBeDefined();
    });
  });

  describe("scope relationships", () => {
    it("builds parent/child relationships and scope chains", () => {
      // Parent/child: inner function scope's parent is outer function scope
      const fnScopes = graph.scopes.filter(s => s.kind === "function");
      const innerScope = fnScopes.find(s => s.parent?.kind === "function");
      expect(innerScope).toBeDefined();
      expect(innerScope?.parent).toBeDefined();

      // Children: outer function has children (inner function + block)
      const outerScope = innerScope?.parent;
      expect(outerScope?.children.length).toBeGreaterThan(0);

      // Scope chain: block scope chain includes all ancestors up to program
      const blockScope = graph.scopes.find(s => s.kind === "block");
      const chain = blockScope?._scopeChain;
      expect(chain).toBeDefined();
      if (chain) {
        expect(chain[0]).toBe(blockScope);
        expect(chain.some(s => s.kind === "program")).toBe(true);
        expect(chain.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("variable lookup", () => {
    it("finds variables in current scope, parent scope, and returns null for undefined", () => {
      const fooScope = graph.scopes.find(
        s => s.kind === "function" && graph.variables.some(v => v.name === "z" && v.scope === s),
      );
      expect(fooScope).toBeDefined();
      if (!fooScope) return;

      // Current scope
      const zVar = getVariableByNameInScope(graph, "z", fooScope);
      expect(zVar).toBeDefined();
      expect(zVar?.name).toBe("z");

      // Parent scope (x is in program scope)
      const xVar = getVariableByNameInScope(graph, "x", fooScope);
      expect(xVar).toBeDefined();
      expect(xVar?.name).toBe("x");

      // Undefined variable
      const missing = getVariableByNameInScope(graph, "notDefined", fooScope);
      expect(missing).toBeNull();
    });
  });
});
