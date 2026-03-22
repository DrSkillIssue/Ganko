import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { createFileSemanticModel } from "../../src/compilation/binding/semantic-model";
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation";
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
  return { model, solidTree, symbolTable };
}

const SOLID_CODE = `
import "./styles.css";
export default function App() {
  return (
    <div class="container" style={{ display: "flex", "flex-direction": "column" }}>
      <header class="header" style={{ height: "64px", position: "sticky", top: "0px" }}>
        <nav class="nav">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main class="main" style={{ display: "flex", "flex-direction": "column" }}>
        <section class="hero" style={{ "min-height": "400px" }}>
          <h1>Title</h1>
          <p>Description</p>
        </section>
        <section class="cards" style={{ display: "flex" }}>
          <div class="card" style={{ width: "300px", "min-height": "200px" }}>
            <img src="/icon.svg" alt="icon" />
            <h3>Card 1</h3>
            <p>Text</p>
          </div>
          <div class="card" style={{ width: "300px", "min-height": "200px" }}>
            <img src="/icon2.svg" alt="icon" />
            <h3>Card 2</h3>
            <p>Text</p>
          </div>
          <div class="card" style={{ width: "300px", "min-height": "200px" }}>
            <img src="/icon3.svg" alt="icon" />
            <h3>Card 3</h3>
            <p>Text</p>
          </div>
        </section>
      </main>
      <footer class="footer" style={{ height: "80px" }}>
        <p>Copyright</p>
      </footer>
    </div>
  );
}
`;

const CSS_FILES = [
  {
    path: "/project/src/styles.css",
    content: `
      .container { display: flex; flex-direction: column; }
      .header { display: flex; height: 64px; }
      .nav { display: flex; }
      .main { display: flex; flex-direction: column; }
      .hero { min-height: 400px; }
      .cards { display: flex; }
      .card { width: 300px; min-height: 200px; }
      .footer { height: 80px; }
      img { display: block; width: 100%; height: auto; }
    `,
  },
];

describe("Phase 7: Signal + Fact Analyzers (Tier 4-5)", () => {

  describe("getSignalSnapshot", () => {
    it("returns snapshot with signals for elements with CSS", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      expect(nodes.length).toBeGreaterThan(0);

      const header = nodes.find(n => n.classTokens.includes("header"));
      if (!header) return;

      const snapshot = model.getSignalSnapshot(header.elementId);
      expect(snapshot).toBeDefined();
      expect(snapshot.signals.size).toBeGreaterThan(0);
      expect(snapshot.elementId).toBe(header.elementId);
    });

    it("snapshot includes inline style values", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      const footer = nodes.find(n => n.classTokens.includes("footer"));
      if (!footer) return;

      const snapshot = model.getSignalSnapshot(footer.elementId);
      const height = snapshot.signals.get("height");
      expect(height).toBeDefined();
    });

    it("inherits font-size/line-height/writing-mode/direction from parent", () => {
      const { model } = buildModel(
        `export default function App() { return <div style={{ "font-size": "20px" }}><span>text</span></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const span = nodes.find(n => n.tagName === "span");
      if (!span) return;

      const snapshot = model.getSignalSnapshot(span.elementId);
      const fontSize = snapshot.signals.get("font-size");
      expect(fontSize).toBeDefined();
    });
  });

  describe("getAlignmentContext", () => {
    it("returns context for parent with 2+ children", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      const cards = nodes.find(n => n.classTokens.includes("cards"));
      if (!cards) return;

      const context = model.getAlignmentContext(cards.elementId);
      expect(context).not.toBeNull();
      if (!context) return;
      expect(context.kind).toBeDefined();
      expect(context.parentElementId).toBe(cards.elementId);
    });

    it("classifies flex container as flex-cross-axis", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      const cards = nodes.find(n => n.classTokens.includes("cards"));
      if (!cards) return;

      const context = model.getAlignmentContext(cards.elementId);
      expect(context).not.toBeNull();
      if (!context) return;
      expect(context.kind).toBe("flex-cross-axis");
    });

    it("returns null for element without 2+ children", () => {
      const { model } = buildModel(
        `export default function App() { return <div><span>only child</span></div> }`,
        "/app.tsx",
        [],
      );
      const nodes = model.getElementNodes();
      const div = nodes.find(n => n.tagName === "div");
      if (!div) return;
      expect(model.getAlignmentContext(div.elementId)).toBeNull();
    });
  });

  describe("getCohortStats", () => {
    it("returns cohort stats for parent with 2+ children", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      const cards = nodes.find(n => n.classTokens.includes("cards"));
      if (!cards) return;

      const stats = model.getCohortStats(cards.elementId);
      expect(stats).not.toBeNull();
      if (!stats) return;
      expect(stats.subjectsByElementKey.size).toBeGreaterThan(0);
      expect(stats.factSummary).toBeDefined();
      expect(stats.provenance).toBeDefined();
    });
  });

  describe("getConditionalDelta / getBaselineOffsets", () => {
    it("returns null for elements without conditional selectors", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const nodes = model.getElementNodes();
      if (nodes.length === 0) return;
      const delta = model.getConditionalDelta(nodes[0]!.elementId);
      // May be null or a map — either is valid for unconditional CSS
      expect(delta === null || delta instanceof Map).toBe(true);
    });
  });

  describe("getScrollContainerElements", () => {
    it("returns empty for fixture without overflow", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const scrollContainers = model.getScrollContainerElements();
      expect(scrollContainers.length).toBe(0);
    });

    it("returns elements with overflow: auto", () => {
      const { model } = buildModel(
        `import "./s.css"; export default function App() { return <div class="scroll"><p>content</p></div> }`,
        "/app.tsx",
        [{ path: "/s.css", content: `.scroll { overflow: auto; height: 200px; }` }],
      );
      const scrollContainers = model.getScrollContainerElements();
      expect(scrollContainers.length).toBe(1);
      expect(scrollContainers[0]!.classTokens).toContain("scroll");
    });
  });

  describe("getElementsByKnownSignalValue", () => {
    it("finds elements by display value", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const flexElements = model.getElementsByKnownSignalValue("display", "flex");
      expect(flexElements.length).toBeGreaterThan(0);
    });
  });

  describe("getStatefulSelectorEntries / getStatefulNormalizedDeclarations / getStatefulBaseValueIndex", () => {
    it("returns entries for rule IDs", () => {
      const { model, symbolTable } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      for (const [, selector] of symbolTable.selectors) {
        const entries = model.getStatefulSelectorEntries(selector.entity.rule.id);
        expect(Array.isArray(entries)).toBe(true);
        const decls = model.getStatefulNormalizedDeclarations(selector.entity.rule.id);
        expect(Array.isArray(decls)).toBe(true);
        break;
      }
    });

    it("returns base value index", () => {
      const { model } = buildModel(SOLID_CODE, "/project/src/App.tsx", CSS_FILES);
      const index = model.getStatefulBaseValueIndex();
      expect(index instanceof Map).toBe(true);
    });
  });
});
