/**
 * CompilationTracker — replaces three-level GraphCache.
 *
 * Like Roslyn's CompilationTracker + SolutionCompilationState:
 * tracks which compilation state is current, which parts are stale,
 * and reuses unchanged parts when building new compilations.
 */
import type { Diagnostic } from "../../diagnostic"
import type { StyleCompilation, TailwindConfigInput } from "../core/compilation"
import type { SymbolTable } from "../symbols/symbol-table"
import type { DeclarationTable } from "../symbols/declaration-table"
import { createDeclarationTable } from "../symbols/declaration-table"
import type { CSSSourceProvider } from "../providers/provider"
import type { TailwindProvider } from "../providers/tailwind"
import type { DependencyGraph } from "./dependency-graph"
import { buildDependencyGraph } from "./dependency-graph"
import { propagateChanges, filterStaleSolidFiles } from "./change-propagation"
import { noopLogger } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import { canonicalPath, matchesExtension, CSS_EXTENSIONS, SOLID_EXTENSIONS } from "@drskillissue/ganko-shared"

// ── Types ────────────────────────────────────────────────────────────────

export type AdditionalInput =
  | TailwindConfigInput
  | { readonly kind: "package-manifest"; readonly filePath: string; readonly version: string }
  | { readonly kind: "tsconfig"; readonly filePath: string; readonly version: string }

export interface CompilationTracker {
  readonly currentCompilation: StyleCompilation
  readonly previousCompilation: StyleCompilation | null

  applyChange(filePath: string, content: string, version: string): CompilationTracker
  applyDeletion(filePath: string): CompilationTracker
  applyInputChange(input: AdditionalInput): CompilationTracker

  getStaleFiles(): ReadonlySet<string>
  getDirectlyChangedFiles(): ReadonlySet<string>
  isSemanticModelValid(filePath: string): boolean

  getCachedCrossFileDiagnostics(filePath: string): readonly Diagnostic[]
  setCachedCrossFileDiagnostics(filePath: string, diagnostics: readonly Diagnostic[]): void
  getCachedCrossFileResults(): ReadonlyMap<string, readonly Diagnostic[]> | null
  setCachedCrossFileResults(allDiagnostics: readonly Diagnostic[]): void
}

export interface CompilationTrackerOptions {
  readonly cssProvider?: CSSSourceProvider
  readonly scssProvider?: CSSSourceProvider
  readonly tailwindProvider?: TailwindProvider
  readonly logger?: Logger
}

// ── Implementation ───────────────────────────────────────────────────────

interface TrackerState {
  readonly compilation: StyleCompilation
  readonly previous: StyleCompilation | null
  readonly declarationTable: DeclarationTable
  readonly symbolTable: SymbolTable
  readonly dependencyGraph: DependencyGraph
  readonly directlyChanged: ReadonlySet<string>
  readonly staleFiles: ReadonlySet<string>
  readonly crossFileDiagnostics: Map<string, readonly Diagnostic[]>
  readonly crossFileResultsGeneration: number
  readonly crossFileResults: ReadonlyMap<string, readonly Diagnostic[]> | null
  readonly generation: number
  readonly logger: Logger
  readonly cssProvider: CSSSourceProvider | null
  readonly scssProvider: CSSSourceProvider | null
}

function buildState(
  compilation: StyleCompilation,
  previous: StyleCompilation | null,
  declarationTable: DeclarationTable,
  directlyChanged: ReadonlySet<string>,
  crossFileDiagnostics: Map<string, readonly Diagnostic[]>,
  crossFileResultsGeneration: number,
  crossFileResults: ReadonlyMap<string, readonly Diagnostic[]> | null,
  generation: number,
  logger: Logger,
  cssProvider: CSSSourceProvider | null,
  scssProvider: CSSSourceProvider | null,
): TrackerState {
  const symbolTable = declarationTable.materialize()
  const dependencyGraph = buildDependencyGraph(compilation.solidTrees, compilation.cssTrees)

  const propagation = propagateChanges(directlyChanged, dependencyGraph, compilation)
  const filteredStale = filterStaleSolidFiles(propagation.allStale, compilation)
  // Directly changed files are always stale, even if removed from compilation
  // (e.g. when no parser is provided to re-add them)
  const staleFiles = new Set(filteredStale)
  for (const f of directlyChanged) staleFiles.add(f)

  return {
    compilation,
    previous,
    declarationTable,
    symbolTable,
    dependencyGraph,
    directlyChanged,
    staleFiles,
    crossFileDiagnostics,
    crossFileResultsGeneration,
    crossFileResults: crossFileResultsGeneration === generation ? crossFileResults : null,
    generation,
    logger,
    cssProvider,
    scssProvider,
  }
}

