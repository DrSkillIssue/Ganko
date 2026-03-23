/**
 * AnalysisActionRegistry implementation — collects typed actions from rules.
 *
 * Uses existential closure encoding to achieve type-safe heterogeneous
 * dispatch without type assertions, `any`, or type predicates.
 *
 * Each registered symbol/fact action becomes a self-contained dispatch
 * thunk that closes over both the kind (K) and the action at registration
 * time. Since K is still in scope inside the thunk factory, TypeScript
 * proves the provider.getSymbols(kind)/provider.getLayoutFact(id, kind)
 * return type matches the action's parameter type. At dispatch time, the
 * thunks are opaque — the type parameter has been existentially erased
 * into the closure.
 */
import type { StyleCompilation } from "../core/compilation"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { SolidSyntaxTree } from "../core/solid-syntax-tree"
import type { SymbolTable } from "../symbols/symbol-table"
import type { ElementNode } from "../binding/element-builder"
import type { ElementCascade } from "../binding/cascade-binder"
import type { SignalSnapshot } from "../binding/signal-builder"
import type { FileSemanticModel } from "../binding/semantic-model"
import type { LayoutFactKind, LayoutFactMap } from "../analysis/layout-fact"
import type { ConditionalSignalDelta } from "../analysis/cascade-analyzer"
import type { AlignmentContext, CohortStats } from "../analysis/alignment"
import type { AnalysisActionRegistry, Emit, StyleSymbolKind, StyleSymbolByKind } from "./rule"

export type CSSSyntaxAction = (tree: CSSSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void
export type CrossSyntaxAction = (solidTree: SolidSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void
export type ElementAction = (element: ElementNode, semanticModel: FileSemanticModel, emit: Emit) => void
export type CascadeAction = (element: ElementNode, cascade: ElementCascade, snapshot: SignalSnapshot, semanticModel: FileSemanticModel, emit: Emit) => void
export type ConditionalDeltaAction = (element: ElementNode, delta: ReadonlyMap<string, ConditionalSignalDelta>, semanticModel: FileSemanticModel, emit: Emit) => void
export type AlignmentAction = (parentElement: ElementNode, context: AlignmentContext, cohort: CohortStats, semanticModel: FileSemanticModel, emit: Emit) => void
export type CompilationAction = (compilation: StyleCompilation, symbolTable: SymbolTable, emit: Emit) => void

/**
 * Opaque dispatch thunk for a symbol action. Calls provider.getSymbols(kind)
 * with the captured kind K, then invokes the captured action for each symbol.
 * The type parameter K is existentially erased into the closure.
 */
export interface SymbolDispatchThunk {
  readonly kind: StyleSymbolKind
  dispatch(provider: SymbolProvider, semanticModel: FileSemanticModel, emit: Emit): void
}

/**
 * Opaque dispatch thunk for a fact action. Calls provider.getLayoutFact
 * with the captured factKind K, then invokes the captured action.
 */
export interface FactDispatchThunk {
  readonly kind: LayoutFactKind
  dispatch(element: ElementNode, provider: FactProvider, semanticModel: FileSemanticModel, emit: Emit): void
}

export interface SymbolProvider {
  getSymbols<K extends StyleSymbolKind>(kind: K): ReadonlyArray<StyleSymbolByKind[K]>
}

export interface FactProvider {
  getLayoutFact<K extends LayoutFactKind>(elementId: number, factKind: K): LayoutFactMap[K]
}

export interface CollectedActions {
  readonly cssSyntax: readonly CSSSyntaxAction[]
  readonly crossSyntax: readonly CrossSyntaxAction[]
  readonly symbolThunks: readonly SymbolDispatchThunk[]
  readonly symbolKinds: ReadonlySet<StyleSymbolKind>
  readonly element: readonly ElementAction[]
  readonly factThunks: readonly FactDispatchThunk[]
  readonly factKinds: ReadonlySet<LayoutFactKind>
  readonly cascade: readonly CascadeAction[]
  readonly conditionalDelta: readonly ConditionalDeltaAction[]
  readonly alignment: readonly AlignmentAction[]
  readonly compilation: readonly CompilationAction[]
}

function createSymbolThunk<K extends StyleSymbolKind>(
  kind: K,
  action: (symbol: StyleSymbolByKind[K], semanticModel: FileSemanticModel, emit: Emit) => void,
): SymbolDispatchThunk {
  return {
    kind,
    dispatch(provider, semanticModel, emit) {
      const symbols = provider.getSymbols(kind)
      for (let i = 0; i < symbols.length; i++) {
        action(symbols[i]!, semanticModel, emit)
      }
    },
  }
}

function createFactThunk<K extends LayoutFactKind>(
  factKind: K,
  action: (element: ElementNode, fact: LayoutFactMap[K], semanticModel: FileSemanticModel, emit: Emit) => void,
): FactDispatchThunk {
  return {
    kind: factKind,
    dispatch(element, provider, semanticModel, emit) {
      action(element, provider.getLayoutFact(element.elementId, factKind), semanticModel, emit)
    },
  }
}

export function createActionRegistry(): { registry: AnalysisActionRegistry; actions: CollectedActions } {
  const cssSyntax: CSSSyntaxAction[] = []
  const crossSyntax: CrossSyntaxAction[] = []
  const symbolThunks: SymbolDispatchThunk[] = []
  const symbolKinds = new Set<StyleSymbolKind>()
  const element: ElementAction[] = []
  const factThunks: FactDispatchThunk[] = []
  const factKinds = new Set<LayoutFactKind>()
  const cascade: CascadeAction[] = []
  const conditionalDelta: ConditionalDeltaAction[] = []
  const alignment: AlignmentAction[] = []
  const compilation: CompilationAction[] = []

  const registry: AnalysisActionRegistry = {
    registerCSSSyntaxAction(action) { cssSyntax.push(action) },
    registerCrossSyntaxAction(action) { crossSyntax.push(action) },
    registerSymbolAction(kind, action) {
      symbolKinds.add(kind)
      symbolThunks.push(createSymbolThunk(kind, action))
    },
    registerElementAction(action) { element.push(action) },
    registerFactAction(factKind, action) {
      factKinds.add(factKind)
      factThunks.push(createFactThunk(factKind, action))
    },
    registerCascadeAction(action) { cascade.push(action) },
    registerConditionalDeltaAction(action) { conditionalDelta.push(action) },
    registerAlignmentAction(action) { alignment.push(action) },
    registerCompilationAction(action) { compilation.push(action) },
  }

  const actions: CollectedActions = {
    cssSyntax, crossSyntax, symbolThunks, symbolKinds,
    element, factThunks, factKinds, cascade, conditionalDelta, alignment, compilation,
  }

  return { registry, actions }
}
