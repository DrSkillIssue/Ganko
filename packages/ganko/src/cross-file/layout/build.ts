import type { CSSGraph } from "../../css/impl"
import type { SelectorEntity } from "../../css/entities"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import { noopLogger } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"

import {
  LayoutScrollAxis,
  type LayoutCascadedDeclaration,
  type LayoutContainingBlockFact,
  type LayoutElementNode,
  type LayoutFlowParticipationFact,
  type LayoutGraph,
  type LayoutMatchEdge,
  type LayoutReservedSpaceFact,
  type LayoutReservedSpaceReason,
  type LayoutScrollContainerFact,
  type LayoutStyleRuleNode,
} from "./graph"
import { toLayoutElementKey } from "./graph"
import { collectCSSScopeBySolidFile } from "./scope"
import { createLayoutPerfStats, type LayoutPerfStatsMutable } from "./perf"
import { createLayoutModuleResolver } from "./module-resolver"
import { createLayoutComponentHostResolver } from "./component-host"
import type { AlignmentContext } from "./context-model"
import {
  EvidenceValueKind,
  LayoutSignalGuard,
  LayoutTextualContentState,
  type HotNormalizedSignalEvidence,
  type HotNumericSignalEvidence,
  type LayoutSignalName,
  type LayoutSignalSnapshot,
  type LayoutSignalValue,
  type LayoutSnapshotHotSignals,
} from "./signal-model"
import { isControlTag, isReplacedTag } from "./signal-normalization"
import { compileSelectorMatcher } from "./selector-match"
import { resolveRuleGuard } from "./guard-model"
import { buildSignalSnapshotIndex } from "./signal-collection"
import { createAlignmentContextForParent, finalizeTableCellBaselineRelevance } from "./context-classification"
import { buildCohortIndex } from "./cohort-index"
import { buildMeasurementNodeIndex } from "./measurement-node"
import {
  type SelectorBuildMetadata,
  buildScopedSelectorIndexBySolidFile,
  buildSelectorCandidatesByNode,
} from "./selector-dispatch"
import { buildStatefulRuleIndexes } from "./stateful-rule-index"
import { layoutOffsetSignals } from "./offset-baseline"
import {
  type MonitoredDeclaration,
  collectMonitoredDeclarations,
  resolveRuleLayerOrder,
  appendMatchingEdgesFromSelectorIds,
  type SelectorMatchContext,
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

  const selectorCandidatesByNode = buildSelectorCandidatesByNode(elements, scopedSelectorsBySolidFile, perf)

  const selectorMatchCtx: SelectorMatchContext = {
    selectorMetadataById,
    selectorsById,
    rootElementsByFile,
    perf,
    logger,
  }

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const selectorIds = selectorCandidatesByNode.get(node) ?? EMPTY_NUMBER_LIST
    if (selectorIds.length === 0) continue
    appendMatchingEdgesFromSelectorIds(
      selectorMatchCtx,
      selectorIds,
      node,
      applies,
      appliesByElementNodeMutable,
    )
  }

  perf.selectorMatchMs = performance.now() - selectorMatchStartedAt

  const cascadeStartedAt = performance.now()
  for (const edges of appliesByElementNodeMutable.values()) {
    edges.sort(compareLayoutEdge)
  }

  const appliesByNode = new Map<LayoutElementNode, readonly LayoutMatchEdge[]>()

  const tailwind = css.tailwind
  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const edges = appliesByElementNodeMutable.get(node) ?? []
    const cascade = buildCascadeMapForElement(node, edges, monitoredDeclarationsBySelectorId, tailwind)
    cascadeByElementNode.set(node, cascade)
    appliesByNode.set(node, edges)
  }
  perf.cascadeBuildMs = performance.now() - cascadeStartedAt
  const snapshotByElementNode = buildSignalSnapshotIndex(elements, cascadeByElementNode, perf)
  const measurementNodeByRootKey = buildMeasurementNodeIndex(elements, childrenByParentNodeMutable, snapshotByElementNode)

  const factIndex = buildElementFactIndex(elements, snapshotByElementNode)
  const conditionalDeltaIndex = buildConditionalDeltaIndex(
    elements,
    appliesByNode,
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
    snapshotHotSignalsByNode: factIndex.snapshotHotSignalsByNode,
  })

  // Finalize table-cell baselineRelevance now that cohort vertical-align
  // consensus is available. This is a two-phase construction: contexts are
  // built before cohort indexing (cohort needs axis data), then table-cell
  // contexts are refined with cohort-level vertical-align consensus.
  finalizeTableCellBaselineRelevance(contextByParentNode, cohortIndex.verticalAlignConsensusByParent)

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
    appliesByNode,
    selectorCandidatesByNode,
    selectorsById,
    measurementNodeByRootKey,
    snapshotHotSignalsByNode: factIndex.snapshotHotSignalsByNode,
    elementsByTagName: factIndex.elementsByTagName,
    elementsWithConditionalDeltaBySignal: conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    elementsWithConditionalOverflowDelta,
    elementsWithConditionalOffsetDelta,
    elementsByKnownSignalValue: factIndex.elementsByKnownSignalValue,
    dynamicSlotCandidateElements: factIndex.dynamicSlotCandidateElements,
    scrollContainerElements: factIndex.scrollContainerElements,
    reservedSpaceFactsByNode: factIndex.reservedSpaceFactsByNode,
    scrollContainerFactsByNode: factIndex.scrollContainerFactsByNode,
    flowParticipationFactsByNode: factIndex.flowParticipationFactsByNode,
    containingBlockFactsByNode: factIndex.containingBlockFactsByNode,
    conditionalSignalDeltaFactsByNode: conditionalDeltaIndex.conditionalSignalDeltaFactsByNode,
    baselineOffsetFactsByNode: conditionalDeltaIndex.baselineOffsetFactsByNode,
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
  readonly reservedSpaceFactsByNode: ReadonlyMap<LayoutElementNode, LayoutReservedSpaceFact>
  readonly scrollContainerFactsByNode: ReadonlyMap<LayoutElementNode, LayoutScrollContainerFact>
  readonly scrollContainerElements: readonly LayoutElementNode[]
  readonly flowParticipationFactsByNode: ReadonlyMap<LayoutElementNode, LayoutFlowParticipationFact>
  readonly containingBlockFactsByNode: ReadonlyMap<LayoutElementNode, LayoutContainingBlockFact>
  readonly snapshotHotSignalsByNode: ReadonlyMap<LayoutElementNode, LayoutSnapshotHotSignals>
  readonly elementsByTagName: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly elementsByKnownSignalValue: ReadonlyMap<LayoutSignalName, ReadonlyMap<string, readonly LayoutElementNode[]>>
  readonly dynamicSlotCandidateElements: readonly LayoutElementNode[]
}

