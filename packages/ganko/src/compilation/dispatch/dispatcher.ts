/**
 * AnalysisDispatcher — tiered rule execution framework.
 *
 * Like Roslyn's CompilationWithAnalyzers + AnalyzerDriver:
 * rules register typed subscriptions, the framework inspects subscriptions
 * to determine the maximum required tier, computes only that tier,
 * and dispatches to subscribers.
 */
import type { Diagnostic } from "../../diagnostic"
import type { StyleCompilation } from "../core/compilation"
import type { SymbolTable } from "../symbols/symbol-table"
import type { FileSemanticModel } from "../binding/semantic-model"
import type { ElementNode } from "../binding/element-builder"
import type { AnalysisRule, Emit } from "./rule"
import { ComputationTier } from "./rule"
import { createActionRegistry, type CollectedActions } from "./registry"
import { resolveMaxTier } from "./tier-resolver"

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[]
  readonly maxTierComputed: ComputationTier
}

export interface AnalysisDispatcher {
  register(rule: AnalysisRule): void
  run(compilation: StyleCompilation): AnalysisResult
  /**
   * Run only on a subset of affected files. Tier 0 CSS syntax actions
   * only fire for affected CSS files. Tier 1+ only fire for affected
   * solid files. Compilation-wide actions always run.
   * Used for incremental re-analysis after a file change.
   */
  runSubset(compilation: StyleCompilation, affectedFiles: ReadonlySet<string>): AnalysisResult
}

export function createAnalysisDispatcher(): AnalysisDispatcher {
  const rules: AnalysisRule[] = []

  function setup() {
    const { registry, actions } = createActionRegistry()
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      if (!rule) continue
      if (rule.severity === "off") continue
      rule.register(registry)
    }
    return { actions, maxTier: resolveMaxTier(rules) }
  }

  function dispatch(
    compilation: StyleCompilation,
    actions: CollectedActions,
    maxTier: ComputationTier,
    emit: Emit,
    affectedFiles: ReadonlySet<string> | null,
  ): void {
    const symbolTable = compilation.symbolTable

    // Tier 0: CSS syntax actions
    if (maxTier >= ComputationTier.CSSSyntax) {
      if (affectedFiles !== null) {
        dispatchCSSSyntaxActionsSubset(actions, compilation, symbolTable, emit, affectedFiles)
      } else {
        dispatchCSSSyntaxActions(actions, compilation, symbolTable, emit)
      }
    }

    // Tier 1: Cross-syntax actions
    if (maxTier >= ComputationTier.CrossSyntax) {
      if (affectedFiles !== null) {
        dispatchCrossSyntaxActionsSubset(actions, compilation, symbolTable, emit, affectedFiles)
      } else {
        dispatchCrossSyntaxActions(actions, compilation, symbolTable, emit)
      }
    }

    // Tier 2+: Element-level actions require semantic model per file
    if (maxTier >= ComputationTier.ElementResolution) {
      const solidFiles = affectedFiles !== null
        ? [...compilation.solidTrees.keys()].filter(p => affectedFiles.has(p))
        : [...compilation.solidTrees.keys()]

      for (let fi = 0; fi < solidFiles.length; fi++) {
        const solidFilePath = solidFiles[fi]
        if (!solidFilePath) continue
        const model = compilation.getSemanticModel(solidFilePath)
        const elements = model.getElementNodes()

        if (maxTier >= ComputationTier.ElementResolution) {
          dispatchElementActions(actions, elements, model, emit)
        }
        if (maxTier >= ComputationTier.SelectiveLayoutFacts) {
          dispatchFactActions(actions, elements, model, emit)
        }
        if (maxTier >= ComputationTier.FullCascade) {
          dispatchCascadeActions(actions, elements, model, emit)
          dispatchConditionalDeltaActions(actions, elements, model, emit)
        }
        if (maxTier >= ComputationTier.AlignmentModel) {
          dispatchAlignmentActions(actions, elements, model, emit)
        }
      }
    }

    // Compilation-wide actions always run
    dispatchCompilationActions(actions, compilation, symbolTable, emit)
  }

  return {
    register(rule: AnalysisRule): void {
      rules.push(rule)
    },

    run(compilation): AnalysisResult {
      const { actions, maxTier } = setup()
      const diagnostics: Diagnostic[] = []
      const emit: Emit = (d) => { diagnostics.push(d) }
      dispatch(compilation, actions, maxTier, emit, null)
      return { diagnostics, maxTierComputed: maxTier }
    },

    runSubset(compilation, affectedFiles): AnalysisResult {
      const { actions, maxTier } = setup()
      const diagnostics: Diagnostic[] = []
      const emit: Emit = (d) => { diagnostics.push(d) }
      dispatch(compilation, actions, maxTier, emit, affectedFiles)
      return { diagnostics, maxTierComputed: maxTier }
    },
  }
}

