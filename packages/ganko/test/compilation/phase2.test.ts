import { describe, expect, it } from "vitest";
import { buildGraph as buildCSSGraph, buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { createDeclarationTable } from "../../src/compilation/symbols/declaration-table";

// ═══════════════════════════════════════════════════════════════
// Step 2.6 — Validation Gate
// ═══════════════════════════════════════════════════════════════

describe("Phase 2: Symbol Hierarchy", () => {

  // Helper: build SymbolTable from CSS source(s)
  function buildFromCSS(files: { path: string; content: string }[]) {
    const cssGraph = buildCSSGraphMultiple(files);
    const trees = cssGraphToSyntaxTrees(cssGraph);
    const symbolTable = buildSymbolTable(trees);
    return { cssGraph, trees, symbolTable };
  }

  describe("Class name parity", () => {
    it("symbolTable.classNames.keys() equals oldCSSGraph.classNameIndex.keys()", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".btn { color: red; }\n.card { padding: 8px; }" },
        { path: "/b.css", content: ".btn { font-size: 1rem; }\n.header { margin: 0; }" },
      ]);
      const expected = new Set(cssGraph.classNameIndex.keys());
      const actual = new Set(symbolTable.classNames.keys());
      expect(actual).toEqual(expected);
    });

    it("class names merged across files", () => {
      const { symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".shared { color: red; }" },
        { path: "/b.css", content: ".shared { font-size: 1rem; }" },
      ]);
      const sym = symbolTable.classNames.get("shared");
      expect(sym).toBeDefined();
      expect(sym!.source.kind).toBe("css");
      if (sym!.source.kind === "css") {
        expect(sym!.source.selectors.length).toBe(2);
        expect(sym!.source.filePaths.length).toBe(2);
      }
    });

    it("hasClassName and getClassName work", () => {
      const { symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".exists { color: red; }" },
      ]);
      expect(symbolTable.hasClassName("exists")).toBe(true);
      expect(symbolTable.hasClassName("missing")).toBe(false);
      expect(symbolTable.getClassName("exists")).not.toBeNull();
      expect(symbolTable.getClassName("missing")).toBeNull();
    });
  });

  describe("Selector parity", () => {
    it("symbolTable.selectors.size equals oldCSSGraph.selectors.length", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".a { color: red; }\n#id { margin: 0; }\np { font-size: 1rem; }" },
      ]);
      expect(symbolTable.selectors.size).toBe(cssGraph.selectors.length);
    });

    it("every selector ID in old graph exists in symbolTable", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".a, .b { color: red; }\n.c { margin: 0; }" },
      ]);
      for (const sel of cssGraph.selectors) {
        expect(symbolTable.selectors.has(sel.id)).toBe(true);
      }
    });

    it("specificity triple matches [old[1], old[2], old[3]]", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: "#id .class div { color: red; }" },
      ]);
      for (const sel of cssGraph.selectors) {
        const sym = symbolTable.selectors.get(sel.id);
        expect(sym).toBeDefined();
        expect(sym!.specificity).toEqual([sel.specificity[1], sel.specificity[2], sel.specificity[3]]);
      }
    });
  });

  describe("Custom property parity", () => {
    it("keys match variablesByName keys filtered to -- prefix", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ":root { --color-primary: blue; --spacing-sm: 4px; }" },
      ]);
      const expected = new Set([...cssGraph.variablesByName.keys()].filter(k => k.startsWith("--")));
      const actual = new Set(symbolTable.customProperties.keys());
      expect(actual).toEqual(expected);
    });

    it("getCustomProperty works", () => {
      const { symbolTable } = buildFromCSS([
        { path: "/a.css", content: ":root { --my-var: red; }" },
      ]);
      expect(symbolTable.getCustomProperty("--my-var")).not.toBeNull();
      expect(symbolTable.getCustomProperty("--missing")).toBeNull();
    });
  });

  describe("Keyframes parity", () => {
    it("keyframes keys match oldCSSGraph.knownKeyframeNames", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: "@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n@keyframes slideUp { 0% { transform: translateY(100%); } 100% { transform: translateY(0); } }" },
      ]);
      const expected = cssGraph.knownKeyframeNames;
      const actual = new Set(symbolTable.keyframes.keys());
      expect(actual).toEqual(expected);
    });

    it("getKeyframes works", () => {
      const { symbolTable } = buildFromCSS([
        { path: "/a.css", content: "@keyframes spin { to { transform: rotate(360deg); } }" },
      ]);
      expect(symbolTable.getKeyframes("spin")).not.toBeNull();
      expect(symbolTable.getKeyframes("missing")).toBeNull();
    });
  });

  describe("CSS-only rule index parity (Constraint 10)", () => {
    const css = [
      { path: "/a.css", content: `
        #myId .btn { color: red; }
        [data-x] { margin: 0; }
        * { box-sizing: border-box; }
        input[type="checkbox"] + label { cursor: pointer; }
        td { padding: 4px; }
        .empty {}
        .deep1 { .deep2 { .deep3 { .deep4 { color: red; } } } }
        .important { color: red !important; }
        @keyframes empty {}
      ` },
    ];

    it("idSelectors.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.idSelectors.length).toBe(cssGraph.idSelectors.length);
    });

    it("attributeSelectors.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.attributeSelectors.length).toBe(cssGraph.attributeSelectors.length);
    });

    it("universalSelectors.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.universalSelectors.length).toBe(cssGraph.universalSelectors.length);
    });

    it("importantDeclarations.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.importantDeclarations.length).toBe(cssGraph.importantDeclarations.length);
    });

    it("emptyRules.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.emptyRules.length).toBe(cssGraph.emptyRules.length);
    });

    it("emptyKeyframes.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.emptyKeyframes.length).toBe(cssGraph.emptyKeyframes.length);
    });

    it("deepNestedRules.length matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS(css);
      expect(symbolTable.deepNestedRules.length).toBe(cssGraph.deepNestedRules.length);
    });
  });

  describe("declarationsForProperties parity (Constraint 13)", () => {
    it("single property matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".a { color: red; }\n.b { color: blue; font-size: 1rem; }" },
      ]);
      const expected = cssGraph.declarationsForProperties("color");
      const actual = symbolTable.declarationsForProperties("color");
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(actual[i]!.property).toBe(expected[i]!.property);
        expect(actual[i]!.value).toBe(expected[i]!.value);
      }
    });

    it("multiple properties matches", () => {
      const { cssGraph, symbolTable } = buildFromCSS([
        { path: "/a.css", content: ".a { animation: fadeIn 1s; animation-name: slideUp; color: red; }" },
      ]);
      const expected = cssGraph.declarationsForProperties("animation", "animation-name");
      const actual = symbolTable.declarationsForProperties("animation", "animation-name");
      expect(actual.length).toBe(expected.length);
    });
  });

  describe("DeclarationTable incremental pattern", () => {
    it("withTree adds trees and materialize produces correct table", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; }" },
        { path: "/b.css", content: ".b { color: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);

      let table = createDeclarationTable();
      for (const tree of trees) {
        table = table.withTree(tree);
      }

      const st = table.materialize();
      expect(st.classNames.has("a")).toBe(true);
      expect(st.classNames.has("b")).toBe(true);
    });

    it("withoutTree removes file contributions", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; }" },
        { path: "/b.css", content: ".b { color: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);

      let table = createDeclarationTable();
      for (const tree of trees) {
        table = table.withTree(tree);
      }
      table = table.withoutTree("/a.css");

      const st = table.materialize();
      expect(st.classNames.has("a")).toBe(false);
      expect(st.classNames.has("b")).toBe(true);
    });

    it("generation increments on each mutation", () => {
      const graph = buildCSSGraph(".a { color: red; }");
      const trees = cssGraphToSyntaxTrees(graph);

      const t0 = createDeclarationTable();
      const t1 = t0.withTree(trees[0]!);
      const t2 = t1.withoutTree("/nonexistent");

      expect(t1.generation).toBeGreaterThan(t0.generation);
      // withoutTree on nonexistent returns same instance
      expect(t2).toBe(t1);
    });

    it("materialize caches result (second call returns same reference)", () => {
      const graph = buildCSSGraph(".a { color: red; }");
      const trees = cssGraphToSyntaxTrees(graph);
      const table = createDeclarationTable().withTree(trees[0]!);

      const st1 = table.materialize();
      const st2 = table.materialize();
      expect(st1).toBe(st2);
    });

    it("adding 11th tree to 10-tree table produces correct result", () => {
      const files = Array.from({ length: 11 }, (_, i) => ({
        path: `/file${i}.css`,
        content: `.class${i} { color: red; }`,
      }));
      const graph = buildCSSGraphMultiple(files);
      const trees = cssGraphToSyntaxTrees(graph);

      let table = createDeclarationTable();
      for (let i = 0; i < 10; i++) {
        table = table.withTree(trees[i]!);
      }
      // Materialize the first 10
      const st10 = table.materialize();
      expect(st10.classNames.size).toBe(10);

      // Add 11th
      table = table.withTree(trees[10]!);
      const st11 = table.materialize();
      expect(st11.classNames.size).toBe(11);
      expect(st11.classNames.has("class10")).toBe(true);
    });
  });
});