function buildElementFactIndex(
  elements: readonly LayoutElementNode[],
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
): ElementFactIndex {
  const reservedSpaceFactsByNode = new Map<LayoutElementNode, LayoutReservedSpaceFact>()
  const scrollContainerFactsByNode = new Map<LayoutElementNode, LayoutScrollContainerFact>()
  const flowParticipationFactsByNode = new Map<LayoutElementNode, LayoutFlowParticipationFact>()
  const containingBlockFactsByNode = new Map<LayoutElementNode, LayoutContainingBlockFact>()
  const snapshotHotSignalsByNode = new Map<LayoutElementNode, LayoutSnapshotHotSignals>()
  const elementsByTagName = new Map<string, LayoutElementNode[]>()
  const elementsByKnownSignalValue = new Map<LayoutSignalName, Map<string, LayoutElementNode[]>>()
  const dynamicSlotCandidateElements: LayoutElementNode[] = []
  const scrollContainerElements: LayoutElementNode[] = []
  const positionedAncestorByKey = new Map<string, { key: string; hasReservedSpace: boolean }>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    const snapshot = snapshotByElementNode.get(node)

    if (node.textualContent === LayoutTextualContentState.Unknown && node.siblingCount >= 2) {
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

    containingBlockFactsByNode.set(node, {
      nearestPositionedAncestorKey,
      nearestPositionedAncestorHasReservedSpace,
    })

    if (!snapshot) continue

    const reservedSpaceFact = computeReservedSpaceFact(snapshot)
    reservedSpaceFactsByNode.set(node, reservedSpaceFact)
    const scrollFact = computeScrollContainerFact(snapshot)
    scrollContainerFactsByNode.set(node, scrollFact)
    if (scrollFact.isScrollContainer) scrollContainerElements.push(node)
    flowParticipationFactsByNode.set(node, computeFlowParticipationFact(snapshot))
    snapshotHotSignalsByNode.set(node, computeHotSignals(snapshot))

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
    reservedSpaceFactsByNode,
    scrollContainerFactsByNode,
    scrollContainerElements,
    flowParticipationFactsByNode,
    containingBlockFactsByNode,
    snapshotHotSignalsByNode,
    elementsByTagName,
    elementsByKnownSignalValue,
    dynamicSlotCandidateElements,
  }
}

const ABSENT_NUMERIC: HotNumericSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})
const ABSENT_NORMALIZED: HotNormalizedSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})

