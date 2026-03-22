import { describe, expect, it } from "vitest";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation";
import { createFileSemanticModel } from "../../src/compilation/binding/semantic-model";
import { createAnalysisDispatcher } from "../../src/compilation/dispatch/dispatcher";
import { cssLayoutTransitionLayoutProperty } from "../../src/compilation/dispatch/rules/css-layout-transition-layout-property";
import { cssLayoutAnimationLayoutProperty } from "../../src/compilation/dispatch/rules/css-layout-animation-layout-property";
import { cssLayoutFontSwapInstability } from "../../src/compilation/dispatch/rules/css-layout-font-swap-instability";
import { ComputationTier } from "../../src/compilation/dispatch/rule";

// Old system imports for parity
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { runRules } from "../../src/graph";
import { cssLayoutTransitionLayoutProperty as oldTransition } from "../../src/cross-file/rules/css-layout-transition-layout-property";
import { cssLayoutAnimationLayoutProperty as oldAnimation } from "../../src/cross-file/rules/css-layout-animation-layout-property";
import { cssLayoutFontSwapInstability as oldFontSwap } from "../../src/cross-file/rules/css-layout-font-swap-instability";
import type { Diagnostic } from "../../src/diagnostic";
import type { SolidSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree";

describe("Phase 8: Rule Dispatch Framework", () => {

  describe("dispatcher infrastructure", () => {
    it("creates dispatcher and registers rules", () => {
      const dispatcher = createAnalysisDispatcher();
      dispatcher.register(cssLayoutTransitionLayoutProperty);
      dispatcher.register(cssLayoutAnimationLayoutProperty);
      dispatcher.register(cssLayoutFontSwapInstability);

      // Should not throw
      expect(dispatcher).toBeDefined();
    });

    it("resolves Tier 0 for CSS-only rules", () => {
      const dispatcher = createAnalysisDispatcher();
      dispatcher.register(cssLayoutTransitionLayoutProperty);

      const solidGraph = buildSolidGraph(`export default function App() { return <div /> }`, "/app.tsx");
      const cssGraph = buildCSSGraphMultiple([
        { path: "/app.css", content: `.box { transition: width 0.3s; }` },
      ]);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
      const cssTrees = cssGraphToSyntaxTrees(cssGraph);
      const symbolTable = buildSymbolTable(cssTrees);
      const solidTreeMap = new Map<string, SolidSyntaxTree>();
      solidTreeMap.set(solidTree.filePath, solidTree);
      const cssTreeMap = new Map<string, CSSSyntaxTree>();
      for (const t of cssTrees) cssTreeMap.set(t.filePath, t);
      const depGraph = buildDependencyGraph(solidTreeMap, cssTreeMap);
      const compilation = createCompilationFromLegacy([solidTree], cssTrees);

      const result = dispatcher.run(compilation, symbolTable, depGraph, (solidFilePath) => {
        return createFileSemanticModel(solidTree, symbolTable, depGraph, compilation);
      });

      expect(result.maxTierComputed).toBe(ComputationTier.CSSSyntax);
    });
  });

  describe("Tier 0 rule parity: cssLayoutTransitionLayoutProperty", () => {
    it("detects transition on layout property", () => {
      const result = runParityTest(
        [{ path: "/app.css", content: `.box { transition: width 0.3s; }` }],
        cssLayoutTransitionLayoutProperty,
        oldTransition,
      );
      expect(result.newDiags.length).toBeGreaterThan(0);
      expect(result.newDiags.length).toBe(result.oldDiags.length);
    });

    it("no false positive for safe transitions", () => {
      const result = runParityTest(
        [{ path: "/app.css", content: `.box { transition: opacity 0.3s, transform 0.3s; }` }],
        cssLayoutTransitionLayoutProperty,
        oldTransition,
      );
      expect(result.newDiags.length).toBe(0);
      expect(result.oldDiags.length).toBe(0);
    });

    it("identical diagnostics for transition-property", () => {
      const result = runParityTest(
        [{ path: "/app.css", content: `.box { transition-property: height; transition-duration: 0.5s; }` }],
        cssLayoutTransitionLayoutProperty,
        oldTransition,
      );
      assertDiagnosticParity(result.newDiags, result.oldDiags);
    });
  });

  describe("Tier 0 rule parity: cssLayoutAnimationLayoutProperty", () => {
    it("detects animation mutating layout property", () => {
      const result = runParityTest(
        [{
          path: "/app.css",
          content: `
            @keyframes slide { from { height: 0; } to { height: 100px; } }
            .box { animation: slide 0.3s; }
          `,
        }],
        cssLayoutAnimationLayoutProperty,
        oldAnimation,
      );
      expect(result.newDiags.length).toBeGreaterThan(0);
      expect(result.newDiags.length).toBe(result.oldDiags.length);
    });

    it("no false positive for safe animations", () => {
      const result = runParityTest(
        [{
          path: "/app.css",
          content: `
            @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
            .box { animation: fade 0.3s; }
          `,
        }],
        cssLayoutAnimationLayoutProperty,
        oldAnimation,
      );
      expect(result.newDiags.length).toBe(0);
      expect(result.oldDiags.length).toBe(0);
    });
  });

  describe("Tier 0 rule parity: cssLayoutFontSwapInstability", () => {
    it("detects font-display swap without metric overrides", () => {
      const result = runParityTest(
        [{
          path: "/app.css",
          content: `
            @font-face {
              font-family: "CustomFont";
              src: url("/font.woff2") format("woff2");
              font-display: swap;
            }
            .text { font-family: "CustomFont"; }
          `,
        }],
        cssLayoutFontSwapInstability,
        oldFontSwap,
      );
      expect(result.newDiags.length).toBeGreaterThan(0);
      expect(result.newDiags.length).toBe(result.oldDiags.length);
    });

    it("no diagnostic when font-display is auto", () => {
      const result = runParityTest(
        [{
          path: "/app.css",
          content: `
            @font-face {
              font-family: "CustomFont";
              src: url("/font.woff2") format("woff2");
              font-display: auto;
            }
            .text { font-family: "CustomFont"; }
          `,
        }],
        cssLayoutFontSwapInstability,
        oldFontSwap,
      );
      expect(result.newDiags.length).toBe(0);
      expect(result.oldDiags.length).toBe(0);
    });
  });
});

function runParityTest(
  cssFiles: { path: string; content: string }[],
  newRule: import("../../src/compilation/dispatch/rule").AnalysisRule,
  oldRule: import("../../src/graph").BaseRule<import("../../src/cross-file/rule").CrossRuleContext>,
) {
  const solidGraph = buildSolidGraph(`export default function App() { return <div /> }`, "/app.tsx");
  const cssGraph = buildCSSGraphMultiple(cssFiles);

  // New system
  const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
  const cssTrees = cssGraphToSyntaxTrees(cssGraph);
  const symbolTable = buildSymbolTable(cssTrees);
  const solidTreeMap = new Map<string, SolidSyntaxTree>();
  solidTreeMap.set(solidTree.filePath, solidTree);
  const cssTreeMap = new Map<string, CSSSyntaxTree>();
  for (const t of cssTrees) cssTreeMap.set(t.filePath, t);
  const depGraph = buildDependencyGraph(solidTreeMap, cssTreeMap);
  const compilation = createCompilationFromLegacy([solidTree], cssTrees);

  const dispatcher = createAnalysisDispatcher();
  dispatcher.register(newRule);
  const newResult = dispatcher.run(compilation, symbolTable, depGraph, () => {
    return createFileSemanticModel(solidTree, symbolTable, depGraph, compilation);
  });

  // Old system
  const oldDiags: Diagnostic[] = [];
  const oldContext = { solids: [solidGraph], css: cssGraph, layout: null!, logger: { isLevelEnabled: () => false, trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } };
  runRules([oldRule], oldContext, (d) => oldDiags.push(d));

  return { newDiags: newResult.diagnostics, oldDiags };
}

function assertDiagnosticParity(newDiags: readonly Diagnostic[], oldDiags: readonly Diagnostic[]) {
  expect(newDiags.length).toBe(oldDiags.length);
  const newSorted = [...newDiags].sort((a, b) => `${a.file}:${a.loc.start.line}`.localeCompare(`${b.file}:${b.loc.start.line}`));
  const oldSorted = [...oldDiags].sort((a, b) => `${a.file}:${a.loc.start.line}`.localeCompare(`${b.file}:${b.loc.start.line}`));
  for (let i = 0; i < newSorted.length; i++) {
    expect(newSorted[i]!.rule).toBe(oldSorted[i]!.rule);
    expect(newSorted[i]!.file).toBe(oldSorted[i]!.file);
    expect(newSorted[i]!.loc.start.line).toBe(oldSorted[i]!.loc.start.line);
    expect(newSorted[i]!.loc.start.column).toBe(oldSorted[i]!.loc.start.column);
    expect(newSorted[i]!.message).toBe(oldSorted[i]!.message);
  }
}
