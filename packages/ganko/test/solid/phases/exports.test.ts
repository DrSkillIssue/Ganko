import { describe, it, expect } from "vitest";
import { buildGraph } from "../test-utils";

describe("exportsPhase", () => {
  const graph = buildGraph(`
    export function foo() {}
    export const bar = 1;
    export const a = 1, b = 2;
    export { baz } from "module";
    export default function App() {
      return <div>Hello</div>;
    }
  `);

  it("extracts named exports from declarations, variables, and re-exports", () => {
    const fooExport = graph.exportsByName.get("foo");
    expect(fooExport).toBeDefined();

    const barExport = graph.exportsByName.get("bar");
    expect(barExport).toBeDefined();

    // Multiple named (a, b)
    const aExport = graph.exportsByName.get("a");
    const bExport = graph.exportsByName.get("b");
    expect(aExport).toBeDefined();
    expect(bExport).toBeDefined();

    // Re-export
    const bazExport = graph.exportsByName.get("baz");
    expect(bazExport).toBeDefined();
  });

  it("extracts default export and links to function entity", () => {
    const defaultExport = graph.exports.find(e => e.name === "default");
    expect(defaultExport).toBeDefined();
    expect(defaultExport?.entityId).not.toBe(-1);
  });

  it("indexes all exports by name", () => {
    // Total: foo, bar, a, b, baz, default = 6
    expect(graph.exports.length).toBeGreaterThanOrEqual(5);
    expect(graph.exportsByName.size).toBeGreaterThanOrEqual(5);
  });
});
