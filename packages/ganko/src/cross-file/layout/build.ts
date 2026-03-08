import type { CSSGraph } from "../../css/impl"
import type { SelectorEntity } from "../../css/entities"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import { noopLogger } from "@ganko/shared"
import type { Logger } from "@ganko/shared"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"

import type {
  LayoutCascadedDeclaration,
  LayoutContainingBlockFact,
  LayoutElementNode,
  LayoutFlowParticipationFact,
  LayoutGraph,
  LayoutMatchEdge,
  LayoutReservedSpaceFact,
  LayoutReservedSpaceReason,
  LayoutScrollContainerFact,
  LayoutStyleRuleNode,
} from "./graph"
import { toLayoutElementKey } from "./graph"
import { collectCSSScopeBySolidFile } from "./scope"
import { createLayoutPerfStats, type LayoutPerfStatsMutable } from "./perf"
import { createLayoutModuleResolver } from "./module-resolver"
import { createLayoutComponentHostResolver } from "./component-host"
import type { AlignmentContext } from "./context-model"
import type {
  LayoutSignalName,
  LayoutSignalSnapshot,
  LayoutSnapshotHotSignals,
} from "./signal-model"
import { isControlTag, isReplacedTag } from "./signal-normalization"
import { compileSelectorMatcher } from "./selector-match"
import { resolveRuleGuard } from "./guard-model"
import { buildSignalSnapshotIndex } from "./signal-collection"
import { readNumericSignalEvidence, readNormalizedSignalEvidence } from "./signal-access"
import { createAlignmentContextForParent } from "./context-classification"
import { buildCohortIndex } from "./cohort-index"
import { buildMeasurementNodeIndex } from "./measurement-node"
import {
  type SelectorBuildMetadata,
  buildScopedSelectorIndexBySolidFile,
  buildSelectorCandidatesByElementKey,
} from "./selector-dispatch"
import { buildStatefulRuleIndexes } from "./stateful-rule-index"
import { layoutOffsetSignals } from "./offset-baseline"
import {
  type MonitoredDeclaration,
  collectMonitoredDeclarations,
  resolveRuleLayerOrder,
  appendMatchingEdgesFromSelectorIds,
  buildCascadeMapForElement,
  compareLayoutEdge,
  buildConditionalDeltaIndex,
  buildConditionalDeltaSignalGroupElements,
  SCROLLABLE_VALUES,
} from "./cascade-builder"
import {
  type TextualContentState,
  collectInlineStyleValuesByElementId,
  collectLayoutElementRecordsForSolid,
  collectSiblingTotals,
  resolveSiblingTypeIndex,
  resolveSiblingTypeCount,
} from "./element-record"

const EMPTY_NUMBER_LIST: readonly number[] = []
const NON_RESERVING_DIMENSION_KEYWORDS = new Set(["auto", "none", "fit-content", "min-content", "max-content", "stretch"])

