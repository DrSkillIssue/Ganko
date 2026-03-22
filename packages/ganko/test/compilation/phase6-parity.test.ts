import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { createFileSemanticModel } from "../../src/compilation/binding/semantic-model";
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation";
import { buildLayoutGraph } from "../../src/cross-file/layout/build";
import type { SolidSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree";

// ═══════════════════════════════════════════════════════════════
// Step 6.6 — Validation Gate: Parity with old system
// ═══════════════════════════════════════════════════════════════

const SOLID_PATH = "/project/src/App.tsx";

// 60+ elements across nested structures, various tags, classes, attributes
const SOLID_CODE = `
import "./styles.css";

export default function App() {
  return (
    <div class="app-root" id="app">
      <header class="header">
        <nav class="nav">
          <a class="nav-link" href="/">Home</a>
          <a class="nav-link" href="/about">About</a>
          <a class="nav-link active" href="/contact">Contact</a>
        </nav>
        <div class="header-actions">
          <button class="btn btn-primary">Sign In</button>
          <button class="btn btn-secondary">Sign Up</button>
        </div>
      </header>
      <main class="main">
        <section class="hero">
          <h1 class="hero-title">Welcome</h1>
          <p class="hero-subtitle">Description text</p>
          <div class="hero-cta">
            <button class="btn btn-large">Get Started</button>
          </div>
        </section>
        <section class="features">
          <div class="feature-card">
            <div class="feature-icon"><img src="/icon1.svg" alt="icon" /></div>
            <h3 class="feature-title">Feature One</h3>
            <p class="feature-desc">Description</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon"><img src="/icon2.svg" alt="icon" /></div>
            <h3 class="feature-title">Feature Two</h3>
            <p class="feature-desc">Description</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon"><img src="/icon3.svg" alt="icon" /></div>
            <h3 class="feature-title">Feature Three</h3>
            <p class="feature-desc">Description</p>
          </div>
        </section>
        <section class="pricing">
          <div class="pricing-card">
            <h3>Basic</h3>
            <span class="price">$9</span>
            <ul class="feature-list">
              <li>Feature A</li>
              <li>Feature B</li>
              <li>Feature C</li>
            </ul>
            <button class="btn">Select</button>
          </div>
          <div class="pricing-card highlighted">
            <h3>Pro</h3>
            <span class="price">$29</span>
            <ul class="feature-list">
              <li>Feature A</li>
              <li>Feature B</li>
              <li>Feature C</li>
              <li>Feature D</li>
            </ul>
            <button class="btn btn-primary">Select</button>
          </div>
        </section>
      </main>
      <footer class="footer">
        <div class="footer-links">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/contact">Contact</a>
        </div>
        <p class="copyright">2024 Company</p>
      </footer>
    </div>
  );
}
`;

const CSS_FILES = [
  {
    path: "/project/src/styles.css",
    content: `
      .app-root { display: flex; flex-direction: column; min-height: 100vh; }
      .header { display: flex; height: 64px; position: sticky; top: 0; }
      .nav { display: flex; }
      .nav-link { display: flex; align-items: center; padding-left: 16px; padding-right: 16px; }
      .nav-link.active { font-size: 14px; }
      .btn { display: flex; align-items: center; height: 40px; }
      .btn-primary { min-height: 40px; }
      .btn-large { height: 48px; min-height: 48px; }
      .main { display: flex; flex-direction: column; }
      .hero { display: flex; flex-direction: column; min-height: 400px; }
      .hero-title { font-size: 48px; line-height: 1.2; }
      .features { display: flex; }
      .feature-card { display: flex; flex-direction: column; width: 300px; min-height: 200px; }
      .feature-icon { display: flex; height: 64px; width: 64px; }
      .pricing { display: flex; }
      .pricing-card { display: flex; flex-direction: column; min-height: 300px; }
      .pricing-card.highlighted { min-height: 350px; }
      .price { font-size: 32px; line-height: 1; }
      .footer { display: flex; height: 80px; }
      .footer-links { display: flex; }
      img { display: block; width: 100%; height: auto; }
    `,
  },
];

function buildOldSystem() {
  const solidGraph = buildSolidGraph(SOLID_CODE, SOLID_PATH);
  const cssGraph = buildCSSGraphMultiple(CSS_FILES);
  const layout = buildLayoutGraph([solidGraph], cssGraph);
  return { layout, solidGraph, cssGraph };
}

function buildNewSystem() {
  const solidGraph = buildSolidGraph(SOLID_CODE, SOLID_PATH);
  const cssGraph = buildCSSGraphMultiple(CSS_FILES);
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

  return { model, solidTree, solidGraph, cssGraph };
}

describe("Phase 6 Validation Gate: Parity with old system", () => {

  it("new system produces 50+ elements", () => {
    const { model } = buildNewSystem();
    const elements = model.getElementNodes();
    expect(elements.length).toBeGreaterThanOrEqual(50);
  });

  it("element count matches old system", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    const oldCount = layout.elements.length;
    const newCount = model.getElementNodes().length;
    expect(newCount).toBe(oldCount);
  });

  it("element tag names match old system", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    const oldTags = layout.elements.map(e => e.tagName).sort();
    const newTags = model.getElementNodes().map(e => e.tagName).sort();
    expect(newTags).toEqual(oldTags);
  });

  it("element keys match old system", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    const oldKeys = new Set(layout.elements.map(e => e.key));
    const newKeys = new Set(model.getElementNodes().map(e => e.key));
    expect(newKeys).toEqual(oldKeys);
  });

  it("class tokens match old system per element", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    for (const oldElement of layout.elements) {
      const newElement = model.getElementNode(oldElement.elementId);
      expect(newElement).not.toBeNull();
      if (!newElement) continue;

      const oldTokens = [...oldElement.classTokens].sort();
      const newTokens = [...newElement.classTokens].sort();
      expect(newTokens).toEqual(oldTokens);
    }
  });

  it("cascade declarations match old system for elements with edges", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    let elementsWithCascade = 0;

    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;
      if (oldRecord.cascade.size === 0) continue;

      elementsWithCascade++;
      const newCascade = model.getElementCascade(oldElement.elementId);

      // Compare cascade property names
      const oldProps = [...oldRecord.cascade.keys()].sort();
      const newProps = [...newCascade.declarations.keys()].sort();
      expect(newProps).toEqual(oldProps);

      // Compare cascade values
      for (const [prop, oldDecl] of oldRecord.cascade) {
        const newDecl = newCascade.declarations.get(prop);
        expect(newDecl).toBeDefined();
        if (!newDecl) continue;
        expect(newDecl.value).toBe(oldDecl.value);
      }
    }

    expect(elementsWithCascade).toBeGreaterThan(0);
  });

  it("edge counts match old system per element", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;

      const newCascade = model.getElementCascade(oldElement.elementId);
      expect(newCascade.edges.length).toBe(oldRecord.edges.length);
    }
  });

  it("reservedSpace fact matches old system", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;

      const newFact = model.getLayoutFact(oldElement.elementId, "reservedSpace");
      expect(newFact.hasReservedSpace).toBe(oldRecord.reservedSpace.hasReservedSpace);
    }
  });
});
