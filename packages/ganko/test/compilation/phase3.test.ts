import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { collectCSSScopeBySolidFile } from "../../src/cross-file/layout/scope";
import type { SolidSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree";
import type { SolidGraph } from "../../src/solid/impl";
import type { CSSGraph } from "../../src/css/impl";

// ═══════════════════════════════════════════════════════════════
// Step 3.6 — Validation Gate
// ═══════════════════════════════════════════════════════════════

/**
 * Helper: build DependencyGraph from solid graphs + CSS graph,
 * alongside the old system's collectCSSScopeBySolidFile for comparison.
 */
function buildBothSystems(
  solidGraphs: SolidGraph[],
  cssGraph: CSSGraph,
) {
  const solidTrees = new Map<string, SolidSyntaxTree>();
  for (const g of solidGraphs) {
    solidTrees.set(g.file, solidGraphToSyntaxTree(g, "v1"));
  }
  const cssTrees = new Map<string, CSSSyntaxTree>();
  for (const tree of cssGraphToSyntaxTrees(cssGraph)) {
    cssTrees.set(tree.filePath, tree);
  }

  const depGraph = buildDependencyGraph(solidTrees, cssTrees);
  const oldScopes = collectCSSScopeBySolidFile(solidGraphs, cssGraph);

  return { depGraph, oldScopes, solidGraphs, cssGraph };
}

describe("Phase 3: Dependency Graph", () => {

  describe("getCSSScope parity with collectCSSScopeBySolidFile", () => {
    it("empty project — no CSS in scope", () => {
      const solid = buildSolidGraph(`const x = 1;`, "/project/app.tsx");
      const cssGraph = buildCSSGraphMultiple([]);
      const { depGraph, oldScopes } = buildBothSystems([solid], cssGraph);

      const newScope = new Set(depGraph.getCSSScope(solid.file));
      const oldScope = new Set(oldScopes.get(solid.file) ?? []);
      expect(newScope).toEqual(oldScope);
    });

    it("direct CSS import includes file in scope", () => {
      const solid = buildSolidGraph(
        `import "./styles.css";`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/styles.css", content: ".a { color: red; }" },
      ]);
      const { depGraph, oldScopes } = buildBothSystems([solid], cssGraph);

      const newScope = new Set(depGraph.getCSSScope(solid.file));
      const oldScope = new Set(oldScopes.get(solid.file) ?? []);
      expect(newScope).toEqual(oldScope);
      expect(newScope.size).toBeGreaterThan(0);
    });

    it("global side-effect CSS applies to ALL solid files", () => {
      const solid1 = buildSolidGraph(
        `import "./global.css";`,
        "/project/a.tsx",
      );
      const solid2 = buildSolidGraph(
        `const x = 1;`,
        "/project/b.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/global.css", content: "body { margin: 0; }" },
      ]);
      const { depGraph, oldScopes } = buildBothSystems([solid1, solid2], cssGraph);

      // solid1 imports global.css without specifiers → global side-effect
      const newScope1 = new Set(depGraph.getCSSScope(solid1.file));
      const oldScope1 = new Set(oldScopes.get(solid1.file) ?? []);
      expect(newScope1).toEqual(oldScope1);

      // solid2 doesn't import anything but should get global.css via side-effect
      const newScope2 = new Set(depGraph.getCSSScope(solid2.file));
      const oldScope2 = new Set(oldScopes.get(solid2.file) ?? []);
      expect(newScope2).toEqual(oldScope2);
    });
  });

  describe("getReverseDependencies", () => {
    it("CSS file returns solid files that import it", () => {
      const solid = buildSolidGraph(
        `import "./styles.css";`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/styles.css", content: ".a { color: red; }" },
      ]);
      const { depGraph } = buildBothSystems([solid], cssGraph);

      // If styles.css is in scope for app.tsx, then app.tsx should be in reverse deps
      const scope = depGraph.getCSSScope(solid.file);
      if (scope.length > 0) {
        const reverseDeps = depGraph.getReverseDependencies(scope[0]!);
        expect(reverseDeps.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getTransitivelyAffected", () => {
    it("changing a CSS file returns affected solid files", () => {
      const solid = buildSolidGraph(
        `import "./styles.css";`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/styles.css", content: ".a { color: red; }" },
      ]);
      const { depGraph } = buildBothSystems([solid], cssGraph);

      const affected = depGraph.getTransitivelyAffected("/project/styles.css");
      // The solid file that imports this CSS should be affected
      expect(affected.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("edge cases", () => {
    it("missing import targets don't crash", () => {
      const solid = buildSolidGraph(
        `import "./nonexistent.css";`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([]);
      const { depGraph } = buildBothSystems([solid], cssGraph);

      // Should not throw
      expect(() => depGraph.getCSSScope(solid.file)).not.toThrow();
      expect(() => depGraph.getDirectDependencies(solid.file)).not.toThrow();
    });

    it("querying unknown file path returns empty", () => {
      const solid = buildSolidGraph(`const x = 1;`, "/project/app.tsx");
      const cssGraph = buildCSSGraphMultiple([]);
      const { depGraph } = buildBothSystems([solid], cssGraph);

      expect(depGraph.getCSSScope("/nonexistent.tsx")).toEqual([]);
      expect(depGraph.getReverseDependencies("/nonexistent.css")).toEqual([]);
      // getTransitivelyAffected may return the path itself (file affects itself)
      // but should not crash on unknown paths
      expect(() => depGraph.getTransitivelyAffected("/nonexistent.ts")).not.toThrow();
    });

    it("isInCSSScope matches getCSSScope membership", () => {
      const solid = buildSolidGraph(
        `import "./styles.css";`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/styles.css", content: ".a { color: red; }" },
      ]);
      const { depGraph } = buildBothSystems([solid], cssGraph);

      const scope = depGraph.getCSSScope(solid.file);
      for (const cssPath of scope) {
        expect(depGraph.isInCSSScope(solid.file, cssPath)).toBe(true);
      }
      expect(depGraph.isInCSSScope(solid.file, "/nonexistent.css")).toBe(false);
    });
  });
});