export function buildLayoutGraph(solids: readonly SolidGraph[], css: CSSGraph, logger: Logger = noopLogger): LayoutGraph {
  const perf = createLayoutPerfStats()
  const startedAt = performance.now()

  const elements: LayoutElementNode[] = []
  const styleRules: LayoutStyleRuleNode[] = []
  const applies: LayoutMatchEdge[] = []
  const childrenByParentNodeMutable = new Map<LayoutElementNode, LayoutElementNode[]>()
  const elementBySolidFileAndIdMutable = new Map<string, Map<number, LayoutElementNode>>()
  const elementRefsBySolidFileAndIdMutable = new Map<string, Map<number, { solid: SolidGraph; element: JSXElementEntity }>>()
  const appliesByElementNodeMutable = new Map<LayoutElementNode, LayoutMatchEdge[]>()
  const selectorsById = new Map<number, SelectorEntity>()
  const monitoredDeclarationsBySelectorId = new Map<number, readonly MonitoredDeclaration[]>()
  const selectorMetadataById = new Map<number, SelectorBuildMetadata>()
  const cascadeByElementNode = new WeakMap<LayoutElementNode, ReadonlyMap<string, LayoutCascadedDeclaration>>()

  for (let i = 0; i < css.selectors.length; i++) {
    const selector = css.selectors[i]
    if (!selector) continue
    const guard = resolveRuleGuard(selector.rule)
    const matcher = compileSelectorMatcher(selector)
    if (matcher !== null) {
      perf.compiledSelectorCount++
    }
    if (matcher === null) {
      perf.selectorsRejectedUnsupported++
    }

    const monitoredDeclarations = collectMonitoredDeclarations(
      selector,
      resolveRuleLayerOrder(selector.rule, css),
      guard,
    )

    selectorsById.set(selector.id, selector)
    monitoredDeclarationsBySelectorId.set(selector.id, monitoredDeclarations)
    selectorMetadataById.set(selector.id, {
      guard,
      matcher,
    })

    styleRules.push({
      cssFile: selector.rule.file.path,
      ruleId: selector.rule.id,
      selectorId: selector.id,
    })
  }

  const moduleResolver = createLayoutModuleResolver(solids, css)
  const componentHostResolver = createLayoutComponentHostResolver(solids, moduleResolver, logger)
  const cssScopeBySolidFile = collectCSSScopeBySolidFile(solids, css, moduleResolver)
  const selectorIndexStartedAt = performance.now()
  const scopedSelectorsBySolidFile = buildScopedSelectorIndexBySolidFile(
    cssScopeBySolidFile,
    css,
    selectorMetadataById,
    perf,
  )
  perf.selectorIndexMs = performance.now() - selectorIndexStartedAt

  const selectorMatchStartedAt = performance.now()
  const rootElementsByFile = new Map<string, LayoutElementNode[]>()

  for (let s = 0; s < solids.length; s++) {
    const solid = solids[s]
    if (!solid) continue
    const elementById = new Map<number, LayoutElementNode>()
    const elementRefsById = new Map<number, { solid: SolidGraph; element: JSXElementEntity }>()
    elementBySolidFileAndIdMutable.set(solid.file, elementById)
    elementRefsBySolidFileAndIdMutable.set(solid.file, elementRefsById)
    const selectorIndex = scopedSelectorsBySolidFile.get(solid.file)
    const selectorRequirements = selectorIndex
      ? selectorIndex.requirements
      : {
        needsClassTokens: false,
        needsAttributes: false,
      }
    const textContentMemo = new Map<number, TextualContentState>()
    const inlineStyleValuesByElementId = collectInlineStyleValuesByElementId(solid)
    const records = collectLayoutElementRecordsForSolid(
      solid,
      selectorRequirements,
      inlineStyleValuesByElementId,
      textContentMemo,
      componentHostResolver,
      logger,
    )
    const siblingTotals = collectSiblingTotals(records)
    const nodeByElementId = new Map<number, LayoutElementNode>()
    const lastChildByParentId = new Map<number, LayoutElementNode>()
    const siblingTypeSeenByParentId = new Map<number, Map<string, number>>()

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (!record) continue
      const parentElementId = record.parentElementId
      const parentNode = parentElementId === null ? null : (nodeByElementId.get(parentElementId) ?? null)
      const previousSiblingNode = parentElementId === null ? null : (lastChildByParentId.get(parentElementId) ?? null)
      const siblingIndex = previousSiblingNode ? previousSiblingNode.siblingIndex + 1 : 1
      const siblingCount = parentElementId === null ? 1 : (siblingTotals.siblingCountByParentId.get(parentElementId) ?? 1)
      const siblingTypeIndex = resolveSiblingTypeIndex(
        siblingTypeSeenByParentId,
        parentElementId,
        record.tagName,
        siblingIndex,
      )
      const siblingTypeCount = resolveSiblingTypeCount(
        siblingTotals.siblingTypeCountByParentId,
        parentElementId,
        record.tagName,
        siblingCount,
      )
      const node: LayoutElementNode = {
        key: record.key,
        solidFile: solid.file,
        elementId: record.element.id,
        tag: record.tag,
        tagName: record.tagName,
        classTokens: record.classTokens,
        classTokenSet: record.classTokenSet,
        inlineStyleKeys: record.inlineStyleKeys,
        parentElementId,
        parentElementKey: parentNode ? parentNode.key : (parentElementId === null ? null : toLayoutElementKey(solid.file, parentElementId)),
        parentElementNode: parentNode,
        previousSiblingNode,
        siblingIndex,
        siblingCount,
        siblingTypeIndex,
        siblingTypeCount,
        selectorDispatchKeys: record.selectorDispatchKeys,
        attributes: record.attributes,
        inlineStyleValues: record.inlineStyleValues,
        textualContent: record.textualContent,
        isControl: isControlTag(record.tagName),
        isReplaced: isReplacedTag(record.tagName),
      }

      elements.push(node)
      elementById.set(record.element.id, node)
      nodeByElementId.set(record.element.id, node)
      elementRefsById.set(record.element.id, { solid, element: record.element })
      if (parentElementId !== null) lastChildByParentId.set(parentElementId, node)
      if (parentNode !== null) {
        const children = childrenByParentNodeMutable.get(parentNode)
        if (children) {
          children.push(node)
        }
        if (!children) childrenByParentNodeMutable.set(parentNode, [node])
      } else {
        const existing = rootElementsByFile.get(solid.file)
        if (existing) {
          existing.push(node)
        } else {
          rootElementsByFile.set(solid.file, [node])
        }
      }
    }

  }

  if (logger.enabled) {
    for (const [file, roots] of rootElementsByFile) {
      const descs = roots.map(r => `${r.key}(tag=${r.tagName}, attrs=[${[...r.attributes.entries()].map(([k, v]) => `${k}=${v}`).join(",")}])`)
      logger.debug(`[build] rootElementsByFile file=${file} count=${roots.length}: ${descs.join(", ")}`)
    }
  }

  const selectorCandidatesByElementKey = buildSelectorCandidatesByElementKey(elements, scopedSelectorsBySolidFile, perf)

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const selectorIds = selectorCandidatesByElementKey.get(node.key) ?? EMPTY_NUMBER_LIST
    if (selectorIds.length === 0) continue
    appendMatchingEdgesFromSelectorIds(
      selectorIds,
      node,
      selectorMetadataById,
      selectorsById,
      applies,
      appliesByElementNodeMutable,
      perf,
      rootElementsByFile,
      logger,
    )
  }

  perf.selectorMatchMs = performance.now() - selectorMatchStartedAt

  const cascadeStartedAt = performance.now()
  for (const edges of appliesByElementNodeMutable.values()) {
    edges.sort(compareLayoutEdge)
  }

  const appliesByElementKey = new Map<string, readonly LayoutMatchEdge[]>()

  const tailwind = css.tailwind
  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const edges = appliesByElementNodeMutable.get(node) ?? []
    const cascade = buildCascadeMapForElement(node, edges, monitoredDeclarationsBySelectorId, tailwind)
    cascadeByElementNode.set(node, cascade)
    appliesByElementKey.set(node.key, edges)
  }
  perf.cascadeBuildMs = performance.now() - cascadeStartedAt
  const snapshotByElementNode = buildSignalSnapshotIndex(elements, cascadeByElementNode, perf)
  const measurementNodeByRootKey = buildMeasurementNodeIndex(elements, childrenByParentNodeMutable, snapshotByElementNode)

  const factIndex = buildElementFactIndex(elements, snapshotByElementNode)
  const conditionalDeltaIndex = buildConditionalDeltaIndex(
    elements,
    appliesByElementKey,
    monitoredDeclarationsBySelectorId,
  )
  const elementsWithConditionalOverflowDelta = buildConditionalDeltaSignalGroupElements(
    conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    ["overflow", "overflow-y"],
  )
  const elementsWithConditionalOffsetDelta = buildConditionalDeltaSignalGroupElements(
    conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    layoutOffsetSignals,
  )
  const statefulRuleIndexes = buildStatefulRuleIndexes(css.rules)
  const contextByParentNode = buildContextIndex(childrenByParentNodeMutable, snapshotByElementNode, perf)
  const cohortIndex = buildCohortIndex({
    childrenByParentNode: childrenByParentNodeMutable,
    contextByParentNode,
    measurementNodeByRootKey,
    snapshotByElementNode,
    snapshotHotSignalsByElementKey: factIndex.snapshotHotSignalsByElementKey,
  })
  perf.conditionalSignals = cohortIndex.conditionalSignals
  perf.totalSignals = cohortIndex.totalSignals
  perf.cohortUnimodalFalse = cohortIndex.unimodalFalseCount
  perf.measurementIndexHits = cohortIndex.measurementIndexHits

  perf.elapsedMs = performance.now() - startedAt

  return {
    elements,
    styleRules,
    applies,
    cssScopeBySolidFile,
    childrenByParentNode: childrenByParentNodeMutable,
    elementBySolidFileAndId: elementBySolidFileAndIdMutable,
    elementRefsBySolidFileAndId: elementRefsBySolidFileAndIdMutable,
    appliesByElementKey,
    selectorCandidatesByElementKey,
    selectorsById,
    measurementNodeByRootKey,
    snapshotHotSignalsByElementKey: factIndex.snapshotHotSignalsByElementKey,
    elementsByTagName: factIndex.elementsByTagName,
    elementsWithConditionalDeltaBySignal: conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    elementsWithConditionalOverflowDelta,
    elementsWithConditionalOffsetDelta,
    elementsByKnownSignalValue: factIndex.elementsByKnownSignalValue,
    dynamicSlotCandidateElements: factIndex.dynamicSlotCandidateElements,
    scrollContainerElements: factIndex.scrollContainerElements,
    reservedSpaceFactsByElementKey: factIndex.reservedSpaceFactsByElementKey,
    scrollContainerFactsByElementKey: factIndex.scrollContainerFactsByElementKey,
    flowParticipationFactsByElementKey: factIndex.flowParticipationFactsByElementKey,
    containingBlockFactsByElementKey: factIndex.containingBlockFactsByElementKey,
    conditionalSignalDeltaFactsByElementKey: conditionalDeltaIndex.conditionalSignalDeltaFactsByElementKey,
    baselineOffsetFactsByElementKey: conditionalDeltaIndex.baselineOffsetFactsByElementKey,
    statefulSelectorEntriesByRuleId: statefulRuleIndexes.selectorEntriesByRuleId,
    statefulNormalizedDeclarationsByRuleId: statefulRuleIndexes.normalizedDeclarationsByRuleId,
    statefulBaseValueIndex: statefulRuleIndexes.baseValueIndex,
    cohortStatsByParentNode: cohortIndex.statsByParentNode,
    cascadeByElementNode,
    snapshotByElementNode,
    contextByParentNode,
    perf,
  }
}

