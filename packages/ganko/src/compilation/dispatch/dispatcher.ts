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
}

export function createAnalysisDispatcher(): AnalysisDispatcher {
  const rules: AnalysisRule[] = []

  return {
    register(rule: AnalysisRule): void {
      rules.push(rule)
    },

    run(compilation): AnalysisResult {
      const symbolTable = compilation.symbolTable
      const createSemanticModel = (solidFilePath: string) => compilation.getSemanticModel(solidFilePath)
      const { registry, actions } = createActionRegistry()

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        if (!rule) continue
        if (rule.severity === "off") continue
        rule.register(registry)
      }

      const maxTier = resolveMaxTier(rules)
      const diagnostics: Diagnostic[] = []
      const emit: Emit = (d) => { diagnostics.push(d) }

      // Tier 0: CSS syntax actions
      if (maxTier >= ComputationTier.CSSSyntax) {
        dispatchCSSSyntaxActions(actions, compilation, symbolTable, emit)
      }

      // Tier 1: Cross-syntax actions
      if (maxTier >= ComputationTier.CrossSyntax) {
        dispatchCrossSyntaxActions(actions, compilation, symbolTable, emit)
      }

      // Tier 2+: Element-level actions require semantic model per file
      if (maxTier >= ComputationTier.ElementResolution) {
        for (const solidFilePath of compilation.solidTrees.keys()) {
          const model = createSemanticModel(solidFilePath)
          const elements = model.getElementNodes()

          // Tier 2: Element actions
          if (maxTier >= ComputationTier.ElementResolution) {
            dispatchElementActions(actions, elements, model, emit)
          }

          // Tier 3: Fact actions
          if (maxTier >= ComputationTier.SelectiveLayoutFacts) {
            dispatchFactActions(actions, elements, model, emit)
          }

          // Tier 4: Cascade + conditional delta actions
          if (maxTier >= ComputationTier.FullCascade) {
            dispatchCascadeActions(actions, elements, model, emit)
            dispatchConditionalDeltaActions(actions, elements, model, emit)
          }

          // Tier 5: Alignment actions
          if (maxTier >= ComputationTier.AlignmentModel) {
            dispatchAlignmentActions(actions, elements, model, emit)
          }
        }
      }

      // Compilation-wide actions (run after all per-file dispatch)
      dispatchCompilationActions(actions, compilation, symbolTable, emit)

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

function dispatchCrossSyntaxActions(actions: CollectedActions, compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit): void {
  if (actions.crossSyntax.length === 0) return

  for (const [, solidTree] of compilation.solidTrees) {
    for (let i = 0; i < actions.crossSyntax.length; i++) {
      const action = actions.crossSyntax[i]
      if (action) action(solidTree, symbolTable, emit)
    }
  }
}

function dispatchElementActions(actions: CollectedActions, elements: readonly import("../binding/element-builder").ElementNode[], model: FileSemanticModel, emit: Emit): void {
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

function dispatchFactActions(actions: CollectedActions, elements: readonly import("../binding/element-builder").ElementNode[], model: FileSemanticModel, emit: Emit): void {
  if (actions.factThunks.length === 0) return

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue

    for (let j = 0; j < actions.factThunks.length; j++) {
      actions.factThunks[j]!.dispatch(element, model, model, emit)
    }
  }
}

function dispatchCascadeActions(actions: CollectedActions, elements: readonly import("../binding/element-builder").ElementNode[], model: FileSemanticModel, emit: Emit): void {
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

function dispatchConditionalDeltaActions(actions: CollectedActions, elements: readonly import("../binding/element-builder").ElementNode[], model: FileSemanticModel, emit: Emit): void {
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

function dispatchAlignmentActions(actions: CollectedActions, elements: readonly import("../binding/element-builder").ElementNode[], model: FileSemanticModel, emit: Emit): void {
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
