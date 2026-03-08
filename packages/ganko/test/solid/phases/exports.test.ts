import { describe, it, expect } from "vitest";
import { buildGraph, at } from "../test-utils";

describe("exportsPhase", () => {
  describe("named exports", () => {
    it("extracts named export from declaration", () => {
      const graph = buildGraph(`
        export function foo() {}
      `);
      
      expect(graph.exports.length).toBe(1);
      expect(at(graph.exports, 0).name).toBe("foo");
    });

    it("extracts named export from variable", () => {
      const graph = buildGraph(`
        export const bar = 1;
      `);
      
      expect(graph.exports.length).toBe(1);
      expect(at(graph.exports, 0).name).toBe("bar");
    });

    it("extracts multiple named exports", () => {
      const graph = buildGraph(`
        export const a = 1, b = 2;
      `);
      
      expect(graph.exports.length).toBe(2);
    });

    it("extracts re-exports", () => {
      const graph = buildGraph(`
        export { foo } from "module";
      `);
      
      expect(graph.exports.length).toBe(1);
    });
  });

  describe("default exports", () => {
    it("extracts default export function", () => {
      const graph = buildGraph(`
        export default function App() {}
      `);
      
      const defaultExport = graph.exports.find(e => e.name === "default");
      expect(defaultExport).toBeDefined();
    });

    it("extracts default export expression", () => {
      const graph = buildGraph(`
        const App = () => <div/>;
        export default App;
      `);
      
      const defaultExport = graph.exports.find(e => e.name === "default");
      expect(defaultExport).toBeDefined();
    });
  });

  describe("export entity linking", () => {
    it("links export to function entity", () => {
      const graph = buildGraph(`
        export function MyComponent() {
          return <div>Hello</div>;
        }
      `);
      
      const exp = at(graph.exports, 0);
      expect(exp.entityId).not.toBe(-1);
    });

    it("indexes exports by name", () => {
      const graph = buildGraph(`
        export function foo() {}
        export const bar = 1;
      `);
      
      const fooExport = graph.exportsByName.get("foo");
      const barExport = graph.exportsByName.get("bar");
      expect(fooExport).toBeDefined();
      expect(barExport).toBeDefined();
    });
  });
});