interface ElementFactIndex {
  readonly reservedSpaceFactsByElementKey: ReadonlyMap<string, LayoutReservedSpaceFact>
  readonly scrollContainerFactsByElementKey: ReadonlyMap<string, LayoutScrollContainerFact>
  readonly scrollContainerElements: readonly LayoutElementNode[]
  readonly flowParticipationFactsByElementKey: ReadonlyMap<string, LayoutFlowParticipationFact>
  readonly containingBlockFactsByElementKey: ReadonlyMap<string, LayoutContainingBlockFact>
  readonly snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>
  readonly elementsByTagName: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly elementsByKnownSignalValue: ReadonlyMap<LayoutSignalName, ReadonlyMap<string, readonly LayoutElementNode[]>>
  readonly dynamicSlotCandidateElements: readonly LayoutElementNode[]
}

function buildElementFactIndex(
  elements: readonly LayoutElementNode[],
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
): ElementFactIndex {
  const reservedSpaceFactsByElementKey = new Map<string, LayoutReservedSpaceFact>()
  const scrollContainerFactsByElementKey = new Map<string, LayoutScrollContainerFact>()
  const flowParticipationFactsByElementKey = new Map<string, LayoutFlowParticipationFact>()
  const containingBlockFactsByElementKey = new Map<string, LayoutContainingBlockFact>()
  const snapshotHotSignalsByElementKey = new Map<string, LayoutSnapshotHotSignals>()
  const elementsByTagName = new Map<string, LayoutElementNode[]>()
  const elementsByKnownSignalValue = new Map<LayoutSignalName, Map<string, LayoutElementNode[]>>()
  const dynamicSlotCandidateElements: LayoutElementNode[] = []
  const scrollContainerElements: LayoutElementNode[] = []
  const positionedAncestorByKey = new Map<string, { key: string; hasReservedSpace: boolean }>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const snapshot = snapshotByElementNode.get(node)

    if (node.textualContent === "unknown" && node.siblingCount >= 2) {
      dynamicSlotCandidateElements.push(node)
    }

    if (node.tagName) {
      const existing = elementsByTagName.get(node.tagName)
      if (existing) {
        existing.push(node)
      } else {
        elementsByTagName.set(node.tagName, [node])
      }
    }

    const parentKey = node.parentElementNode?.key ?? null
    let nearestPositionedAncestorKey: string | null = null
    let nearestPositionedAncestorHasReservedSpace = false

    if (parentKey !== null) {
      const parentPositioned = positionedAncestorByKey.get(parentKey)
      if (parentPositioned !== undefined) {
        nearestPositionedAncestorKey = parentPositioned.key
        nearestPositionedAncestorHasReservedSpace = parentPositioned.hasReservedSpace
      }
    }

    containingBlockFactsByElementKey.set(node.key, {
      nearestPositionedAncestorKey,
      nearestPositionedAncestorHasReservedSpace,
    })

    if (!snapshot) continue

    const reservedSpaceFact = computeReservedSpaceFact(snapshot)
    reservedSpaceFactsByElementKey.set(node.key, reservedSpaceFact)
    const scrollFact = computeScrollContainerFact(snapshot)
    scrollContainerFactsByElementKey.set(node.key, scrollFact)
    if (scrollFact.isScrollContainer) scrollContainerElements.push(node)
    flowParticipationFactsByElementKey.set(node.key, computeFlowParticipationFact(snapshot))
    snapshotHotSignalsByElementKey.set(node.key, computeHotSignals(snapshot))

    const positionSignal = snapshot.signals.get("position")
    const isPositioned = positionSignal !== undefined
      && positionSignal.kind === "known"
      && positionSignal.normalized !== "static"
    if (isPositioned) {
      positionedAncestorByKey.set(node.key, {
        key: node.key,
        hasReservedSpace: reservedSpaceFact.hasReservedSpace,
      })
    } else if (parentKey !== null) {
      const inherited = positionedAncestorByKey.get(parentKey)
      if (inherited !== undefined) {
        positionedAncestorByKey.set(node.key, inherited)
      }
    }

    for (const [signal, value] of snapshot.signals) {
      if (value.kind !== "known") continue
      const normalized = value.normalized
      let byValue = elementsByKnownSignalValue.get(signal)
      if (!byValue) {
        byValue = new Map<string, LayoutElementNode[]>()
        elementsByKnownSignalValue.set(signal, byValue)
      }
      const existingNodes = byValue.get(normalized)
      if (existingNodes) {
        existingNodes.push(node)
      } else {
        byValue.set(normalized, [node])
      }
    }
  }

  return {
    reservedSpaceFactsByElementKey,
    scrollContainerFactsByElementKey,
    scrollContainerElements,
    flowParticipationFactsByElementKey,
    containingBlockFactsByElementKey,
    snapshotHotSignalsByElementKey,
    elementsByTagName,
    elementsByKnownSignalValue,
    dynamicSlotCandidateElements,
  }
}

