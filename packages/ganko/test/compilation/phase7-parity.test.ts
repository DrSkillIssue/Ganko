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

const SOLID_PATH = "/project/src/App.tsx";

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
  return { model, solidTree };
}

describe("Phase 7 Validation Gate: Signal + Fact Parity", () => {

  it("signal snapshot signal count matches old system per element", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    let checked = 0;
    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;

      const newSnapshot = model.getSignalSnapshot(oldElement.elementId);
      // Both should have the same monitored signals present
      expect(newSnapshot.signals.size).toBe(oldRecord.snapshot.signals.size);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("signal snapshot values match old system for all 55 signals", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    let signalsMismatched = 0;
    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;

      const newSnapshot = model.getSignalSnapshot(oldElement.elementId);

      for (const [signalName, oldValue] of oldRecord.snapshot.signals) {
        const newValue = newSnapshot.signals.get(signalName);
        if (!newValue) { signalsMismatched++; continue; }
        if ((oldValue.kind as number) !== (newValue.kind as number)) { signalsMismatched++; continue; }
        if ((oldValue.kind as number) === 0 /* Known */ && (newValue.kind as number) === 0 /* Known */) {
          if ((oldValue as any).normalized !== (newValue as any).normalized) signalsMismatched++;
        }
      }
    }
    expect(signalsMismatched).toBe(0);
  });

  it("reservedSpace fact matches old system (snapshot-based)", () => {
    const { layout } = buildOldSystem();
    const { model } = buildNewSystem();

    for (const oldElement of layout.elements) {
      const oldRecord = layout.records.get(oldElement);
      if (!oldRecord) continue;
      const newFact = model.getLayoutFact(oldElement.elementId, "reservedSpace");
      expect(newFact.hasReservedSpace).toBe(oldRecord.reservedSpace.hasReservedSpace);
    }
  });

  it("AlignmentContext has ALL 16+ fields", () => {
    const { model } = buildNewSystem();
    const nodes = model.getElementNodes();
    let foundContext = false;

    for (const node of nodes) {
      const ctx = model.getAlignmentContext(node.elementId);
      if (!ctx) continue;
      foundContext = true;

      expect(ctx).toHaveProperty("kind");
      expect(ctx).toHaveProperty("certainty");
      expect(ctx).toHaveProperty("parentSolidFile");
      expect(ctx).toHaveProperty("parentElementId");
      expect(ctx).toHaveProperty("parentElementKey");
      expect(ctx).toHaveProperty("parentTag");
      expect(ctx).toHaveProperty("axis");
      expect(ctx).toHaveProperty("axisCertainty");
      expect(ctx).toHaveProperty("inlineDirection");
      expect(ctx).toHaveProperty("inlineDirectionCertainty");
      expect(ctx).toHaveProperty("parentDisplay");
      expect(ctx).toHaveProperty("parentAlignItems");
      expect(ctx).toHaveProperty("parentPlaceItems");
      expect(ctx).toHaveProperty("hasPositionedOffset");
      expect(ctx).toHaveProperty("crossAxisIsBlockAxis");
      expect(ctx).toHaveProperty("crossAxisIsBlockAxisCertainty");
      expect(ctx).toHaveProperty("baselineRelevance");
      expect(ctx).toHaveProperty("evidence");
      break;
    }

    expect(foundContext).toBe(true);
  });

  it("CohortStats has factSummary, provenance, conditionalSignalCount, totalSignalCount", () => {
    const { model } = buildNewSystem();
    const nodes = model.getElementNodes();
    let foundStats = false;

    for (const node of nodes) {
      const stats = model.getCohortStats(node.elementId);
      if (!stats) continue;
      foundStats = true;

      expect(stats).toHaveProperty("factSummary");
      expect(stats.factSummary).toHaveProperty("exact");
      expect(stats.factSummary).toHaveProperty("interval");
      expect(stats.factSummary).toHaveProperty("unknown");
      expect(stats.factSummary).toHaveProperty("conditional");
      expect(stats.factSummary).toHaveProperty("total");

      expect(stats).toHaveProperty("provenance");
      expect(stats.provenance).toHaveProperty("reason");
      expect(stats.provenance).toHaveProperty("guardKey");
      expect(stats.provenance).toHaveProperty("guards");

      expect(stats).toHaveProperty("conditionalSignalCount");
      expect(stats).toHaveProperty("totalSignalCount");
      break;
    }

    expect(foundStats).toBe(true);
  });

  it("CohortSubjectStats has contentComposition and signals", () => {
    const { model } = buildNewSystem();
    const nodes = model.getElementNodes();
    let foundSubject = false;

    for (const node of nodes) {
      const stats = model.getCohortStats(node.elementId);
      if (!stats) continue;

      for (const [, subject] of stats.subjectsByElementKey) {
        foundSubject = true;

        expect(subject).toHaveProperty("contentComposition");
        expect(subject.contentComposition).toHaveProperty("classification");
        expect(subject.contentComposition).toHaveProperty("hasTextContent");

        expect(subject).toHaveProperty("signals");
        expect(subject.signals).toHaveProperty("verticalAlign");
        expect(subject.signals).toHaveProperty("alignSelf");
        expect(subject.signals).toHaveProperty("placeSelf");
        expect(subject.signals).toHaveProperty("hasControlOrReplacedPeer");
        expect(subject.signals).toHaveProperty("textContrastWithPeers");
        break;
      }
      if (foundSubject) break;
    }

    expect(foundSubject).toBe(true);
  });
});
