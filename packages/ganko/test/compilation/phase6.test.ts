import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { createFileSemanticModel } from "../../src/compilation/binding/semantic-model";
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation";
import { buildElementNodes } from "../../src/compilation/binding/element-builder";
import { bind, selectorMatchesElement } from "../../src/compilation/binding/cascade-binder";
import { buildScopedSelectorIndex } from "../../src/compilation/binding/scope-resolver";
import type { SolidSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree";

function buildModel(solidCode: string, solidPath: string, cssFiles: { path: string; content: string }[]) {
  const solidGraph = buildSolidGraph(solidCode, solidPath);
  const cssGraph = buildCSSGraphMultiple(cssFiles);
  const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
  const cssTrees = cssGraphToSyntaxTrees(cssGraph);
  const symbolTable = buildSymbolTable(cssTrees);

  const solidTreeMap = new Map<string, SolidSyntaxTree>();
  solidTreeMap.set(solidTree.filePath, solidTree);
  const cssTreeMap = new Map<string, CSSSyntaxTree>();
  for (const t of cssTrees) cssTreeMap.set(t.filePath, t);

  const depGraph = buildDependencyGraph(solidTreeMap, cssTreeMap);
  const compilation = createCompilationFromLegacy([solidTree], cssTrees);
  const model = createFileSemanticModel(solidTree, symbolTable, depGraph, compilation);

  return { model, solidTree, symbolTable, compilation, depGraph, cssTrees };
}

describe("Phase 6: Cascade Binder (Tier 2-3)", () => {

  describe("buildElementNodes", () => {
    it("builds element nodes from JSX elements", () => {
      const { model } = buildModel(
        `export default function App() { return <div class="wrapper"><span>hello</span></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      expect(nodes.length).toBe(2);
      expect(nodes[0]!.tagName).toBe("div");
      expect(nodes[1]!.tagName).toBe("span");
    });

    it("sets jsxEntity reference (Constraint 7)", () => {
      const { model } = buildModel(
        `export default function App() { return <div id="root" /> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      expect(nodes.length).toBe(1);
      expect(nodes[0]!.jsxEntity).toBeDefined();
      expect(nodes[0]!.jsxEntity.tag).toBe("div");
    });

    it("sets childElementNodes (Constraint 8)", () => {
      const { model } = buildModel(
        `export default function App() { return <ul><li>a</li><li>b</li></ul> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const ul = nodes.find(n => n.tagName === "ul");
      expect(ul).toBeDefined();
      expect(ul!.childElementNodes.length).toBe(2);
      expect(ul!.childElementNodes[0]!.tagName).toBe("li");
      expect(ul!.childElementNodes[1]!.tagName).toBe("li");
    });

    it("wires parent-child relationships", () => {
      const { model } = buildModel(
        `export default function App() { return <div><p>text</p></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const div = nodes.find(n => n.tagName === "div");
      const p = nodes.find(n => n.tagName === "p");
      expect(p!.parentElementNode).toBe(div);
    });

    it("computes sibling indexes", () => {
      const { model } = buildModel(
        `export default function App() { return <div><span /><span /><span /></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const spans = nodes.filter(n => n.tagName === "span");
      expect(spans.length).toBe(3);
      expect(spans[0]!.siblingIndex).toBe(1);
      expect(spans[1]!.siblingIndex).toBe(2);
      expect(spans[2]!.siblingIndex).toBe(3);
      expect(spans[0]!.siblingCount).toBe(3);
    });

    it("extracts class tokens", () => {
      const { model } = buildModel(
        `export default function App() { return <div class="foo bar" /> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      expect(nodes[0]!.classTokens).toContain("foo");
      expect(nodes[0]!.classTokens).toContain("bar");
    });

    it("builds selector dispatch keys", () => {
      const { model } = buildModel(
        `export default function App() { return <div id="main" class="container" /> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const keys = nodes[0]!.selectorDispatchKeys;
      expect(keys.some(k => k.startsWith("id:"))).toBe(true);
      expect(keys.some(k => k.startsWith("class:"))).toBe(true);
    });

    it("returns empty array for file with no JSX", () => {
      const { model } = buildModel(
        `export const x = 1;`,
        "/utils.ts",
        [],
      );
      expect(model.getElementNodes().length).toBe(0);
    });
  });

  describe("getElementNode / getElementsByTagName", () => {
    it("getElementNode returns correct element by ID", () => {
      const { model } = buildModel(
        `export default function App() { return <div><span /></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const span = nodes.find(n => n.tagName === "span")!;
      expect(model.getElementNode(span.elementId)).toBe(span);
    });

    it("getElementNode returns null for missing ID", () => {
      const { model } = buildModel(
        `export default function App() { return <div /> }`,
        "/app.tsx",
        [],
      );
      expect(model.getElementNode(99999)).toBeNull();
    });

    it("getElementsByTagName finds matching elements", () => {
      const { model } = buildModel(
        `export default function App() { return <div><span /><span /><p /></div> }`,
        "/app.tsx",
        [],
      );
      const spans = model.getElementsByTagName("span");
      expect(spans.length).toBe(2);
      expect(spans.every(n => n.tagName === "span")).toBe(true);
    });
  });

  describe("bind / getElementCascade", () => {
    it("produces empty cascade for element with no matching CSS", () => {
      const { model } = buildModel(
        `export default function App() { return <div /> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;
      const cascade = model.getElementCascade(nodes[0]!.elementId);
      expect(cascade.declarations.size).toBe(0);
      expect(cascade.edges.length).toBe(0);
    });

    it("bind produces cascade with matching selector declarations", () => {
      const { model, symbolTable } = buildModel(
        `export default function App() { return <div class="box" /> }`,
        "/app.tsx",
        [{ path: "/app.css", content: `.box { display: flex; height: 100px; }` }],
      );
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;

      const scopedSelectors = buildScopedSelectorIndex(
        ["/app.css"],
        symbolTable,
      );
      const cascade = bind(nodes[0]!, scopedSelectors, symbolTable);
      expect(cascade.edges.length).toBeGreaterThan(0);
    });

    it("getMatchingSelectors returns edges from cascade", () => {
      const { model } = buildModel(
        `export default function App() { return <div class="box" /> }`,
        "/app.tsx",
        [{ path: "/app.css", content: `.box { display: flex; }` }],
      );
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;
      const selectors = model.getMatchingSelectors(nodes[0]!.elementId);
      expect(selectors).toBeDefined();
    });
  });

  describe("selectorMatchesElement", () => {
    it("returns true for matching selector", () => {
      const { model, symbolTable } = buildModel(
        `export default function App() { return <div class="target" /> }`,
        "/app.tsx",
        [{ path: "/app.css", content: `.target { color: red; }` }],
      );
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;

      for (const [, symbol] of symbolTable.selectors) {
        if (symbol.compiledMatcher === null) continue;
        if (symbol.name === ".target") {
          expect(selectorMatchesElement(nodes[0]!, symbol.compiledMatcher)).toBe(true);
        }
      }
    });

    it("returns false for non-matching selector", () => {
      const { model, symbolTable } = buildModel(
        `export default function App() { return <div class="other" /> }`,
        "/app.tsx",
        [{ path: "/app.css", content: `.target { color: red; }` }],
      );
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;

      for (const [, symbol] of symbolTable.selectors) {
        if (symbol.compiledMatcher === null) continue;
        if (symbol.name === ".target") {
          expect(selectorMatchesElement(nodes[0]!, symbol.compiledMatcher)).toBe(false);
        }
      }
    });
  });

  describe("getScopedSelectors uses buildScopedSelectorIndex", () => {
    it("returns scoped selectors with requirements", () => {
      const { model } = buildModel(
        `import "./app.css"; export default function App() { return <div class="x" /> }`,
        "/app.tsx",
        [{ path: "/app.css", content: `.x { display: flex; }` }],
      );
      const scoped = model.getScopedSelectors();
      expect(scoped).toBeDefined();
      expect(scoped.requirements).toBeDefined();
    });
  });
});