function computeHotSignals(snapshot: LayoutSignalSnapshot): LayoutSnapshotHotSignals {
  return {
    lineHeight: computeHotNumeric(snapshot, "line-height"),
    verticalAlign: computeHotNormalized(snapshot, "vertical-align"),
    alignSelf: computeHotNormalized(snapshot, "align-self"),
    placeSelf: computeHotNormalized(snapshot, "place-self"),
    writingMode: computeHotNormalized(snapshot, "writing-mode"),
    direction: computeHotNormalized(snapshot, "direction"),
    display: computeHotNormalized(snapshot, "display"),
    alignItems: computeHotNormalized(snapshot, "align-items"),
    placeItems: computeHotNormalized(snapshot, "place-items"),
    position: computeHotNormalized(snapshot, "position"),
    insetBlockStart: computeHotNumeric(snapshot, "inset-block-start"),
    insetBlockEnd: computeHotNumeric(snapshot, "inset-block-end"),
    transform: computeHotNumeric(snapshot, "transform"),
    translate: computeHotNumeric(snapshot, "translate"),
    top: computeHotNumeric(snapshot, "top"),
    bottom: computeHotNumeric(snapshot, "bottom"),
    marginTop: computeHotNumeric(snapshot, "margin-top"),
    marginBottom: computeHotNumeric(snapshot, "margin-bottom"),
  }
}

