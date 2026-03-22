/**
 * AnalysisRule + typed action registry — replaces CrossRule + BaseRule<CrossRuleContext>.
 */
import type { Diagnostic } from "../../diagnostic"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { SolidSyntaxTree } from "../core/solid-syntax-tree"
import type { SymbolTable } from "../symbols/symbol-table"
import type { ClassNameSymbol } from "../symbols/class-name"
import type { SelectorSymbol } from "../symbols/selector"
import type { DeclarationSymbol } from "../symbols/declaration"
import type { CustomPropertySymbol } from "../symbols/custom-property"
import type { ComponentHostSymbol } from "../symbols/component-host"
import type { KeyframesSymbol } from "../symbols/keyframes"
import type { FontFaceSymbol } from "../symbols/font-face"
import type { LayerSymbol } from "../symbols/layer"
import type { ContainerSymbol } from "../symbols/container"
import type { ThemeTokenSymbol } from "../symbols/theme-token"
import type { ElementNode } from "../binding/element-builder"
import type { ElementCascade } from "../binding/cascade-binder"
import type { SignalSnapshot, LayoutSignalName } from "../binding/signal-builder"
import type { FileSemanticModel } from "../binding/semantic-model"
import type { LayoutFactKind, LayoutFactMap } from "../analysis/layout-fact"
import type { ConditionalSignalDelta } from "../analysis/cascade-analyzer"
import type { AlignmentContext, CohortStats } from "../analysis/alignment"
export type { StatefulSelectorEntry, NormalizedRuleDeclaration } from "../analysis/statefulness"

export type Emit = (diagnostic: Diagnostic) => void

export const enum ComputationTier {
  CSSSyntax = 0,
  CrossSyntax = 1,
  ElementResolution = 2,
  SelectiveLayoutFacts = 3,
  FullCascade = 4,
  AlignmentModel = 5,
}

export interface TierRequirement {
  readonly tier: ComputationTier
  readonly factKinds?: readonly LayoutFactKind[]
  readonly signals?: readonly LayoutSignalName[]
}

export type StyleSymbolKind = keyof StyleSymbolByKind

export interface StyleSymbolByKind {
  className: ClassNameSymbol
  selector: SelectorSymbol
  declaration: DeclarationSymbol
  customProperty: CustomPropertySymbol
  componentHost: ComponentHostSymbol
  keyframes: KeyframesSymbol
  fontFace: FontFaceSymbol
  layer: LayerSymbol
  container: ContainerSymbol
  themeToken: ThemeTokenSymbol
}

export interface AnalysisActionRegistry {
  registerCSSSyntaxAction(action: (tree: CSSSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void): void
  registerCrossSyntaxAction(action: (solidTree: SolidSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void): void
  registerSymbolAction<K extends StyleSymbolKind>(kind: K, action: (symbol: StyleSymbolByKind[K], semanticModel: FileSemanticModel, emit: Emit) => void): void
  registerElementAction(action: (element: ElementNode, semanticModel: FileSemanticModel, emit: Emit) => void): void
  registerFactAction<K extends LayoutFactKind>(factKind: K, action: (element: ElementNode, fact: LayoutFactMap[K], semanticModel: FileSemanticModel, emit: Emit) => void): void
  registerCascadeAction(action: (element: ElementNode, cascade: ElementCascade, snapshot: SignalSnapshot, semanticModel: FileSemanticModel, emit: Emit) => void): void
  registerConditionalDeltaAction(action: (element: ElementNode, delta: ReadonlyMap<string, ConditionalSignalDelta>, semanticModel: FileSemanticModel, emit: Emit) => void): void
  registerAlignmentAction(action: (parentElement: ElementNode, context: AlignmentContext, cohort: CohortStats, semanticModel: FileSemanticModel, emit: Emit) => void): void
}

export interface AnalysisRule {
  readonly id: string
  readonly severity: "error" | "warn" | "off"
  readonly messages: Record<string, string>
  readonly meta: {
    readonly description: string
    readonly fixable: boolean
    readonly category: string
  }
  readonly requirement: TierRequirement
  register(registry: AnalysisActionRegistry): void
}

export function defineAnalysisRule(rule: AnalysisRule): AnalysisRule {
  return rule
}
