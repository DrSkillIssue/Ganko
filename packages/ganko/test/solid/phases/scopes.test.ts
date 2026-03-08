import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";
import { getVariablesByName, getVariableByNameInScope } from "../../../src/solid/queries";

describe("scopesPhase", () => {
  describe("scope creation", () => {
    it("creates scope entities from ESLint scopes", () => {
      const graph = buildGraph(`const x = 1;`);
      
      expect(graph.scopes.length).toBeGreaterThan(0);
      expect(graph.firstScope).not.toBeNull();
    });

    it("creates program scope for module", () => {
      const graph = buildGraph(`export const x = 1;`);
      
      const programScope = graph.scopes.find(s => s.kind === "program");
      expect(programScope).toBeDefined();
      expect(programScope?.isModuleScope).toBe(true);
    });

    it("creates function scope for function declarations", () => {
      const graph = buildGraph(`
        function foo() {
          const x = 1;
        }
      `);
      
      const fnScope = graph.scopes.find(s => s.kind === "function");
      expect(fnScope).toBeDefined();
    });

    it("creates block scope for block statements", () => {
      const graph = buildGraph(`
        function foo() {
          if (true) {
            const x = 1;
          }
        }
      `);
      
      const blockScope = graph.scopes.find(s => s.kind === "block");
      expect(blockScope).toBeDefined();
    });
  });

  describe("variable creation", () => {
    it("creates variable entities from ESLint variables", () => {
      const graph = buildGraph(`const x = 1;`);
      
      expect(graph.variables.length).toBeGreaterThan(0);
      const xVar = graph.variables.find(v => v.name === "x");
      expect(xVar).toBeDefined();
    });

    it("creates variables for function parameters", () => {
      const graph = buildGraph(`
        function foo(a, b) {
          return a + b;
        }
      `);
      
      const aVar = graph.variables.find(v => v.name === "a");
      const bVar = graph.variables.find(v => v.name === "b");
      expect(aVar).toBeDefined();
      expect(bVar).toBeDefined();
    });

    it("creates variables for destructured bindings", () => {
      const graph = buildGraph(`
        const { x, y } = obj;
      `);
      
      const xVar = graph.variables.find(v => v.name === "x");
      const yVar = graph.variables.find(v => v.name === "y");
      expect(xVar).toBeDefined();
      expect(yVar).toBeDefined();
    });

    it("indexes variables by name", () => {
      const graph = buildGraph(`
        const x = 1;
        function foo() {
          const x = 2;
        }
      `);
      
      const xVars = getVariablesByName(graph, "x");
      expect(xVars.length).toBe(2);
    });
  });

  describe("scope relationships", () => {
    it("builds parent/child relationships", () => {
      const graph = buildGraph(`
        function outer() {
          function inner() {
            const x = 1;
          }
        }
      `);
      
      const fnScopes = graph.scopes.filter(s => s.kind === "function");
      expect(fnScopes.length).toBe(2);
      
      const innerScope = fnScopes.find(s => s.parent?.kind === "function");
      expect(innerScope).toBeDefined();
      expect(innerScope?.parent).toBeDefined();
    });

    it("adds children to parent scope", () => {
      const graph = buildGraph(`
        function foo() {
          if (true) {
            const x = 1;
          }
        }
      `);
      
      const fnScope = graph.scopes.find(s => s.kind === "function");
      expect(fnScope?.children.length).toBeGreaterThan(0);
    });
  });

  describe("scope chains", () => {
    it("builds scope chain for nested scopes", () => {
      const graph = buildGraph(`
        function outer() {
          function inner() {
            const x = 1;
          }
        }
      `);
      
      const innerFnScope = graph.scopes.find(
        s => s.kind === "function" && s.parent?.kind === "function"
      );
      
      expect(innerFnScope?._scopeChain).toBeDefined();
      expect(innerFnScope?._scopeChain?.length).toBeGreaterThanOrEqual(2);
    });

    it("scope chain includes all ancestors", () => {
      const graph = buildGraph(`
        function outer() {
          function inner() {
            if (true) {
              const x = 1;
            }
          }
        }
      `);
      
      const blockScope = graph.scopes.find(s => s.kind === "block");
      const chain = blockScope?._scopeChain;
      
      expect(chain).toBeDefined();
      if (chain) {
        expect(chain[0]).toBe(blockScope);
        expect(chain.some(s => s.kind === "program")).toBe(true);
      }
    });
  });

  describe("variable lookup", () => {
    it("finds variable in current scope", () => {
      const graph = buildGraph(`
        function foo() {
          const x = 1;
        }
      `);
      
      const fnScope = graph.scopes.find(s => s.kind === "function");
      if (fnScope) {
        const xVar = getVariableByNameInScope(graph, "x", fnScope);
        expect(xVar).toBeDefined();
        expect(xVar?.name).toBe("x");
      }
    });

    it("finds variable in parent scope", () => {
      const graph = buildGraph(`
        const x = 1;
        function foo() {
          return x;
        }
      `);
      
      const fnScope = graph.scopes.find(s => s.kind === "function");
      if (fnScope) {
        const xVar = getVariableByNameInScope(graph, "x", fnScope);
        expect(xVar).toBeDefined();
        expect(xVar?.name).toBe("x");
      }
    });

    it("returns null for undefined variable", () => {
      const graph = buildGraph(`
        function foo() {
          const x = 1;
        }
      `);
      
      const fnScope = graph.scopes.find(s => s.kind === "function");
      if (fnScope) {
        const missing = getVariableByNameInScope(graph, "notDefined", fnScope);
        expect(missing).toBeNull();
      }
    });
  });
});