function computeHotNumeric(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): LayoutSnapshotHotSignals["lineHeight"] {
  return {
    present: snapshot.signals.has(name),
    ...readNumericSignalEvidence(snapshot, name),
  }
}

function computeHotNormalized(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): LayoutSnapshotHotSignals["verticalAlign"] {
  return {
    present: snapshot.signals.has(name),
    ...readNormalizedSignalEvidence(snapshot, name),
  }
}

function computeReservedSpaceFact(snapshot: LayoutSignalSnapshot): LayoutReservedSpaceFact {
  const reasons: LayoutReservedSpaceReason[] = []

  const hasHeight = hasPositiveOrDeclaredDimension(snapshot, "height")
  if (hasHeight) reasons.push("height")

  const hasBlockSize = hasPositiveOrDeclaredDimension(snapshot, "block-size")
  if (hasBlockSize) reasons.push("block-size")

  const hasMinHeight = hasPositiveOrDeclaredDimension(snapshot, "min-height")
  if (hasMinHeight) reasons.push("min-height")

  const hasMinBlockSize = hasPositiveOrDeclaredDimension(snapshot, "min-block-size")
  if (hasMinBlockSize) reasons.push("min-block-size")

  const hasContainIntrinsic = hasPositiveOrDeclaredDimension(snapshot, "contain-intrinsic-size")
  if (hasContainIntrinsic) reasons.push("contain-intrinsic-size")

  const hasAspectRatio = hasUsableAspectRatio(snapshot)
  if (hasAspectRatio) {
    if (hasPositiveOrDeclaredDimension(snapshot, "width")) reasons.push("aspect-ratio+width")
    if (hasPositiveOrDeclaredDimension(snapshot, "inline-size")) reasons.push("aspect-ratio+inline-size")
    if (hasPositiveOrDeclaredDimension(snapshot, "min-width")) reasons.push("aspect-ratio+min-width")
    if (hasMinBlockSize) reasons.push("aspect-ratio+min-block-size")
    if (hasMinHeight) reasons.push("aspect-ratio+min-height")
  }

  return {
    hasReservedSpace: reasons.length > 0,
    reasons,
    hasUsableInlineDimension: hasPositiveOrDeclaredDimension(snapshot, "width")
      || hasPositiveOrDeclaredDimension(snapshot, "inline-size")
      || hasPositiveOrDeclaredDimension(snapshot, "min-width"),
    hasUsableBlockDimension: hasHeight || hasBlockSize || hasMinHeight || hasMinBlockSize,
    hasContainIntrinsicSize: hasContainIntrinsic,
    hasUsableAspectRatio: hasAspectRatio,
  }
}

