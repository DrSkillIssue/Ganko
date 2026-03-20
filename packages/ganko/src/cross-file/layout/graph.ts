import type { SelectorEntity } from "../../css/entities"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import type { SolidGraph } from "../../solid/impl"
import type { LayoutPerfStatsMutable } from "./perf"
import type { AlignmentContext } from "./context-model"
import type { LayoutRuleGuard } from "./guard-model"
import type {
  LayoutCohortStats,
  LayoutSignalName,
  LayoutSignalSource,
  LayoutSnapshotHotSignals,
  LayoutSignalSnapshot,
  LayoutTextualContentState,
} from "./signal-model"

export interface LayoutCascadedDeclaration {
  readonly value: string
  readonly source: LayoutSignalSource
  readonly guardProvenance: LayoutRuleGuard
}

export interface LayoutElementNode {
  readonly key: string
  readonly solidFile: string
  readonly elementId: number
  readonly tag: string | null
  readonly tagName: string | null
  readonly classTokens: readonly string[]
  readonly classTokenSet: ReadonlySet<string>
  readonly inlineStyleKeys: readonly string[]
  readonly parentElementNode: LayoutElementNode | null
  readonly previousSiblingNode: LayoutElementNode | null
  readonly siblingIndex: number
  readonly siblingCount: number
  readonly siblingTypeIndex: number
  readonly siblingTypeCount: number
  readonly selectorDispatchKeys: readonly string[]
  readonly attributes: ReadonlyMap<string, string | null>
  readonly inlineStyleValues: ReadonlyMap<string, string>
  readonly textualContent: LayoutTextualContentState
  readonly isControl: boolean
  readonly isReplaced: boolean
}

export interface LayoutStyleRuleNode {
  readonly cssFile: string
  readonly ruleId: number
  readonly selectorId: number
}

export interface LayoutMatchEdge {
  readonly selectorId: number
  readonly specificityScore: number
  readonly sourceOrder: number
  /** Whether the selector match is conditional due to dynamic attribute values. */
  readonly conditionalMatch: boolean
}

export interface LayoutElementRef {
  readonly solid: SolidGraph
  readonly element: JSXElementEntity
}

export type LayoutReservedSpaceReason =
  | "height"
  | "block-size"
  | "min-height"
  | "min-block-size"
  | "contain-intrinsic-size"
  | "aspect-ratio+width"
  | "aspect-ratio+inline-size"
  | "aspect-ratio+min-width"
  | "aspect-ratio+min-block-size"
  | "aspect-ratio+min-height"

export interface LayoutReservedSpaceFact {
  readonly hasReservedSpace: boolean
  readonly reasons: readonly LayoutReservedSpaceReason[]
  readonly hasContainIntrinsicSize: boolean
  readonly hasUsableAspectRatio: boolean
  readonly hasDeclaredInlineDimension: boolean
  readonly hasDeclaredBlockDimension: boolean
}

export const enum LayoutScrollAxis { None = 0, X = 1, Y = 2, Both = 3 }

export interface LayoutScrollContainerFact {
  readonly isScrollContainer: boolean
  readonly axis: LayoutScrollAxis
  readonly overflow: string | null
  readonly overflowY: string | null
  readonly hasConditionalScroll: boolean
  readonly hasUnconditionalScroll: boolean
}

export interface LayoutFlowParticipationFact {
  readonly inFlow: boolean
  readonly position: string | null
  readonly hasConditionalOutOfFlow: boolean
  readonly hasUnconditionalOutOfFlow: boolean
}

export interface LayoutContainingBlockFact {
  readonly nearestPositionedAncestorKey: string | null
  readonly nearestPositionedAncestorHasReservedSpace: boolean
}

export interface LayoutConditionalSignalDeltaFact {
  readonly hasConditional: boolean
  readonly hasDelta: boolean
  readonly conditionalValues: readonly string[]
  readonly unconditionalValues: readonly string[]
  readonly hasConditionalScrollValue: boolean
  readonly hasConditionalNonScrollValue: boolean
  readonly hasUnconditionalScrollValue: boolean
  readonly hasUnconditionalNonScrollValue: boolean
}

