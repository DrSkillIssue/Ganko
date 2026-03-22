import { describe, expect, it } from "vitest"
import { buildGraph as buildSolidGraph } from "../solid/test-utils"
import { buildTrees as buildCSSTrees } from "../css/test-utils"
import { createCompilationFromLegacy } from "../../src/compilation/core/compilation"
import { createCompilationTracker } from "../../src/compilation/incremental/tracker"
import { propagateChanges, filterStaleSolidFiles } from "../../src/compilation/incremental/change-propagation"
import { buildDependencyGraph } from "../../src/compilation/incremental/dependency-graph"

function buildTestCompilation() {
  const solidTree = buildSolidGraph(`
    import "./app.css";
    function App() {
      return <div class="container">Hello</div>;
    }
  `, "/src/app.tsx")
  const cssTrees = buildCSSTrees(`.container { width: 100%; }`, "/src/app.css")

  return createCompilationFromLegacy([solidTree], cssTrees)
}

describe("Phase 10: Incremental Updates", () => {

  describe("CompilationTracker — creation", () => {
    it("creates tracker from compilation", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.currentCompilation).toBe(compilation)
      expect(tracker.previousCompilation).toBeNull()
    })

    it("exposes symbolTable via currentCompilation", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.currentCompilation.symbolTable).toBeDefined()
      expect(tracker.currentCompilation.symbolTable.classNames).toBeDefined()
    })

    it("exposes dependencyGraph via currentCompilation", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.currentCompilation.dependencyGraph).toBeDefined()
      expect(typeof tracker.currentCompilation.dependencyGraph.getCSSScope).toBe("function")
    })

    it("initially has no stale files", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.getStaleFiles().size).toBe(0)
    })

    it("initially has no directly changed files", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.getDirectlyChangedFiles().size).toBe(0)
    })
  })

  describe("CompilationTracker — applyChange", () => {
    it("marks changed CSS file as directly changed", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyChange("/src/app.css", ".container { width: 50%; }", "v2")
      expect(next.getDirectlyChangedFiles().has("/src/app.css")).toBe(true)
    })

    it("marks changed Solid file as directly changed", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyChange("/src/app.tsx", "export default function() { return <div/>; }", "v2")
      expect(next.getDirectlyChangedFiles().has("/src/app.tsx")).toBe(true)
    })

    it("preserves previous compilation", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyChange("/src/app.css", ".container { width: 50%; }", "v2")
      expect(next.previousCompilation).toBe(compilation)
    })

    it("returns new tracker (immutable)", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyChange("/src/app.css", ".container { width: 50%; }", "v2")
      expect(next).not.toBe(tracker)
      expect(tracker.getDirectlyChangedFiles().size).toBe(0)
    })
  })

  describe("CompilationTracker — applyDeletion", () => {
    it("marks deleted file as directly changed", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyDeletion("/src/app.css")
      expect(next.getDirectlyChangedFiles().has("/src/app.css")).toBe(true)
    })

    it("removes file from compilation", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyDeletion("/src/app.css")
      expect(next.currentCompilation.getCSSTree("/src/app.css")).toBeNull()
    })
  })

  describe("CompilationTracker — isSemanticModelValid", () => {
    it("returns true for unchanged files", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.isSemanticModelValid("/src/app.tsx")).toBe(true)
    })

    it("returns false for directly changed files", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const next = tracker.applyChange("/src/app.tsx", "changed", "v2")
      expect(next.isSemanticModelValid("/src/app.tsx")).toBe(false)
    })
  })

  describe("CompilationTracker — diagnostic caching (Constraint 14)", () => {
    it("getCachedCrossFileDiagnostics returns empty array by default", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.getCachedCrossFileDiagnostics("/src/app.tsx")).toEqual([])
    })

    it("setCachedCrossFileDiagnostics stores and retrieves diagnostics", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const diag = { file: "/src/app.tsx", rule: "test", messageId: "test", message: "test", severity: "warn" as const, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } }
      tracker.setCachedCrossFileDiagnostics("/src/app.tsx", [diag])
      expect(tracker.getCachedCrossFileDiagnostics("/src/app.tsx")).toEqual([diag])
    })

    it("getCachedCrossFileResults returns null initially", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      expect(tracker.getCachedCrossFileResults()).toBeNull()
    })

    it("setCachedCrossFileResults stores and retrieves results", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const diag = { file: "/src/app.tsx", rule: "test", messageId: "test", message: "test", severity: "warn" as const, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } }
      tracker.setCachedCrossFileResults([diag])
      const results = tracker.getCachedCrossFileResults()
      expect(results).not.toBeNull()
      expect(results!.get("/src/app.tsx")).toEqual([diag])
    })

    it("applyChange invalidates cross-file diagnostics for changed file", () => {
      const compilation = buildTestCompilation()
      const tracker = createCompilationTracker(compilation)
      const diag = { file: "/src/app.tsx", rule: "test", messageId: "test", message: "test", severity: "warn" as const, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } }
      tracker.setCachedCrossFileDiagnostics("/src/app.tsx", [diag])
      const next = tracker.applyChange("/src/app.tsx", "changed", "v2")
      expect(next.getCachedCrossFileDiagnostics("/src/app.tsx")).toEqual([])
    })
  })

  describe("change-propagation — propagateChanges", () => {
    it("CSS change propagates to importing Solid files", () => {
      const compilation = buildTestCompilation()
      const depGraph = buildDependencyGraph(compilation.solidTrees, compilation.cssTrees)
      const result = propagateChanges(new Set(["/src/app.css"]), depGraph, compilation)
      expect(result.directlyChanged.has("/src/app.css")).toBe(true)
    })

    it("Solid-only change does not propagate", () => {
      const compilation = buildTestCompilation()
      const depGraph = buildDependencyGraph(compilation.solidTrees, compilation.cssTrees)
      const result = propagateChanges(new Set(["/src/app.tsx"]), depGraph, compilation)
      expect(result.directlyChanged.has("/src/app.tsx")).toBe(true)
      expect(result.transitivelyAffected.size).toBe(0)
    })
  })

  describe("change-propagation — filterStaleSolidFiles", () => {
    it("filters to only Solid files in compilation", () => {
      const compilation = buildTestCompilation()
      const stale = new Set(["/src/app.tsx", "/src/app.css", "/nonexistent.tsx"])
      const filtered = filterStaleSolidFiles(stale, compilation)
      expect(filtered.has("/src/app.tsx")).toBe(true)
      expect(filtered.has("/src/app.css")).toBe(false)
      expect(filtered.has("/nonexistent.tsx")).toBe(false)
    })
  })

  describe("StyleCompilation — wired symbolTable and dependencyGraph", () => {
    it("symbolTable lazily builds from CSS trees", () => {
      const compilation = buildTestCompilation()
      const table = compilation.symbolTable
      expect(table.classNames.has("container")).toBe(true)
    })

    it("dependencyGraph lazily builds from all trees", () => {
      const compilation = buildTestCompilation()
      const graph = compilation.dependencyGraph
      expect(typeof graph.getCSSScope).toBe("function")
      expect(typeof graph.getTransitivelyAffected).toBe("function")
    })

    it("getSemanticModel returns model for existing solid file", () => {
      const compilation = buildTestCompilation()
      const solidPath = [...compilation.solidTrees.keys()][0]!
      const model = compilation.getSemanticModel(solidPath)
      expect(model).toBeDefined()
      expect(model.filePath).toBe(solidPath)
    })

    it("getSemanticModel caches across calls", () => {
      const compilation = buildTestCompilation()
      const solidPath = [...compilation.solidTrees.keys()][0]!
      const model1 = compilation.getSemanticModel(solidPath)
      const model2 = compilation.getSemanticModel(solidPath)
      expect(model1).toBe(model2)
    })

    it("symbolTable is cached across accesses", () => {
      const compilation = buildTestCompilation()
      const table1 = compilation.symbolTable
      const table2 = compilation.symbolTable
      expect(table1).toBe(table2)
    })
  })
})