function hasPositiveOrDeclaredDimension(
  snapshot: LayoutSignalSnapshot,
  property:
    | "width"
    | "inline-size"
    | "min-width"
    | "height"
    | "block-size"
    | "min-height"
    | "min-block-size"
    | "contain-intrinsic-size",
): boolean {
  const signal = snapshot.signals.get(property)
  if (!signal) return false
  if (signal.guard !== "unconditional") return false

  let normalized = ""
  if (signal.kind === "known") {
    if (signal.px !== null) return signal.px > 0
    normalized = signal.normalized.trim().toLowerCase()
  }

  if (signal.kind === "unknown") {
    if (signal.raw === null) return false
    normalized = signal.raw.trim().toLowerCase()
  }

  if (normalized.length === 0) return false
  if (isNonReservingDimension(normalized)) return false
  return true
}

function hasUsableAspectRatio(snapshot: LayoutSignalSnapshot): boolean {
  const signal = snapshot.signals.get("aspect-ratio")
  if (!signal) return false
  if (signal.guard !== "unconditional") return false

  let normalized = ""
  if (signal.kind === "known") {
    normalized = signal.normalized.trim().toLowerCase()
  }

  if (signal.kind === "unknown") {
    if (signal.raw === null) return false
    normalized = signal.raw.trim().toLowerCase()
  }

  if (normalized.length === 0) return false
  return normalized !== "auto"
}

