import { describe, expect, it } from "vitest";
import { buildGraph as buildCSSGraph } from "../css/test-utils";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { createPlainCSSProvider } from "../../src/compilation/providers/plain-css";
import { createSCSSProvider } from "../../src/compilation/providers/scss";
import { createTailwindProvider } from "../../src/compilation/providers/tailwind";
import type { TailwindDesignSystem } from "../../src/compilation/providers/tailwind";

// ═══════════════════════════════════════════════════════════════
// Step 4.6 — Validation Gate
// ═══════════════════════════════════════════════════════════════

describe("Phase 4: CSS Source Providers", () => {

  describe("PlainCSSProvider", () => {
    const provider = createPlainCSSProvider();

    it("parse produces CSSSyntaxTree with correct entities", () => {
      const tree = provider.parse("/test.css", ".btn { color: red; font-size: 1rem; }\n.card { padding: 8px; }", 0);
      expect(tree.kind).toBe("css");
      expect(tree.filePath).toBe("/test.css");
      expect(tree.rules.length).toBe(2);
      expect(tree.selectors.length).toBe(2);
      expect(tree.declarations.length).toBe(3);
      expect(tree.classNameIndex.has("btn")).toBe(true);
      expect(tree.classNameIndex.has("card")).toBe(true);
    });

    it("parse entities match old CSSGraph per-file data", () => {
      const content = ".a { color: red; }\n.b { margin: 0; font-size: 1rem; }";
      const oldGraph = buildCSSGraph(content, "/test.css");
      const oldTrees = cssGraphToSyntaxTrees(oldGraph);
      const oldTree = oldTrees[0]!;

      const newTree = provider.parse("/test.css", content, 0);

      // Same entity counts
      expect(newTree.rules.length).toBe(oldTree.rules.length);
      expect(newTree.selectors.length).toBe(oldTree.selectors.length);
      expect(newTree.declarations.length).toBe(oldTree.declarations.length);

      // Same class names
      expect(new Set(newTree.classNameIndex.keys())).toEqual(new Set(oldTree.classNameIndex.keys()));
    });

    it("parse with variables", () => {
      const tree = provider.parse("/test.css", ":root { --color: blue; --spacing: 4px; }", 0);
      expect(tree.variables.length).toBe(2);
      expect(tree.variablesByName.has("--color")).toBe(true);
      expect(tree.variablesByName.has("--spacing")).toBe(true);
    });

    it("parse with at-rules", () => {
      const tree = provider.parse("/test.css", "@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }", 0);
      expect(tree.atRules.length).toBeGreaterThan(0);
      const keyframes = tree.atRulesByKind.get("keyframes");
      expect(keyframes).toBeDefined();
      expect(keyframes!.length).toBe(1);
    });

    it("sourceOrderBase is applied", () => {
      const tree = provider.parse("/test.css", ".a { color: red; }", 5000);
      expect(tree.sourceOrderBase).toBe(5000);
    });

    it("extractSymbols produces symbols from tree", () => {
      const tree = provider.parse("/test.css", ".btn { color: red; }\n:root { --x: 1; }", 0);
      const contribution = provider.extractSymbols(tree);
      expect(contribution.classNames.has("btn")).toBe(true);
      expect(contribution.selectors.length).toBeGreaterThan(0);
      expect(contribution.customProperties.length).toBeGreaterThan(0);
    });
  });

  describe("SCSSProvider", () => {
    const provider = createSCSSProvider();

    it("parse produces CSSSyntaxTree for SCSS content", () => {
      const tree = provider.parse("/test.scss", "$color: red;\n.btn { color: $color; }", 0);
      expect(tree.kind).toBe("css");
      expect(tree.isScss).toBe(true);
      expect(tree.rules.length).toBeGreaterThan(0);
    });
  });

  describe("TailwindProvider", () => {
    // Mock DesignSystem that knows about common utilities
    const knownUtilities = new Map<string, string>([
      ["flex", ".flex { display: flex; }"],
      ["hidden", ".hidden { display: none; }"],
      ["p-4", ".p-4 { padding: 1rem; }"],
      ["bg-red-500", ".bg-red-500 { background-color: #ef4444; }"],
      ["hover:bg-red-500", ".hover\\:bg-red-500:hover { background-color: #ef4444; }"],
      ["text-sm", ".text-sm { font-size: 0.875rem; line-height: 1.25rem; }"],
      ["hover:bg-red-500/50", ".hover\\:bg-red-500\\/50:hover { background-color: rgb(239 68 68 / 0.5); }"],
      ["min-h-[calc(100vh-4rem)]", ".min-h-\\[calc\\(100vh-4rem\\)\\] { min-height: calc(100vh - 4rem); }"],
    ]);

    const mockDesignSystem: TailwindDesignSystem = {
      candidatesToCss(classes: string[]): (string | null)[] {
        return classes.map(c => knownUtilities.get(c) ?? null);
      },
      getClassList(): [string, { modifiers: string[] }][] {
        return [...knownUtilities.keys()].map(k => [k, { modifiers: [] }]);
      },
      getVariants(): { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[] {
        return [
          { name: "hover", values: [], hasDash: false, isArbitrary: false },
          { name: "focus", values: [], hasDash: false, isArbitrary: false },
          { name: "sm", values: [], hasDash: false, isArbitrary: false },
        ];
      },
    };

    const provider = createTailwindProvider(mockDesignSystem);

    it("has() returns true for known utilities", () => {
      expect(provider.has("flex")).toBe(true);
      expect(provider.has("hidden")).toBe(true);
      expect(provider.has("p-4")).toBe(true);
    });

    it("has() returns false for unknown utilities", () => {
      expect(provider.has("nonexistent-class")).toBe(false);
      expect(provider.has("zzzz")).toBe(false);
    });

    it("resolve() returns CSS for valid utilities", () => {
      const result = provider.resolve("flex");
      expect(result).not.toBeNull();
      expect(result!.css).toContain("display: flex");
    });

    it("resolve() returns null for invalid utilities", () => {
      expect(provider.resolve("nonexistent")).toBeNull();
    });

    it("parseCandidate returns valid result for known utility", () => {
      const result = provider.parseCandidate("flex");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.candidate.utility).toBeDefined();
        expect(result.symbol.symbolKind).toBe("className");
      }
    });

    it("parseCandidate returns diagnostics for unknown utility", () => {
      const result = provider.parseCandidate("nonexistent-utility");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics[0]!.kind).toBe("unknown-utility");
      }
    });

    it("parseCandidate handles variant prefix", () => {
      const result = provider.parseCandidate("hover:bg-red-500");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.candidate.variants.length).toBeGreaterThan(0);
        expect(result.candidate.variants[0]!.name).toBe("hover");
      }
    });

    it("parseCandidate handles modifier", () => {
      const result = provider.parseCandidate("hover:bg-red-500/50");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.candidate.modifier).not.toBeNull();
        expect(result.candidate.modifier!.value).toBe("50");
      }
    });

    it("parseCandidate handles arbitrary value", () => {
      const result = provider.parseCandidate("min-h-[calc(100vh-4rem)]");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.candidate.value).not.toBeNull();
        expect(result.candidate.value!.kind).toBe("arbitrary");
      }
    });

    it("getVariants returns variant list", () => {
      const variants = provider.getVariants();
      expect(variants.length).toBe(3);
      expect(variants.find(v => v.name === "hover")).toBeDefined();
    });

    it("getUtilitySymbols returns contribution with class names", () => {
      const symbols = provider.getUtilitySymbols();
      expect(symbols.classNames.size).toBeGreaterThan(0);
    });
  });
});