export interface LayoutStatefulSelectorEntry {
  readonly raw: string
  readonly isStateful: boolean
  /** Pseudo-classes from STATE_PSEUDO_SET that caused this selector to be classified as stateful. */
  readonly statePseudoClasses: readonly string[]
  /**
   * True when ALL state pseudo-classes are "direct" interaction (hover, focus, active, etc.),
   * meaning state changes only from the user physically interacting with the element itself.
   * False when any pseudo-class is "indirect" (checked, target) — state can change externally.
   */
  readonly isDirectInteraction: boolean
  readonly baseLookupKeys: readonly string[]
}

export interface LayoutNormalizedRuleDeclaration {
  readonly declarationId: number
  readonly property: string
  readonly normalizedValue: string
  readonly filePath: string
  readonly startLine: number
  readonly startColumn: number
  readonly propertyLength: number
}

export interface LayoutElementRecord {
  readonly ref: LayoutElementRef | null
  readonly edges: readonly LayoutMatchEdge[]
  readonly cascade: ReadonlyMap<string, LayoutCascadedDeclaration>
  readonly snapshot: LayoutSignalSnapshot
  readonly hotSignals: LayoutSnapshotHotSignals
  readonly reservedSpace: LayoutReservedSpaceFact
  readonly scrollContainer: LayoutScrollContainerFact
  readonly flowParticipation: LayoutFlowParticipationFact
  readonly containingBlock: LayoutContainingBlockFact
  readonly conditionalDelta: ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact> | null
  readonly baselineOffsets: ReadonlyMap<LayoutSignalName, readonly number[]> | null
}

export interface LayoutGraph {
  readonly elements: readonly LayoutElementNode[]
  readonly childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>
  readonly elementBySolidFileAndId: ReadonlyMap<string, ReadonlyMap<number, LayoutElementNode>>
  readonly elementRefsBySolidFileAndId: ReadonlyMap<string, ReadonlyMap<number, LayoutElementRef>>
  readonly elementsByTagName: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly measurementNodeByRootKey: ReadonlyMap<string, LayoutElementNode>
  readonly hostElementRefsByNode: ReadonlyMap<LayoutElementNode, LayoutElementRef>
  readonly styleRules: readonly LayoutStyleRuleNode[]
  readonly applies: readonly LayoutMatchEdge[]
  readonly cssScopeBySolidFile: ReadonlyMap<string, readonly string[]>
  readonly selectorCandidatesByNode: ReadonlyMap<LayoutElementNode, readonly number[]>
  readonly selectorsById: ReadonlyMap<number, SelectorEntity>
  readonly records: ReadonlyMap<LayoutElementNode, LayoutElementRecord>
  readonly cohortStatsByParentNode: ReadonlyMap<LayoutElementNode, LayoutCohortStats>
  readonly contextByParentNode: ReadonlyMap<LayoutElementNode, AlignmentContext>
  readonly elementsWithConditionalDeltaBySignal: ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>
  readonly elementsWithConditionalOverflowDelta: readonly LayoutElementNode[]
  readonly elementsWithConditionalOffsetDelta: readonly LayoutElementNode[]
  readonly elementsByKnownSignalValue: ReadonlyMap<LayoutSignalName, ReadonlyMap<string, readonly LayoutElementNode[]>>
  readonly dynamicSlotCandidateElements: readonly LayoutElementNode[]
  readonly scrollContainerElements: readonly LayoutElementNode[]
  readonly statefulSelectorEntriesByRuleId: ReadonlyMap<number, readonly LayoutStatefulSelectorEntry[]>
  readonly statefulNormalizedDeclarationsByRuleId: ReadonlyMap<number, readonly LayoutNormalizedRuleDeclaration[]>
  readonly statefulBaseValueIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
  readonly perf: LayoutPerfStatsMutable
}

export function toLayoutElementKey(solidFile: string, elementId: number): string {
  return `${solidFile}::${elementId}`
}