function createTrackerFromState(state: TrackerState): CompilationTracker {
  return {
    currentCompilation: state.compilation,
    previousCompilation: state.previous,

    applyChange(filePath: string, content: string, _version: string): CompilationTracker {
      const key = canonicalPath(filePath)
      const isCss = matchesExtension(key, CSS_EXTENSIONS)
      const isSolid = matchesExtension(key, SOLID_EXTENSIONS)

      // Step 1: Remove old tree
      let nextCompilation = state.compilation
      let nextDeclarationTable = state.declarationTable

      if (isCss) {
        nextCompilation = nextCompilation.withoutFile(key)
        nextDeclarationTable = nextDeclarationTable.withoutTree(key)
      }
      if (isSolid) {
        nextCompilation = nextCompilation.withoutFile(key)
      }

      // Step 2: Parse new content into syntax tree via provider and add to compilation
      if (isCss) {
        const provider = key.endsWith(".scss") ? state.scssProvider : state.cssProvider
        if (provider !== null) {
          const sourceOrderBase = nextCompilation.cssTrees.size * 10000
          const newTree = provider.parse(key, content, sourceOrderBase)
          nextCompilation = nextCompilation.withCSSTree(newTree)
          nextDeclarationTable = nextDeclarationTable.withTree(newTree)
        }
      }
      // Solid files require a TypeScript program for parsing — the caller
      // provides the parsed tree externally via compilation.withSolidTree()
      // before or after calling applyChange. The tracker handles invalidation.

      // Step 3-5: Propagate changes, invalidate, return new tracker
      const nextDirectlyChanged = new Set(state.directlyChanged)
      nextDirectlyChanged.add(key)

      const nextCrossFileDiagnostics = new Map(state.crossFileDiagnostics)
      nextCrossFileDiagnostics.delete(key)

      return createTrackerFromState(buildState(
        nextCompilation,
        state.compilation,
        nextDeclarationTable,
        nextDirectlyChanged,
        nextCrossFileDiagnostics,
        state.crossFileResultsGeneration,
        state.crossFileResults,
        state.generation + 1,
        state.logger,
        state.cssProvider,
        state.scssProvider,
      ))
    },

    applyDeletion(filePath: string): CompilationTracker {
      const key = canonicalPath(filePath)
      let nextCompilation = state.compilation.withoutFile(key)
      let nextDeclarationTable = state.declarationTable.withoutTree(key)

      const nextDirectlyChanged = new Set(state.directlyChanged)
      nextDirectlyChanged.add(key)

      const nextCrossFileDiagnostics = new Map(state.crossFileDiagnostics)
      nextCrossFileDiagnostics.delete(key)

      return createTrackerFromState(buildState(
        nextCompilation,
        state.compilation,
        nextDeclarationTable,
        nextDirectlyChanged,
        nextCrossFileDiagnostics,
        state.crossFileResultsGeneration,
        state.crossFileResults,
        state.generation + 1,
        state.logger,
        state.cssProvider,
        state.scssProvider,
      ))
    },

    applyInputChange(_input: AdditionalInput): CompilationTracker {
      // Input changes (tailwind config, package manifest, tsconfig) invalidate everything
      const allSolidFiles = new Set<string>()
      for (const key of state.compilation.solidTrees.keys()) allSolidFiles.add(key)
      for (const key of state.compilation.cssTrees.keys()) allSolidFiles.add(key)

      return createTrackerFromState(buildState(
        state.compilation,
        state.compilation,
        state.declarationTable,
        allSolidFiles,
        new Map(),
        state.generation + 1,
        null,
        state.generation + 1,
        state.logger,
        state.cssProvider,
        state.scssProvider,
      ))
    },

    getStaleFiles(): ReadonlySet<string> {
      return state.staleFiles
    },

    getDirectlyChangedFiles(): ReadonlySet<string> {
      return state.directlyChanged
    },

    isSemanticModelValid(filePath: string): boolean {
      return !state.staleFiles.has(canonicalPath(filePath))
    },

    getCachedCrossFileDiagnostics(filePath: string): readonly Diagnostic[] {
      return state.crossFileDiagnostics.get(canonicalPath(filePath)) ?? []
    },

    setCachedCrossFileDiagnostics(filePath: string, diagnostics: readonly Diagnostic[]): void {
      state.crossFileDiagnostics.set(canonicalPath(filePath), diagnostics)
    },

    getCachedCrossFileResults(): ReadonlyMap<string, readonly Diagnostic[]> | null {
      if (state.crossFileResultsGeneration !== state.generation) return null
      return state.crossFileResults
    },

    setCachedCrossFileResults(allDiagnostics: readonly Diagnostic[]): void {
      const byFile = new Map<string, Diagnostic[]>()
      for (let i = 0; i < allDiagnostics.length; i++) {
        const d = allDiagnostics[i]
        if (!d) continue
        let arr = byFile.get(d.file)
        if (!arr) { arr = []; byFile.set(d.file, arr) }
        arr.push(d)
      }
      ;(state as { crossFileResults: ReadonlyMap<string, readonly Diagnostic[]> | null }).crossFileResults = byFile
      ;(state as { crossFileResultsGeneration: number }).crossFileResultsGeneration = state.generation

      state.crossFileDiagnostics.clear()
      for (const [file, diagnostics] of byFile) {
        state.crossFileDiagnostics.set(file, diagnostics)
      }
    },
  }
}

export function createCompilationTracker(
  compilation: StyleCompilation,
  options?: CompilationTrackerOptions,
): CompilationTracker {
  const logger = options?.logger ?? noopLogger

  // Build initial declaration table from all CSS trees
  let declarationTable = createDeclarationTable()
  for (const [, tree] of compilation.cssTrees) {
    declarationTable = declarationTable.withTree(tree)
  }

  const state = buildState(
    compilation,
    null,
    declarationTable,
    new Set(),
    new Map(),
    0,
    null,
    0,
    logger,
    options?.cssProvider ?? null,
    options?.scssProvider ?? null,
  )

  return createTrackerFromState(state)
}