function toHotNumeric(signal: LayoutSignalValue): HotNumericSignalEvidence {
  if (signal.kind !== "known") {
    return {
      present: true,
      value: null,
      kind: signal.guard === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.px,
    kind: signal.guard === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === "estimated" ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

function toHotNormalized(signal: LayoutSignalValue): HotNormalizedSignalEvidence {
  if (signal.kind !== "known") {
    return {
      present: true,
      value: null,
      kind: signal.guard === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.normalized,
    kind: signal.guard === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === "estimated" ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

function computeHotSignals(snapshot: LayoutSignalSnapshot): LayoutSnapshotHotSignals {
  let lineHeight: HotNumericSignalEvidence = ABSENT_NUMERIC
  let verticalAlign: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let flexDirection: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let gridAutoFlow: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let writingMode: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let direction: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let display: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let position: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let insetBlockStart: HotNumericSignalEvidence = ABSENT_NUMERIC
  let insetBlockEnd: HotNumericSignalEvidence = ABSENT_NUMERIC
  let transform: HotNumericSignalEvidence = ABSENT_NUMERIC
  let translate: HotNumericSignalEvidence = ABSENT_NUMERIC
  let top: HotNumericSignalEvidence = ABSENT_NUMERIC
  let bottom: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginTop: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginBottom: HotNumericSignalEvidence = ABSENT_NUMERIC

  for (const [name, value] of snapshot.signals) {
    switch (name) {
      case "line-height": lineHeight = toHotNumeric(value); break
      case "vertical-align": verticalAlign = toHotNormalized(value); break
      case "align-self": alignSelf = toHotNormalized(value); break
      case "place-self": placeSelf = toHotNormalized(value); break
      case "flex-direction": flexDirection = toHotNormalized(value); break
      case "grid-auto-flow": gridAutoFlow = toHotNormalized(value); break
      case "writing-mode": writingMode = toHotNormalized(value); break
      case "direction": direction = toHotNormalized(value); break
      case "display": display = toHotNormalized(value); break
      case "align-items": alignItems = toHotNormalized(value); break
      case "place-items": placeItems = toHotNormalized(value); break
      case "position": position = toHotNormalized(value); break
      case "inset-block-start": insetBlockStart = toHotNumeric(value); break
      case "inset-block-end": insetBlockEnd = toHotNumeric(value); break
      case "transform": transform = toHotNumeric(value); break
      case "translate": translate = toHotNumeric(value); break
      case "top": top = toHotNumeric(value); break
      case "bottom": bottom = toHotNumeric(value); break
      case "margin-top": marginTop = toHotNumeric(value); break
      case "margin-bottom": marginBottom = toHotNumeric(value); break
      default: break
    }
  }

  return {
    lineHeight, verticalAlign, alignSelf, placeSelf,
    flexDirection, gridAutoFlow, writingMode, direction,
    display, alignItems, placeItems, position,
    insetBlockStart, insetBlockEnd, transform, translate,
    top, bottom, marginTop, marginBottom,
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
  if (signal.guard !== LayoutSignalGuard.Unconditional) return false

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
  if (signal.guard !== LayoutSignalGuard.Unconditional) return false

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

  const hasConditionalScroll = (overflowSignal?.guard === LayoutSignalGuard.Conditional && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard === LayoutSignalGuard.Conditional && yFromLonghand === true)
  const hasUnconditionalScroll = (overflowSignal?.guard === LayoutSignalGuard.Unconditional && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard === LayoutSignalGuard.Unconditional && yFromLonghand === true)

  return {
    isScrollContainer: xScroll || yScroll,
    axis: toScrollAxis(xScroll, yScroll),
    overflow,
    overflowY,
    hasConditionalScroll,
    hasUnconditionalScroll,
  }
}

const NO_SCROLL = Object.freeze({ x: false, y: false })
const BOTH_SCROLL = Object.freeze({ x: true, y: true })

function parseOverflowShorthandAxis(value: string | null): { x: boolean; y: boolean } {
  if (value === null) return NO_SCROLL
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) {
    const scroll = SCROLLABLE_VALUES.has(trimmed)
    return scroll ? BOTH_SCROLL : NO_SCROLL
  }
  const first = trimmed.slice(0, spaceIdx)
  const second = trimmed.slice(spaceIdx + 1).trimStart()
  return {
    x: SCROLLABLE_VALUES.has(first),
    y: SCROLLABLE_VALUES.has(second),
  }
}

function parseSingleAxisScroll(value: string | null): boolean | null {
  if (value === null) return null
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  return SCROLLABLE_VALUES.has(first)
}

function toScrollAxis(x: boolean, y: boolean): LayoutScrollAxis {
  if (x && y) return LayoutScrollAxis.Both
  if (x) return LayoutScrollAxis.X
  if (y) return LayoutScrollAxis.Y
  return LayoutScrollAxis.None
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
    hasConditionalOutOfFlow: signal.guard === LayoutSignalGuard.Conditional && outOfFlow,
    hasUnconditionalOutOfFlow: signal.guard === LayoutSignalGuard.Unconditional && outOfFlow,
  }
}

function buildContextIndex(
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  perf: LayoutPerfStatsMutable,
): Map<LayoutElementNode, AlignmentContext> {
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
