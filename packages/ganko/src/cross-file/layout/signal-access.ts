import type {
  EvidenceValueKind,
  EvidenceWitness,
  LayoutKnownSignalValue,
  LayoutSignalName,
  LayoutSignalSnapshot,
} from "./signal-model"
import type {
  LayoutConditionalSignalDeltaFact,
  LayoutContainingBlockFact,
  LayoutElementNode,
  LayoutElementRef,
  LayoutFlowParticipationFact,
  LayoutGraph,
  LayoutNormalizedRuleDeclaration,
  LayoutReservedSpaceFact,
  LayoutReservedSpaceReason,
  LayoutScrollContainerFact,
  LayoutStatefulSelectorEntry,
} from "./graph"

const EMPTY_STRING_LIST: readonly string[] = Object.freeze([])
const EMPTY_LAYOUT_NODE_LIST: readonly LayoutElementNode[] = Object.freeze([])
const EMPTY_RESERVED_SPACE_REASONS: readonly LayoutReservedSpaceReason[] = Object.freeze([])
const EMPTY_BASELINE_FACTS = new Map<LayoutSignalName, readonly number[]>()
const EMPTY_STATEFUL_SELECTOR_ENTRIES: readonly LayoutStatefulSelectorEntry[] = Object.freeze([])
const EMPTY_STATEFUL_DECLARATIONS: readonly LayoutNormalizedRuleDeclaration[] = Object.freeze([])
const EMPTY_STATEFUL_BASE_VALUE_INDEX = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>()
const EMPTY_LAYOUT_RESERVED_SPACE_FACT: LayoutReservedSpaceFact = Object.freeze({
  hasReservedSpace: false,
  reasons: EMPTY_RESERVED_SPACE_REASONS,
  hasUsableInlineDimension: false,
  hasUsableBlockDimension: false,
  hasContainIntrinsicSize: false,
  hasUsableAspectRatio: false,
})
const EMPTY_LAYOUT_SCROLL_CONTAINER_FACT: LayoutScrollContainerFact = Object.freeze({
  isScrollContainer: false,
  axis: "none",
  overflow: null,
  overflowY: null,
  hasConditionalScroll: false,
  hasUnconditionalScroll: false,
})
const EMPTY_LAYOUT_FLOW_PARTICIPATION_FACT: LayoutFlowParticipationFact = Object.freeze({
  inFlow: true,
  position: null,
  hasConditionalOutOfFlow: false,
  hasUnconditionalOutOfFlow: false,
})
const EMPTY_LAYOUT_CONTAINING_BLOCK_FACT: LayoutContainingBlockFact = Object.freeze({
  nearestPositionedAncestorKey: null,
  nearestPositionedAncestorHasReservedSpace: false,
})
const EMPTY_LAYOUT_CONDITIONAL_DELTA_FACT: LayoutConditionalSignalDeltaFact = Object.freeze({
  hasConditional: false,
  hasDelta: false,
  conditionalValues: EMPTY_STRING_LIST,
  unconditionalValues: EMPTY_STRING_LIST,
  hasConditionalScrollValue: false,
  hasConditionalNonScrollValue: false,
  hasUnconditionalScrollValue: false,
  hasUnconditionalNonScrollValue: false,
})

export type NumericSignalEvidence = EvidenceWitness<number>

export type NormalizedSignalEvidence = EvidenceWitness<string>

export function readKnownSignalWithGuard(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): LayoutKnownSignalValue | null {
  const value = snapshot.signals.get(name)
  if (!value) return null
  if (value.kind !== "known") return null
  return value
}

function toEvidenceKind(value: LayoutKnownSignalValue): EvidenceValueKind {
  if (value.guard === "conditional") return "conditional"
  if (value.quality === "estimated") return "interval"
  return "exact"
}

export function readNumericSignalEvidence(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): NumericSignalEvidence {
  const value = snapshot.signals.get(name)
  if (!value) {
    return {
      value: null,
      kind: "unknown",
    }
  }

  if (value.kind !== "known") {
    if (value.guard === "conditional") {
      return {
        value: null,
        kind: "conditional",
      }
    }

    return {
      value: null,
      kind: "unknown",
    }
  }

  return {
    value: value.px,
    kind: toEvidenceKind(value),
  }
}

export function readNormalizedSignalEvidence(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): NormalizedSignalEvidence {
  const value = snapshot.signals.get(name)
  if (!value) {
    return {
      value: null,
      kind: "unknown",
    }
  }

  if (value.kind !== "known") {
    if (value.guard === "conditional") {
      return {
        value: null,
        kind: "conditional",
      }
    }

    return {
      value: null,
      kind: "unknown",
    }
  }

  return {
    value: value.normalized,
    kind: toEvidenceKind(value),
  }
}

export function readKnownSignal(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): LayoutKnownSignalValue | null {
  const value = readKnownSignalWithGuard(snapshot, name)
  if (!value) return null
  if (value.guard !== "unconditional") return null
  return value
}

export function readKnownPx(snapshot: LayoutSignalSnapshot, name: LayoutSignalName): number | null {
  const value = readKnownSignal(snapshot, name)
  if (!value) return null
  return value.px
}

export function readKnownNormalized(snapshot: LayoutSignalSnapshot, name: LayoutSignalName): string | null {
  const value = readKnownSignal(snapshot, name)
  if (!value) return null
  return value.normalized
}

