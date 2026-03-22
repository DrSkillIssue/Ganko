import { describe, expect, it } from "vitest";
import { buildGraph as buildSolidGraph } from "../solid/test-utils";
import { buildGraph as buildCSSGraph, buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import { solidGraphToSyntaxTree } from "../../src/compilation/core/solid-syntax-tree";
import { cssGraphToSyntaxTrees } from "../../src/compilation/core/css-syntax-tree";
import { createStyleCompilation, createCompilationFromLegacy } from "../../src/compilation/core/compilation";

// ═══════════════════════════════════════════════════════════════
// Step 1.7 — Validation Gate
// ═══════════════════════════════════════════════════════════════

describe("Phase 1: Compilation Shell", () => {

  // ── Table 1A reference-equality checks ──
  describe("solidGraphToSyntaxTree — zero-copy reference equality", () => {
    const graph = buildSolidGraph(`
      import { createSignal } from "solid-js";
      function App() {
        const [count, setCount] = createSignal(0);
        return <div class="app">{count()}</div>;
      }
    `);
    const tree = solidGraphToSyntaxTree(graph, "v1");

    it("kind and filePath", () => {
      expect(tree.kind).toBe("solid");
      expect(tree.filePath).toBe(graph.file);
      expect(tree.version).toBe("v1");
    });

    // Entity collections (Table 1A rows 19-36)
    it("tree.scopes === graph.scopes", () => { expect(tree.scopes).toBe(graph.scopes); });
    it("tree.variables === graph.variables", () => { expect(tree.variables).toBe(graph.variables); });
    it("tree.functions === graph.functions", () => { expect(tree.functions).toBe(graph.functions); });
    it("tree.calls === graph.calls", () => { expect(tree.calls).toBe(graph.calls); });
    it("tree.jsxElements === graph.jsxElements", () => { expect(tree.jsxElements).toBe(graph.jsxElements); });
    it("tree.imports === graph.imports", () => { expect(tree.imports).toBe(graph.imports); });
    it("tree.exports === graph.exports", () => { expect(tree.exports).toBe(graph.exports); });
    it("tree.classes === graph.classes", () => { expect(tree.classes).toBe(graph.classes); });
    it("tree.properties === graph.properties", () => { expect(tree.properties).toBe(graph.properties); });
    it("tree.propertyAssignments === graph.propertyAssignments", () => { expect(tree.propertyAssignments).toBe(graph.propertyAssignments); });
    it("tree.conditionalSpreads === graph.conditionalSpreads", () => { expect(tree.conditionalSpreads).toBe(graph.conditionalSpreads); });
    it("tree.objectSpreads === graph.objectSpreads", () => { expect(tree.objectSpreads).toBe(graph.objectSpreads); });
    it("tree.nonNullAssertions === graph.nonNullAssertions", () => { expect(tree.nonNullAssertions).toBe(graph.nonNullAssertions); });
    it("tree.typeAssertions === graph.typeAssertions", () => { expect(tree.typeAssertions).toBe(graph.typeAssertions); });
    it("tree.typePredicates === graph.typePredicates", () => { expect(tree.typePredicates).toBe(graph.typePredicates); });
    it("tree.unsafeGenericAssertions === graph.unsafeGenericAssertions", () => { expect(tree.unsafeGenericAssertions).toBe(graph.unsafeGenericAssertions); });
    it("tree.unsafeTypeAnnotations === graph.unsafeTypeAnnotations", () => { expect(tree.unsafeTypeAnnotations).toBe(graph.unsafeTypeAnnotations); });
    it("tree.inlineImports === graph.inlineImports", () => { expect(tree.inlineImports).toBe(graph.inlineImports); });
    it("tree.computations === graph.computations", () => { expect(tree.computations).toBe(graph.computations); });
    it("tree.dependencyEdges === graph.dependencyEdges", () => { expect(tree.dependencyEdges).toBe(graph.dependencyEdges); });
    it("tree.ownershipEdges === graph.ownershipEdges", () => { expect(tree.ownershipEdges).toBe(graph.ownershipEdges); });

    // Index maps (Table 1A rows 37-68)
    it("tree.variablesByName === graph.variablesByName", () => { expect(tree.variablesByName).toBe(graph.variablesByName); });
    it("tree.functionsByNode === graph.functionsByNode", () => { expect(tree.functionsByNode).toBe(graph.functionsByNode); });
    it("tree.functionsByDeclarationNode === graph.functionsByDeclarationNode", () => { expect(tree.functionsByDeclarationNode).toBe(graph.functionsByDeclarationNode); });
    it("tree.functionsByName === graph.functionsByName", () => { expect(tree.functionsByName).toBe(graph.functionsByName); });
    it("tree.callsByNode === graph.callsByNode", () => { expect(tree.callsByNode).toBe(graph.callsByNode); });
    it("tree.callsByPrimitive === graph.callsByPrimitive", () => { expect(tree.callsByPrimitive).toBe(graph.callsByPrimitive); });
    it("tree.callsByMethodName === graph.callsByMethodName", () => { expect(tree.callsByMethodName).toBe(graph.callsByMethodName); });
    it("tree.callsByArgNode === graph.callsByArgNode", () => { expect(tree.callsByArgNode).toBe(graph.callsByArgNode); });
    it("tree.jsxByNode === graph.jsxByNode", () => { expect(tree.jsxByNode).toBe(graph.jsxByNode); });
    it("tree.jsxByTag === graph.jsxByTag", () => { expect(tree.jsxByTag).toBe(graph.jsxByTag); });
    it("tree.jsxAttributesByElementId === graph.jsxAttributesByElementId", () => { expect(tree.jsxAttributesByElementId).toBe(graph.jsxAttributesByElementId); });
    it("tree.jsxAttrsByKind === graph.jsxAttrsByKind", () => { expect(tree.jsxAttrsByKind).toBe(graph.jsxAttrsByKind); });
    it("tree.jsxClassAttributes === graph.jsxClassAttributes", () => { expect(tree.jsxClassAttributes).toBe(graph.jsxClassAttributes); });
    it("tree.jsxClassListAttributes === graph.jsxClassListAttributes", () => { expect(tree.jsxClassListAttributes).toBe(graph.jsxClassListAttributes); });
    it("tree.jsxStyleAttributes === graph.jsxStyleAttributes", () => { expect(tree.jsxStyleAttributes).toBe(graph.jsxStyleAttributes); });
    it("tree.fillImageElements === graph.fillImageElements", () => { expect(tree.fillImageElements).toBe(graph.fillImageElements); });
    it("tree.staticClassTokensByElementId === graph.staticClassTokensByElementId", () => { expect(tree.staticClassTokensByElementId).toBe(graph.staticClassTokensByElementId); });
    it("tree.staticClassListKeysByElementId === graph.staticClassListKeysByElementId", () => { expect(tree.staticClassListKeysByElementId).toBe(graph.staticClassListKeysByElementId); });
    it("tree.staticStyleKeysByElementId === graph.staticStyleKeysByElementId", () => { expect(tree.staticStyleKeysByElementId).toBe(graph.staticStyleKeysByElementId); });
    it("tree.classListProperties === graph.classListProperties", () => { expect(tree.classListProperties).toBe(graph.classListProperties); });
    it("tree.styleProperties === graph.styleProperties", () => { expect(tree.styleProperties).toBe(graph.styleProperties); });
    it("tree.inlineStyleClassNames === graph.inlineStyleClassNames", () => { expect(tree.inlineStyleClassNames).toBe(graph.inlineStyleClassNames); });
    it("tree.importsBySource === graph.importsBySource", () => { expect(tree.importsBySource).toBe(graph.importsBySource); });
    it("tree.exportsByName === graph.exportsByName", () => { expect(tree.exportsByName).toBe(graph.exportsByName); });
    it("tree.exportsByEntityId === graph.exportsByEntityId", () => { expect(tree.exportsByEntityId).toBe(graph.exportsByEntityId); });
    it("tree.classesByNode === graph.classesByNode", () => { expect(tree.classesByNode).toBe(graph.classesByNode); });
    it("tree.classesByName === graph.classesByName", () => { expect(tree.classesByName).toBe(graph.classesByName); });
    it("tree.unaryExpressionsByOperator === graph.unaryExpressionsByOperator", () => { expect(tree.unaryExpressionsByOperator).toBe(graph.unaryExpressionsByOperator); });
    it("tree.spreadElements === graph.spreadElements", () => { expect(tree.spreadElements).toBe(graph.spreadElements); });
    it("tree.newExpressionsByCallee === graph.newExpressionsByCallee", () => { expect(tree.newExpressionsByCallee).toBe(graph.newExpressionsByCallee); });
    it("tree.deleteExpressions === graph.deleteExpressions", () => { expect(tree.deleteExpressions).toBe(graph.deleteExpressions); });
    it("tree.identifiersByName === graph.identifiersByName", () => { expect(tree.identifiersByName).toBe(graph.identifiersByName); });

    // Reactive categorization (Table 1A rows 70-82)
    it("tree.firstScope === graph.firstScope", () => { expect(tree.firstScope).toBe(graph.firstScope); });
    it("tree.componentScopes === graph.componentScopes", () => { expect(tree.componentScopes).toBe(graph.componentScopes); });
    it("tree.componentFunctions === graph.componentFunctions", () => { expect(tree.componentFunctions).toBe(graph.componentFunctions); });
    it("tree.functionsWithReactiveCaptures === graph.functionsWithReactiveCaptures", () => { expect(tree.functionsWithReactiveCaptures).toBe(graph.functionsWithReactiveCaptures); });
    it("tree.reactiveVariables === graph.reactiveVariables", () => { expect(tree.reactiveVariables).toBe(graph.reactiveVariables); });
    it("tree.propsVariables === graph.propsVariables", () => { expect(tree.propsVariables).toBe(graph.propsVariables); });
    it("tree.storeVariables === graph.storeVariables", () => { expect(tree.storeVariables).toBe(graph.storeVariables); });
    it("tree.resourceVariables === graph.resourceVariables", () => { expect(tree.resourceVariables).toBe(graph.resourceVariables); });
    it("tree.variablesWithPropertyAssignment === graph.variablesWithPropertyAssignment", () => { expect(tree.variablesWithPropertyAssignment).toBe(graph.variablesWithPropertyAssignment); });
    it("tree.computationByCallId === graph.computationByCallId", () => { expect(tree.computationByCallId).toBe(graph.computationByCallId); });

    // Scalar fields (Table 1A rows 4-7)
    it("tree.sourceFile === graph.sourceFile", () => { expect(tree.sourceFile).toBe(graph.sourceFile); });
    it("tree.typeResolver === graph.typeResolver", () => { expect(tree.typeResolver).toBe(graph.typeResolver); });
    it("tree.fileEntity === graph.fileEntity", () => { expect(tree.fileEntity).toBe(graph.fileEntity); });
    it("tree.comments === graph.comments", () => { expect(tree.comments).toBe(graph.comments); });

    // Getter/method (Table 1A rows 127-128)
    it("lineStartOffsets computed", () => {
      expect(tree.lineStartOffsets.length).toBeGreaterThan(0);
      expect(tree.lineStartOffsets[0]).toBe(0);
    });
  });

  // ── CSS partitioning checks ──
  describe("cssGraphToSyntaxTrees — per-file partitioning", () => {
    it("produces one tree per file", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; }" },
        { path: "/b.css", content: ".b { color: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      expect(trees.length).toBe(graph.files.length);
    });

    it("each tree's selectors come only from that file", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; }\n.a2 { font-size: 1rem; }" },
        { path: "/b.css", content: ".b { color: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      const treeA = trees.find(t => t.filePath === "/a.css")!;
      const treeB = trees.find(t => t.filePath === "/b.css")!;

      expect(treeA.selectors.length).toBe(2);
      expect(treeB.selectors.length).toBe(1);
    });

    it("classNameIndex keys are per-file subset", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; }" },
        { path: "/b.css", content: ".b { color: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      const treeA = trees.find(t => t.filePath === "/a.css")!;
      const treeB = trees.find(t => t.filePath === "/b.css")!;

      expect(treeA.classNameIndex.has("a")).toBe(true);
      expect(treeA.classNameIndex.has("b")).toBe(false);
      expect(treeB.classNameIndex.has("b")).toBe(true);
      expect(treeB.classNameIndex.has("a")).toBe(false);
    });

    it("declarations partitioned by file", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a { color: red; font-size: 1rem; }" },
        { path: "/b.css", content: ".b { margin: 0; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      const treeA = trees.find(t => t.filePath === "/a.css")!;
      const treeB = trees.find(t => t.filePath === "/b.css")!;

      expect(treeA.declarations.length).toBe(2);
      expect(treeB.declarations.length).toBe(1);
    });

    it("variables partitioned by file", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ":root { --a: red; }" },
        { path: "/b.css", content: ":root { --b: blue; }" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      const treeA = trees.find(t => t.filePath === "/a.css")!;
      const treeB = trees.find(t => t.filePath === "/b.css")!;

      expect(treeA.variablesByName.has("--a")).toBe(true);
      expect(treeA.variablesByName.has("--b")).toBe(false);
      expect(treeB.variablesByName.has("--b")).toBe(true);
    });

    it("each tree has unique sourceOrderBase", () => {
      const graph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a {}" },
        { path: "/b.css", content: ".b {}" },
        { path: "/c.css", content: ".c {}" },
      ]);
      const trees = cssGraphToSyntaxTrees(graph);
      const bases = new Set(trees.map(t => t.sourceOrderBase));
      expect(bases.size).toBe(trees.length);
    });
  });

  // ── StyleCompilation structural sharing checks ──
  describe("StyleCompilation — immutability and structural sharing", () => {
    it("creates empty compilation", () => {
      const comp = createStyleCompilation();
      expect(comp.solidTrees.size).toBe(0);
      expect(comp.cssTrees.size).toBe(0);
      expect(comp.tailwindConfig).toBeNull();
      expect(comp.id).toBeGreaterThan(0);
    });

    it("withSolidTree adds tree, getSolidTree retrieves", () => {
      const graph = buildSolidGraph(`const x = 1;`);
      const tree = solidGraphToSyntaxTree(graph, "v1");
      const comp = createStyleCompilation().withSolidTree(tree);
      expect(comp.getSolidTree(tree.filePath)).toBe(tree);
    });

    it("comp.withSolidTree(tree).cssTrees === comp.cssTrees (structural sharing)", () => {
      const cssGraph = buildCSSGraph(".a { color: red; }");
      const cssTrees = cssGraphToSyntaxTrees(cssGraph);
      const solidGraph = buildSolidGraph(`const x = 1;`);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");

      const comp = createStyleCompilation().withCSSTrees(cssTrees);
      const comp2 = comp.withSolidTree(solidTree);
      expect(comp2.cssTrees).toBe(comp.cssTrees);
    });

    it("comp.withCSSTree(tree).solidTrees === comp.solidTrees (structural sharing)", () => {
      const solidGraph = buildSolidGraph(`const x = 1;`);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
      const cssGraph = buildCSSGraph(".a { color: red; }");
      const cssTree = cssGraphToSyntaxTrees(cssGraph)[0]!;

      const comp = createStyleCompilation().withSolidTree(solidTree);
      const comp2 = comp.withCSSTree(cssTree);
      expect(comp2.solidTrees).toBe(comp.solidTrees);
    });

    it("withoutFile removes solid tree", () => {
      const graph = buildSolidGraph(`const x = 1;`);
      const tree = solidGraphToSyntaxTree(graph, "v1");
      const comp = createStyleCompilation().withSolidTree(tree);
      const comp2 = comp.withoutFile(tree.filePath);
      expect(comp2.getSolidTree(tree.filePath)).toBeNull();
    });

    it("withoutFile returns same instance if path not found (identity)", () => {
      const comp = createStyleCompilation();
      const comp2 = comp.withoutFile("/nonexistent.ts");
      expect(comp2).toBe(comp);
    });

    it("withFile dispatches by tree.kind", () => {
      const solidGraph = buildSolidGraph(`const x = 1;`);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
      const cssGraph = buildCSSGraph(".a { color: red; }");
      const cssTree = cssGraphToSyntaxTrees(cssGraph)[0]!;

      const comp = createStyleCompilation()
        .withFile(solidTree.filePath, solidTree)
        .withFile(cssTree.filePath, cssTree);

      expect(comp.getSolidTree(solidTree.filePath)).toBe(solidTree);
      expect(comp.getCSSTree(cssTree.filePath)).toBe(cssTree);
    });

    it("each with* produces strictly greater id (monotonicity)", () => {
      const comp1 = createStyleCompilation();
      const graph = buildSolidGraph(`const x = 1;`);
      const tree = solidGraphToSyntaxTree(graph, "v1");
      const comp2 = comp1.withSolidTree(tree);
      const comp3 = comp2.withoutFile(tree.filePath);

      expect(comp2.id).toBeGreaterThan(comp1.id);
      expect(comp3.id).toBeGreaterThan(comp2.id);
    });

    it("getSolidFilePaths and getCSSFilePaths", () => {
      const solidGraph = buildSolidGraph(`const x = 1;`);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");
      const cssGraph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".a {}" },
        { path: "/b.css", content: ".b {}" },
      ]);
      const cssTrees = cssGraphToSyntaxTrees(cssGraph);

      const comp = createStyleCompilation().withSolidTree(solidTree).withCSSTrees(cssTrees);
      expect(comp.getSolidFilePaths()).toEqual([solidTree.filePath]);
      expect([...comp.getCSSFilePaths()].sort()).toEqual(["/a.css", "/b.css"]);
    });

    it("symbolTable throws Phase 2 error", () => {
      const comp = createStyleCompilation();
      expect(() => comp.symbolTable).toThrow("Phase 2");
    });

    it("dependencyGraph throws Phase 3 error", () => {
      const comp = createStyleCompilation();
      expect(() => comp.dependencyGraph).toThrow("Phase 3");
    });

    it("getSemanticModel throws Phase 5 error", () => {
      const comp = createStyleCompilation();
      expect(() => comp.getSemanticModel("test.tsx")).toThrow("Phase 5");
    });
  });

  // ── Round-trip check ──
  describe("createCompilationFromLegacy — round-trip", () => {
    it("preserves all trees with reference equality", () => {
      const solidGraph = buildSolidGraph(`
        import { createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          return <div class="app">{count()}</div>;
        }
      `);
      const solidTree = solidGraphToSyntaxTree(solidGraph, "v1");

      const cssGraph = buildCSSGraphMultiple([
        { path: "/a.css", content: ".app { color: red; }\n.btn { padding: 8px; }" },
        { path: "/b.css", content: ":root { --color: blue; }" },
      ]);
      const cssTrees = cssGraphToSyntaxTrees(cssGraph);

      const comp = createCompilationFromLegacy([solidTree], cssTrees);

      // Solid tree reference equality
      const retrieved = comp.getSolidTree(solidGraph.file);
      expect(retrieved).toBe(solidTree);
      expect(retrieved!.scopes).toBe(solidGraph.scopes);
      expect(retrieved!.jsxElements).toBe(solidGraph.jsxElements);
      expect(retrieved!.imports).toBe(solidGraph.imports);
      expect(retrieved!.variablesByName).toBe(solidGraph.variablesByName);
      expect(retrieved!.componentScopes).toBe(solidGraph.componentScopes);
      expect(retrieved!.reactiveVariables).toBe(solidGraph.reactiveVariables);
      expect(retrieved!.computationByCallId).toBe(solidGraph.computationByCallId);
      expect(retrieved!.sourceFile).toBe(solidGraph.sourceFile);
      expect(retrieved!.typeResolver).toBe(solidGraph.typeResolver);
      expect(retrieved!.fileEntity).toBe(solidGraph.fileEntity);

      // CSS trees preserved
      expect(comp.cssTrees.size).toBe(2);
      const cssA = comp.getCSSTree("/a.css");
      expect(cssA).not.toBeNull();
      expect(cssA!.classNameIndex.has("app")).toBe(true);
      expect(cssA!.classNameIndex.has("btn")).toBe(true);

      const cssB = comp.getCSSTree("/b.css");
      expect(cssB).not.toBeNull();
      expect(cssB!.variablesByName.has("--color")).toBe(true);
    });
  });
});