function isNonReservingDimension(value: string): boolean {
  if (NON_RESERVING_DIMENSION_KEYWORDS.has(value)) return true
  if (value.startsWith("fit-content(")) return true
  return false
}

function computeScrollContainerFact(snapshot: LayoutSignalSnapshot): LayoutScrollContainerFact {
  const overflowSignal = snapshot.signals.get("overflow")
  const overflowYSignal = snapshot.signals.get("overflow-y")

  const overflow = overflowSignal && overflowSignal.kind === "known"
    ? overflowSignal.normalized
    : null
  const overflowY = overflowYSignal && overflowYSignal.kind === "known"
    ? overflowYSignal.normalized
    : null

  const shorthandAxis = parseOverflowShorthandAxis(overflow)
  const yFromLonghand = parseSingleAxisScroll(overflowY)

  const xScroll = shorthandAxis.x
  const yScroll = yFromLonghand === null ? shorthandAxis.y : yFromLonghand

  const hasConditionalScroll = (overflowSignal?.guard === "conditional" && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard === "conditional" && yFromLonghand === true)
  const hasUnconditionalScroll = (overflowSignal?.guard === "unconditional" && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard === "unconditional" && yFromLonghand === true)

  return {
    isScrollContainer: xScroll || yScroll,
    axis: toScrollAxis(xScroll, yScroll),
    overflow,
    overflowY,
    hasConditionalScroll,
    hasUnconditionalScroll,
  }
}

function parseOverflowShorthandAxis(value: string | null): { x: boolean; y: boolean } {
  if (value === null) return { x: false, y: false }

  const tokens = splitWhitespaceTokens(value)
  if (tokens.length === 0) return { x: false, y: false }
  const first = tokens[0]
  if (!first) return { x: false, y: false }
  if (tokens.length === 1) {
    const scroll = SCROLLABLE_VALUES.has(first)
    return { x: scroll, y: scroll }
  }

  const second = tokens[1]
  if (!second) return { x: SCROLLABLE_VALUES.has(first), y: false }

  return {
    x: SCROLLABLE_VALUES.has(first),
    y: SCROLLABLE_VALUES.has(second),
  }
}

function parseSingleAxisScroll(value: string | null): boolean | null {
  if (value === null) return null
  const tokens = splitWhitespaceTokens(value)
  const first = tokens[0]
  if (!first) return null
  return SCROLLABLE_VALUES.has(first)
}

function toScrollAxis(x: boolean, y: boolean): LayoutScrollContainerFact["axis"] {
  if (x && y) return "both"
  if (x) return "x"
  if (y) return "y"
  return "none"
}

function computeFlowParticipationFact(snapshot: LayoutSignalSnapshot): LayoutFlowParticipationFact {
  const signal = snapshot.signals.get("position")
  if (!signal || signal.kind !== "known") {
    return {
      inFlow: true,
      position: null,
      hasConditionalOutOfFlow: false,
      hasUnconditionalOutOfFlow: false,
    }
  }

  const position = signal.normalized
  const outOfFlow = position === "absolute" || position === "fixed"

  return {
    inFlow: !outOfFlow,
    position,
    hasConditionalOutOfFlow: signal.guard === "conditional" && outOfFlow,
    hasUnconditionalOutOfFlow: signal.guard === "unconditional" && outOfFlow,
  }
}

function buildContextIndex(
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  perf: LayoutPerfStatsMutable,
): ReadonlyMap<LayoutElementNode, AlignmentContext> {
  const out = new Map<LayoutElementNode, AlignmentContext>()

  for (const [parent, children] of childrenByParentNode) {
    if (children.length < 2) continue
    const snapshot = snapshotByElementNode.get(parent)
    if (!snapshot) {
      throw new Error(`missing parent snapshot for context classification ${parent.key}`)
    }

    out.set(parent, createAlignmentContextForParent(parent, snapshot))
    perf.contextsClassified++
  }

  return out
}