function dispatchCSSSyntaxActions(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit): void {
  if (actions.cssSyntax.length === 0) return

  for (const [, tree] of compilation.cssTrees) {
    for (let i = 0; i < actions.cssSyntax.length; i++) {
      const action = actions.cssSyntax[i]
      if (action) action(tree, symbolTable, emit)
    }
  }
}

function dispatchCSSSyntaxActionsSubset(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit, affectedFiles: ReadonlySet<string>): void {
  if (actions.cssSyntax.length === 0) return

  for (const [path, tree] of compilation.cssTrees) {
    if (!affectedFiles.has(path)) continue
    for (let i = 0; i < actions.cssSyntax.length; i++) {
      const action = actions.cssSyntax[i]
      if (action) action(tree, symbolTable, emit)
    }
  }
}

function dispatchCrossSyntaxActions(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit): void {
  if (actions.crossSyntax.length === 0) return

  for (const [, solidTree] of compilation.solidTrees) {
    for (let i = 0; i < actions.crossSyntax.length; i++) {
      const action = actions.crossSyntax[i]
      if (action) action(solidTree, symbolTable, emit)
    }
  }
}

function dispatchCrossSyntaxActionsSubset(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit, affectedFiles: ReadonlySet<string>): void {
  if (actions.crossSyntax.length === 0) return

  for (const [path, solidTree] of compilation.solidTrees) {
    if (!affectedFiles.has(path)) continue
    for (let i = 0; i < actions.crossSyntax.length; i++) {
      const action = actions.crossSyntax[i]
      if (action) action(solidTree, symbolTable, emit)
    }
  }
}

function dispatchElementActions(actions: CollectedActions, elements: readonly ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.element.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue
    for (let j = 0; j < actions.element.length; j++) {
      const action = actions.element[j]
      if (action) action(element, model, emit)
    }
  }
}

function dispatchFactActions(actions: CollectedActions, elements: readonly ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.factThunks.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue

    for (let j = 0; j < actions.factThunks.length; j++) {
      const thunk = actions.factThunks[j]
      if (thunk) thunk.dispatch(element, model, model, emit)
    }
  }
}

function dispatchCascadeActions(actions: CollectedActions, elements: readonly ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.cascade.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue
    const cascade = model.getElementCascade(element.elementId)
    const snapshot = model.getSignalSnapshot(element.elementId)
    for (let j = 0; j < actions.cascade.length; j++) {
      const action = actions.cascade[j]
      if (action) action(element, cascade, snapshot, model, emit)
    }
  }
}

function dispatchConditionalDeltaActions(actions: CollectedActions, elements: readonly ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.conditionalDelta.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue
    const delta = model.getConditionalDelta(element.elementId)
    if (delta === null) continue
    for (let j = 0; j < actions.conditionalDelta.length; j++) {
      const action = actions.conditionalDelta[j]
      if (action) action(element, delta, model, emit)
    }
  }
}

function dispatchAlignmentActions(actions: CollectedActions, elements: readonly ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.alignment.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue
    const context = model.getAlignmentContext(element.elementId)
    if (context === null) continue
    const cohort = model.getCohortStats(element.elementId)
    if (cohort === null) continue
    for (let j = 0; j < actions.alignment.length; j++) {
      const action = actions.alignment[j]
      if (action) action(element, context, cohort, model, emit)
    }
  }
}

function dispatchCompilationActions(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit): void {
  if (actions.compilation.length === 0) return

  for (let i = 0; i < actions.compilation.length; i++) {
    const action = actions.compilation[i]
    if (action) action(compilation, symbolTable, emit)
  }
}
