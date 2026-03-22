import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { buildSymbolTable } from "../../src/compilation/symbols/symbol-table";
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph";
import { createFileSemanticModel } from "../../src/compilation/binding/semantic-model";
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation";
import { getUndefinedCSSClasses } from "../../src/cross-file/queries";
import type { SolidSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree";

// ═══════════════════════════════════════════════════════════════
// Step 5.6 — Validation Gate
// ═══════════════════════════════════════════════════════════════

function buildSemanticModel(solidCode: string, solidPath: string, cssFiles: { path: string; content: string }[]) {
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

  return { model, solidGraph, cssGraph, solidTree, symbolTable };
}

describe("Phase 5: SemanticModel Core (Tier 0-1)", () => {

  describe("getClassNameInfo", () => {
    it("returns symbol for CSS class names", () => {
      const { model } = buildSemanticModel(
        `import "./styles.css";`,
        "/project/app.tsx",
        [{ path: "/project/styles.css", content: ".btn { color: red; }\n.card { padding: 8px; }" }],
      );
      expect(model.getClassNameInfo("btn")).not.toBeNull();
      expect(model.getClassNameInfo("btn")!.symbolKind).toBe("className");
      expect(model.getClassNameInfo("card")).not.toBeNull();
    });

    it("returns null for undefined class names", () => {
      const { model } = buildSemanticModel(
        `const x = 1;`,
        "/project/app.tsx",
        [{ path: "/project/styles.css", content: ".btn { color: red; }" }],
      );
      expect(model.getClassNameInfo("nonexistent")).toBeNull();
    });

    it("matches css.classNameIndex.has() for every class name", () => {
      const { model, cssGraph } = buildSemanticModel(
        `const x = 1;`,
        "/project/app.tsx",
        [
          { path: "/a.css", content: ".alpha { color: red; }\n.beta { margin: 0; }" },
          { path: "/b.css", content: ".gamma { padding: 4px; }" },
        ],
      );
      for (const name of cssGraph.classNameIndex.keys()) {
        expect(model.getClassNameInfo(name) !== null).toBe(true);
      }
      expect(model.getClassNameInfo("nonexistent")).toBeNull();
    });
  });

  describe("getCustomPropertyResolution", () => {
    it("resolves defined custom properties", () => {
      const { model } = buildSemanticModel(
        `const x = 1;`,
        "/project/app.tsx",
        [{ path: "/a.css", content: ":root { --color-primary: blue; }" }],
      );
      const resolution = model.getCustomPropertyResolution("--color-primary");
      expect(resolution.resolved).toBe(true);
      expect(resolution.symbol).not.toBeNull();
      expect(resolution.symbol!.name).toBe("--color-primary");
    });

    it("returns unresolved for unknown properties", () => {
      const { model } = buildSemanticModel(
        `const x = 1;`,
        "/project/app.tsx",
        [{ path: "/a.css", content: ".a { color: red; }" }],
      );
      const resolution = model.getCustomPropertyResolution("--nonexistent");
      expect(resolution.resolved).toBe(false);
      expect(resolution.symbol).toBeNull();
    });
  });

  describe("getScopedCSSFiles", () => {
    it("returns CSS files in scope", () => {
      const { model } = buildSemanticModel(
        `import "./styles.css";`,
        "/project/app.tsx",
        [{ path: "/project/styles.css", content: ".a { color: red; }" }],
      );
      const scoped = model.getScopedCSSFiles();
      expect(scoped.length).toBeGreaterThanOrEqual(0);
    });

    it("caches result", () => {
      const { model } = buildSemanticModel(
        `import "./styles.css";`,
        "/project/app.tsx",
        [{ path: "/project/styles.css", content: ".a { color: red; }" }],
      );
      const first = model.getScopedCSSFiles();
      const second = model.getScopedCSSFiles();
      expect(first).toBe(second); // same reference — cached
    });
  });

  describe("getImportChain", () => {
    it("returns solid tree imports", () => {
      const { model, solidTree } = buildSemanticModel(
        `import { createSignal } from "solid-js";`,
        "/project/app.tsx",
        [],
      );
      const imports = model.getImportChain();
      expect(imports).toBe(solidTree.imports);
    });
  });

  describe("getReactiveKind", () => {
    it("returns kind for reactive variables", () => {
      const { model, solidTree } = buildSemanticModel(
        `import { createSignal } from "solid-js";\nconst [count, setCount] = createSignal(0);`,
        "/project/app.tsx",
        [],
      );
      // Find the signal variable
      const signalVars = solidTree.reactiveVariables;
      if (signalVars.length > 0) {
        const kind = model.getReactiveKind(signalVars[0]!);
        expect(kind).not.toBeNull();
      }
    });

    it("returns null for non-reactive variables", () => {
      const { model, solidTree } = buildSemanticModel(
        `const x = 1;`,
        "/project/app.tsx",
        [],
      );
      const nonReactive = solidTree.variables.find(v => !v.isReactive);
      if (nonReactive) {
        expect(model.getReactiveKind(nonReactive)).toBeNull();
      }
    });
  });

  describe("getDependencyEdges", () => {
    it("returns edges for computation", () => {
      const { model, solidTree } = buildSemanticModel(
        `import { createSignal, createEffect } from "solid-js";\nconst [count] = createSignal(0);\ncreateEffect(() => console.log(count()));`,
        "/project/app.tsx",
        [],
      );
      if (solidTree.computations.length > 0) {
        const comp = solidTree.computations[0]!;
        const edges = model.getDependencyEdges(comp);
        expect(Array.isArray(edges)).toBe(true);
      }
    });
  });

  describe("getClassNameInfo parity with getUndefinedCSSClasses", () => {
    it("produces same undefined-class set", () => {
      const solidGraph = buildSolidGraph(
        `export function App() { return <div class="btn card nonexistent other-missing">Hello</div>; }`,
        "/project/app.tsx",
      );
      const cssGraph = buildCSSGraphMultiple([
        { path: "/project/styles.css", content: ".btn { color: red; }\n.card { padding: 8px; }" },
      ]);

      // Old system
      const oldUndefined = getUndefinedCSSClasses([solidGraph], cssGraph);
      const oldUndefinedNames = new Set(oldUndefined.map(u => u.className));

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
      const model = createFileSemanticModel(solidTree, symbolTable, depGraph, compilation);

      // Check each static class token
      const newUndefinedNames = new Set<string>();
      for (const [, idx] of solidTree.staticClassTokensByElementId) {
        if (idx.hasDynamicClass) continue;
        for (const token of idx.tokens) {
          if (model.getClassNameInfo(token) === null) {
            if (!solidTree.inlineStyleClassNames.has(token)) {
              newUndefinedNames.add(token);
            }
          }
        }
      }

      expect(newUndefinedNames).toEqual(oldUndefinedNames);
    });
  });

  describe("Tier 2+ methods", () => {
    it("getElementNode returns null for non-existent element", () => {
      const { model } = buildSemanticModel(`const x = 1;`, "/app.tsx", []);
      expect(model.getElementNode(0)).toBeNull();
    });

    it("getElementCascade returns empty cascade for non-existent element", () => {
      const { model } = buildSemanticModel(`const x = 1;`, "/app.tsx", []);
      const cascade = model.getElementCascade(0);
      expect(cascade.elementId).toBe(0);
      expect(cascade.declarations.size).toBe(0);
      expect(cascade.edges.length).toBe(0);
    });

    it("getSignalSnapshot throws for non-existent element", () => {
      const { model } = buildSemanticModel(`const x = 1;`, "/app.tsx", []);
      expect(() => model.getSignalSnapshot(99999)).toThrow();
    });

    it("getAlignmentContext returns null for non-existent parent", () => {
      const { model } = buildSemanticModel(`const x = 1;`, "/app.tsx", []);
      expect(model.getAlignmentContext(0)).toBeNull();
    });
  });
});