export function readKnownNormalizedWithGuard(snapshot: LayoutSignalSnapshot, name: LayoutSignalName): string | null {
  const value = readKnownSignalWithGuard(snapshot, name)
  if (!value) return null
  return value.normalized
}

export function hasEffectivePosition(snapshot: LayoutSignalSnapshot): boolean {
  const position = readKnownNormalized(snapshot, "position")
  if (position === null) return false
  return position !== "static"
}

export function readReservedSpaceFact(
  graph: LayoutGraph,
  node: LayoutElementNode,
): LayoutReservedSpaceFact {
  return graph.reservedSpaceFactsByElementKey.get(node.key) ?? EMPTY_LAYOUT_RESERVED_SPACE_FACT
}

export function readScrollContainerFact(
  graph: LayoutGraph,
  node: LayoutElementNode,
): LayoutScrollContainerFact {
  return graph.scrollContainerFactsByElementKey.get(node.key) ?? EMPTY_LAYOUT_SCROLL_CONTAINER_FACT
}

export function readFlowParticipationFact(
  graph: LayoutGraph,
  node: LayoutElementNode,
): LayoutFlowParticipationFact {
  return graph.flowParticipationFactsByElementKey.get(node.key) ?? EMPTY_LAYOUT_FLOW_PARTICIPATION_FACT
}

export function readContainingBlockFact(
  graph: LayoutGraph,
  node: LayoutElementNode,
): LayoutContainingBlockFact {
  return graph.containingBlockFactsByElementKey.get(node.key) ?? EMPTY_LAYOUT_CONTAINING_BLOCK_FACT
}

export function readConditionalSignalDeltaFact(
  graph: LayoutGraph,
  node: LayoutElementNode,
  name: LayoutSignalName,
): LayoutConditionalSignalDeltaFact {
  const byProperty = graph.conditionalSignalDeltaFactsByElementKey.get(node.key)
  if (!byProperty) return EMPTY_LAYOUT_CONDITIONAL_DELTA_FACT
  return byProperty.get(name) ?? EMPTY_LAYOUT_CONDITIONAL_DELTA_FACT
}

export function readElementsByTagName(graph: LayoutGraph, tagName: string): readonly LayoutElementNode[] {
  return graph.elementsByTagName.get(tagName) ?? EMPTY_LAYOUT_NODE_LIST
}

export function readElementsWithConditionalSignalDelta(
  graph: LayoutGraph,
  name: LayoutSignalName,
): readonly LayoutElementNode[] {
  return graph.elementsWithConditionalDeltaBySignal.get(name) ?? EMPTY_LAYOUT_NODE_LIST
}

export function readElementsWithConditionalOverflowDelta(graph: LayoutGraph): readonly LayoutElementNode[] {
  return graph.elementsWithConditionalOverflowDelta
}

export function readElementsWithConditionalOffsetDelta(graph: LayoutGraph): readonly LayoutElementNode[] {
  return graph.elementsWithConditionalOffsetDelta
}

export function readElementsByKnownSignalValue(
  graph: LayoutGraph,
  name: LayoutSignalName,
  value: string,
): readonly LayoutElementNode[] {
  const byValue = graph.elementsByKnownSignalValue.get(name)
  if (!byValue) return EMPTY_LAYOUT_NODE_LIST
  return byValue.get(value) ?? EMPTY_LAYOUT_NODE_LIST
}

export function readDynamicSlotCandidateElements(graph: LayoutGraph): readonly LayoutElementNode[] {
  return graph.dynamicSlotCandidateElements
}

export function readScrollContainerElements(graph: LayoutGraph): readonly LayoutElementNode[] {
  return graph.scrollContainerElements
}

export function readBaselineOffsetFacts(
  graph: LayoutGraph,
  node: LayoutElementNode,
): ReadonlyMap<LayoutSignalName, readonly number[]> {
  return graph.baselineOffsetFactsByElementKey.get(node.key) ?? EMPTY_BASELINE_FACTS
}

export function readElementRef(graph: LayoutGraph, node: LayoutElementNode): LayoutElementRef | null {
  return readElementRefById(graph, node.solidFile, node.elementId)
}

export function readElementRefById(
  graph: LayoutGraph,
  solidFile: string,
  elementId: number,
): LayoutElementRef | null {
  const refs = graph.elementRefsBySolidFileAndId.get(solidFile)
  if (!refs) return null
  return refs.get(elementId) ?? null
}

export function readStatefulSelectorEntriesByRuleId(
  graph: LayoutGraph,
  ruleId: number,
): readonly LayoutStatefulSelectorEntry[] {
  return graph.statefulSelectorEntriesByRuleId.get(ruleId) ?? EMPTY_STATEFUL_SELECTOR_ENTRIES
}

export function readStatefulNormalizedDeclarationsByRuleId(
  graph: LayoutGraph,
  ruleId: number,
): readonly LayoutNormalizedRuleDeclaration[] {
  return graph.statefulNormalizedDeclarationsByRuleId.get(ruleId) ?? EMPTY_STATEFUL_DECLARATIONS
}

export function readStatefulBaseValueIndex(
  graph: LayoutGraph,
): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
  if (graph.statefulBaseValueIndex.size === 0) return EMPTY_STATEFUL_BASE_VALUE_INDEX
  return graph.statefulBaseValueIndex
}
