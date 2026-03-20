import type { CSSGraph } from "../../css/impl"
import type { SelectorEntity } from "../../css/entities"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import { noopLogger, Level } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"

import {
  LayoutScrollAxis,
  type LayoutContainingBlockFact,
  type LayoutElementNode,
  type LayoutElementRecord,
  type LayoutElementRef,
  type LayoutFlowParticipationFact,
  type LayoutGraph,
  type LayoutMatchEdge,
  type LayoutReservedSpaceFact,
  type LayoutReservedSpaceReason,
  type LayoutScrollContainerFact,
  type LayoutStyleRuleNode,
} from "./graph"
import { collectCSSScopeBySolidFile } from "./scope"
import { createLayoutPerfStats, type LayoutPerfStatsMutable } from "./perf"
import { createLayoutModuleResolver } from "./module-resolver"
import { createLayoutComponentHostResolver } from "./component-host"
import type { AlignmentContext } from "./context-model"
import {
  EvidenceValueKind,
  LayoutSignalGuard,
  LayoutTextualContentState,
  SignalQuality,
  SignalValueKind,
  type HotNormalizedSignalEvidence,
  type HotNumericSignalEvidence,
  type LayoutSignalName,
  type LayoutSignalSnapshot,
  type LayoutSignalValue,
  type LayoutSnapshotHotSignals,
} from "./signal-model"
import { isControlTag, isReplacedTag } from "./signal-normalization"
import { compileSelectorMatcher, type FileElementIndex } from "./selector-match"
import { resolveRuleGuard } from "./guard-model"
import { buildSnapshotFromCascade } from "./signal-collection"
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
const EMPTY_EDGE_LIST: readonly LayoutMatchEdge[] = Object.freeze([])
const NON_RESERVING_DIMENSION_KEYWORDS = new Set(["auto", "none", "fit-content", "min-content", "max-content", "stretch"])
const BLOCK_LEVEL_DISPLAY_VALUES = new Set(["block", "flex", "grid", "table", "list-item", "flow-root", "table-row", "table-cell", "table-caption", "table-row-group", "table-header-group", "table-footer-group", "table-column", "table-column-group"])

export function buildLayoutGraph(solids: readonly SolidGraph[], css: CSSGraph, logger: Logger = noopLogger): LayoutGraph {
  const perf = createLayoutPerfStats()
  const startedAt = performance.now()

  const elements: LayoutElementNode[] = []
  const styleRules: LayoutStyleRuleNode[] = []
  const applies: LayoutMatchEdge[] = []
  const childrenByParentNodeMutable = new Map<LayoutElementNode, LayoutElementNode[]>()
  const elementBySolidFileAndIdMutable = new Map<string, Map<number, LayoutElementNode>>()
  const elementRefsBySolidFileAndIdMutable = new Map<string, Map<number, { solid: SolidGraph; element: JSXElementEntity }>>()
  const hostElementRefsByNodeMutable = new Map<LayoutElementNode, LayoutElementRef>()
  const appliesByElementNodeMutable = new Map<LayoutElementNode, LayoutMatchEdge[]>()
  const selectorsById = new Map<number, SelectorEntity>()
  const monitoredDeclarationsBySelectorId = new Map<number, readonly MonitoredDeclaration[]>()
  const selectorMetadataById = new Map<number, SelectorBuildMetadata>()


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

  if (logger.isLevelEnabled(Level.Trace)) {
    for (const [solidFile, scopePaths] of cssScopeBySolidFile) {
      if (scopePaths.length > 0) {
        let names = ""
        for (let k = 0; k < scopePaths.length; k++) {
          const p = scopePaths[k]
          if (!p) continue
          if (names.length > 0) names += ", "
          const slash = p.lastIndexOf("/")
          names += slash === -1 ? p : p.slice(slash + 1)
        }
        logger.trace(`[scope] ${solidFile} → ${scopePaths.length} CSS files: ${names}`)
      } else {
        logger.trace(`[scope] ${solidFile} → EMPTY (no CSS in scope)`)
      }
    }
  }

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

      if (record.hostElementRef !== null) {
        hostElementRefsByNodeMutable.set(node, record.hostElementRef)
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

  const fileElementIndexByFile = buildFileElementIndexByFile(elements)

  if (logger.isLevelEnabled(Level.Debug)) {
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
    fileElementIndexByFile,
    perf,
    logger,
  }

  const tailwind = css.tailwind
  const records = new Map<LayoutElementNode, LayoutElementRecord>()
  const snapshotByElementNode = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
  const snapshotHotSignalsByNode = new Map<LayoutElementNode, LayoutSnapshotHotSignals>()
  const elementsByTagName = new Map<string, LayoutElementNode[]>()
  const elementsByKnownSignalValue = new Map<LayoutSignalName, Map<string, LayoutElementNode[]>>()
  const dynamicSlotCandidateElements: LayoutElementNode[] = []
  const scrollContainerElements: LayoutElementNode[] = []
  const positionedAncestorByKey = new Map<string, { key: string; hasReservedSpace: boolean }>()
  const trace = logger.isLevelEnabled(Level.Trace)

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue

    // --- Step 1: Selector matching ---
    const selectorIds = selectorCandidatesByNode.get(node) ?? EMPTY_NUMBER_LIST
    if (selectorIds.length > 0) {
      appendMatchingEdgesFromSelectorIds(
        selectorMatchCtx, selectorIds, node, applies, appliesByElementNodeMutable,
      )
    }

    // --- Step 2: Cascade ---
    const mutableEdges = appliesByElementNodeMutable.get(node)
    if (mutableEdges) mutableEdges.sort(compareLayoutEdge)
    const edges: readonly LayoutMatchEdge[] = mutableEdges ?? EMPTY_EDGE_LIST
    const cascade = buildCascadeMapForElement(node, edges, monitoredDeclarationsBySelectorId, tailwind)

    if (trace && cascade.size > 0) {
      const displayDecl = cascade.get("display")
      const flexDirDecl = cascade.get("flex-direction")
      if (displayDecl || flexDirDecl) {
        const displayGuard = displayDecl?.guardProvenance.kind === LayoutSignalGuard.Conditional ? "conditional" : "unconditional"
        const flexDirGuard = flexDirDecl?.guardProvenance.kind === LayoutSignalGuard.Conditional ? "conditional" : "unconditional"
        logger.trace(
          `[cascade] node=${node.key} tag=${node.tagName ?? "null"}`
          + ` display=${displayDecl ? `${displayDecl.value}(${displayGuard})` : "absent"}`
          + ` flex-direction=${flexDirDecl ? `${flexDirDecl.value}(${flexDirGuard})` : "absent"}`
          + ` edges=${edges.length} attrs=[${[...node.attributes.keys()].join(",")}]`,
        )
      }
    }

    // --- Step 3: Signal snapshot (forward pass — parent already in records) ---
    const parentSnapshot = node.parentElementNode
      ? (records.get(node.parentElementNode)?.snapshot ?? null)
      : null
    const snapshot = buildSnapshotFromCascade(node, cascade, parentSnapshot)
    snapshotByElementNode.set(node, snapshot)
    perf.signalSnapshotsBuilt++

    // --- Step 4: Secondary indexes ---
    if (node.textualContent === LayoutTextualContentState.Unknown && node.siblingCount >= 2) {
      dynamicSlotCandidateElements.push(node)
    }
    if (node.tagName) {
      const existing = elementsByTagName.get(node.tagName)
      if (existing) existing.push(node)
      else elementsByTagName.set(node.tagName, [node])
    }
    for (const [signal, value] of snapshot.signals) {
      if (value.kind !== SignalValueKind.Known) continue
      let byValue = elementsByKnownSignalValue.get(signal)
      if (!byValue) {
        byValue = new Map<string, LayoutElementNode[]>()
        elementsByKnownSignalValue.set(signal, byValue)
      }
      const existingNodes = byValue.get(value.normalized)
      if (existingNodes) existingNodes.push(node)
      else byValue.set(value.normalized, [node])
    }

    // --- Step 5: Facts ---
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
    const containingBlock: LayoutContainingBlockFact = {
      nearestPositionedAncestorKey,
      nearestPositionedAncestorHasReservedSpace,
    }

    const reservedSpace = computeReservedSpaceFact(snapshot)
    const scrollContainer = computeScrollContainerFact(snapshot)
    if (scrollContainer.isScrollContainer) scrollContainerElements.push(node)
    const flowParticipation = computeFlowParticipationFact(snapshot)
    const hotSignals = computeHotSignals(snapshot)
    snapshotHotSignalsByNode.set(node, hotSignals)

    const positionSignal = snapshot.signals.get("position")
    const isPositioned = positionSignal !== undefined
      && positionSignal.kind === SignalValueKind.Known
      && positionSignal.normalized !== "static"
    if (isPositioned) {
      positionedAncestorByKey.set(node.key, { key: node.key, hasReservedSpace: reservedSpace.hasReservedSpace })
    } else if (parentKey !== null) {
      const inherited = positionedAncestorByKey.get(parentKey)
      if (inherited !== undefined) positionedAncestorByKey.set(node.key, inherited)
    }

    // --- Step 6: Record ---
    records.set(node, {
      ref: elementRefsBySolidFileAndIdMutable.get(node.solidFile)?.get(node.elementId) ?? null,
      edges,
      cascade,
      snapshot,
      hotSignals,
      reservedSpace,
      scrollContainer,
      flowParticipation,
      containingBlock,
      conditionalDelta: null,
      baselineOffsets: null,
    })
  }

  perf.selectorMatchMs = performance.now() - selectorMatchStartedAt

  // Conditional delta analysis — requires all edges to be finalized
  const conditionalDeltaIndex = buildConditionalDeltaIndex(
    elements,
    records,
    monitoredDeclarationsBySelectorId,
    selectorsById,
  )
  // Patch conditional delta and baseline offsets into records
  for (const [node, deltaByProperty] of conditionalDeltaIndex.conditionalSignalDeltaFactsByNode) {
    const record = records.get(node)
    if (!record) continue
    const baselineOffsets = conditionalDeltaIndex.baselineOffsetFactsByNode.get(node) ?? null
    records.set(node, {
      ref: record.ref,
      edges: record.edges,
      cascade: record.cascade,
      snapshot: record.snapshot,
      hotSignals: record.hotSignals,
      reservedSpace: record.reservedSpace,
      scrollContainer: record.scrollContainer,
      flowParticipation: record.flowParticipation,
      containingBlock: record.containingBlock,
      conditionalDelta: deltaByProperty,
      baselineOffsets,
    })
  }

  const elementsWithConditionalOverflowDelta = buildConditionalDeltaSignalGroupElements(
    conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    ["overflow", "overflow-y"],
  )
  const elementsWithConditionalOffsetDelta = buildConditionalDeltaSignalGroupElements(
    conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    layoutOffsetSignals,
  )

  const measurementNodeByRootKey = buildMeasurementNodeIndex(elements, childrenByParentNodeMutable, snapshotByElementNode)
  const statefulRuleIndexes = buildStatefulRuleIndexes(css.rules)
  const contextByParentNode = buildContextIndex(childrenByParentNodeMutable, snapshotByElementNode, perf, logger)
  const cohortIndex = buildCohortIndex({
    childrenByParentNode: childrenByParentNodeMutable,
    contextByParentNode,
    measurementNodeByRootKey,
    snapshotByElementNode,
    snapshotHotSignalsByNode,
  })

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
    hostElementRefsByNode: hostElementRefsByNodeMutable,
    selectorCandidatesByNode,
    selectorsById,
    measurementNodeByRootKey,
    records,
    elementsByTagName,
    elementsWithConditionalDeltaBySignal: conditionalDeltaIndex.elementsWithConditionalDeltaBySignal,
    elementsWithConditionalOverflowDelta,
    elementsWithConditionalOffsetDelta,
    elementsByKnownSignalValue,
    dynamicSlotCandidateElements,
    scrollContainerElements,
    statefulSelectorEntriesByRuleId: statefulRuleIndexes.selectorEntriesByRuleId,
    statefulNormalizedDeclarationsByRuleId: statefulRuleIndexes.normalizedDeclarationsByRuleId,
    statefulBaseValueIndex: statefulRuleIndexes.baseValueIndex,
    cohortStatsByParentNode: cohortIndex.statsByParentNode,
    contextByParentNode,
    perf,
  }
}

function buildFileElementIndexByFile(
  elements: readonly LayoutElementNode[],
): ReadonlyMap<string, FileElementIndex> {
  const byFileDispatch = new Map<string, Map<string, LayoutElementNode[]>>()
  const byFileTag = new Map<string, Map<string, LayoutElementNode[]>>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    if (node.parentElementNode === null) continue

    const file = node.solidFile
    let dispatchMap = byFileDispatch.get(file)
    if (!dispatchMap) {
      dispatchMap = new Map()
      byFileDispatch.set(file, dispatchMap)
    }

    const keys = node.selectorDispatchKeys
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j]
      if (!key) continue
      const existing = dispatchMap.get(key)
      if (existing) {
        existing.push(node)
      } else {
        dispatchMap.set(key, [node])
      }
    }

    if (node.tagName !== null) {
      let tagMap = byFileTag.get(file)
      if (!tagMap) {
        tagMap = new Map()
        byFileTag.set(file, tagMap)
      }
      const existing = tagMap.get(node.tagName)
      if (existing) {
        existing.push(node)
      } else {
        tagMap.set(node.tagName, [node])
      }
    }
  }

  const out = new Map<string, FileElementIndex>()
  for (const [file, dispatchMap] of byFileDispatch) {
    out.set(file, {
      byDispatchKey: dispatchMap,
      byTagName: byFileTag.get(file) ?? new Map(),
    })
  }
  return out
}

const ABSENT_NUMERIC: HotNumericSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})
const ABSENT_NORMALIZED: HotNormalizedSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})

function toHotNumeric(signal: LayoutSignalValue): HotNumericSignalEvidence {
  if (signal.kind !== SignalValueKind.Known) {
    return {
      present: true,
      value: null,
      kind: signal.guard.kind === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.px,
    kind: signal.guard.kind === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === SignalQuality.Estimated ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

function toHotNormalized(signal: LayoutSignalValue): HotNormalizedSignalEvidence {
  if (signal.kind !== SignalValueKind.Known) {
    return {
      present: true,
      value: null,
      kind: signal.guard.kind === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.normalized,
    kind: signal.guard.kind === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === SignalQuality.Estimated ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
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

  const hasHeight = hasDeclaredDimension(snapshot, "height")
  if (hasHeight) reasons.push("height")

  const hasBlockSize = hasDeclaredDimension(snapshot, "block-size")
  if (hasBlockSize) reasons.push("block-size")

  const hasMinHeight = hasDeclaredDimension(snapshot, "min-height")
  if (hasMinHeight) reasons.push("min-height")

  const hasMinBlockSize = hasDeclaredDimension(snapshot, "min-block-size")
  if (hasMinBlockSize) reasons.push("min-block-size")

  const hasContainIntrinsic = hasDeclaredDimension(snapshot, "contain-intrinsic-size")
  if (hasContainIntrinsic) reasons.push("contain-intrinsic-size")

  const hasAspectRatio = hasUsableAspectRatio(snapshot)
  if (hasAspectRatio) {
    if (hasDeclaredDimension(snapshot, "width")) reasons.push("aspect-ratio+width")
    if (hasDeclaredDimension(snapshot, "inline-size")) reasons.push("aspect-ratio+inline-size")
    if (hasDeclaredDimension(snapshot, "min-width")) reasons.push("aspect-ratio+min-width")
    if (hasMinBlockSize) reasons.push("aspect-ratio+min-block-size")
    if (hasMinHeight) reasons.push("aspect-ratio+min-height")
  }

  return {
    hasReservedSpace: reasons.length > 0,
    reasons,
    hasContainIntrinsicSize: hasContainIntrinsic,
    hasUsableAspectRatio: hasAspectRatio,
    hasDeclaredBlockDimension: hasHeight || hasBlockSize || hasMinHeight || hasMinBlockSize,
    hasDeclaredInlineDimension: hasDeclaredDimension(snapshot, "width")
      || hasDeclaredDimension(snapshot, "inline-size")
      || hasDeclaredDimension(snapshot, "min-width")
      || isBlockLevelDisplay(snapshot),
  }
}

function hasDeclaredDimension(
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
  if (signal.kind === SignalValueKind.Known) {
    if (signal.px !== null) return signal.px > 0
    const normalized = signal.normalized.trim().toLowerCase()
    if (normalized.length === 0) return false
    return !isNonReservingDimension(normalized)
  }
  if (signal.kind === SignalValueKind.Unknown) {
    return signal.source !== null
  }
  return false
}

function isBlockLevelDisplay(snapshot: LayoutSignalSnapshot): boolean {
  const signal = snapshot.signals.get("display")
  if (!signal || signal.kind !== SignalValueKind.Known) return false
  return BLOCK_LEVEL_DISPLAY_VALUES.has(signal.normalized)
}

function hasUsableAspectRatio(snapshot: LayoutSignalSnapshot): boolean {
  const signal = snapshot.signals.get("aspect-ratio")
  if (!signal) return false
  if (signal.guard.kind !== LayoutSignalGuard.Unconditional) return false

  if (signal.kind === SignalValueKind.Unknown) {
    return false
  }

  let normalized = ""
  if (signal.kind === SignalValueKind.Known) {
    normalized = signal.normalized.trim().toLowerCase()
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

  const overflow = overflowSignal && overflowSignal.kind === SignalValueKind.Known
    ? overflowSignal.normalized
    : null
  const overflowY = overflowYSignal && overflowYSignal.kind === SignalValueKind.Known
    ? overflowYSignal.normalized
    : null

  const shorthandAxis = parseOverflowShorthandAxis(overflow)
  const yFromLonghand = parseSingleAxisScroll(overflowY)

  const xScroll = shorthandAxis.x
  const yScroll = yFromLonghand === null ? shorthandAxis.y : yFromLonghand

  const hasConditionalScroll = (overflowSignal?.guard.kind === LayoutSignalGuard.Conditional && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard.kind === LayoutSignalGuard.Conditional && yFromLonghand === true)
  const hasUnconditionalScroll = (overflowSignal?.guard.kind === LayoutSignalGuard.Unconditional && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard.kind === LayoutSignalGuard.Unconditional && yFromLonghand === true)

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
  if (!signal || signal.kind !== SignalValueKind.Known) {
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
    hasConditionalOutOfFlow: signal.guard.kind === LayoutSignalGuard.Conditional && outOfFlow,
    hasUnconditionalOutOfFlow: signal.guard.kind === LayoutSignalGuard.Unconditional && outOfFlow,
  }
}

function buildContextIndex(
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  perf: LayoutPerfStatsMutable,
  logger: Logger,
): Map<LayoutElementNode, AlignmentContext> {
  const out = new Map<LayoutElementNode, AlignmentContext>()
  const trace = logger.isLevelEnabled(Level.Trace)

  for (const [parent, children] of childrenByParentNode) {
    if (children.length < 2) continue
    const snapshot = snapshotByElementNode.get(parent)
    if (!snapshot) {
      throw new Error(`missing parent snapshot for context classification ${parent.key}`)
    }

    const ctx = createAlignmentContextForParent(parent, snapshot)
    out.set(parent, ctx)
    perf.contextsClassified++

    if (trace) {
      const displaySignal = snapshot.signals.get("display")
      const flexDirSignal = snapshot.signals.get("flex-direction")
      const displayDesc = displaySignal
        ? `${displaySignal.kind}:${displaySignal.kind === SignalValueKind.Known ? displaySignal.normalized : "?"}(guard=${displaySignal.guard.kind === LayoutSignalGuard.Conditional ? "conditional" : "unconditional"})`
        : "absent"
      const flexDirDesc = flexDirSignal
        ? `${flexDirSignal.kind}:${flexDirSignal.kind === SignalValueKind.Known ? flexDirSignal.normalized : "?"}(guard=${flexDirSignal.guard.kind === LayoutSignalGuard.Conditional ? "conditional" : "unconditional"})`
        : "absent"
      logger.trace(
        `[context] parent=${parent.key} tag=${parent.tagName ?? "null"} children=${children.length}`
        + ` display=${displayDesc} flex-direction=${flexDirDesc}`
        + ` → kind=${ctx.kind} certainty=${ctx.certainty}`
        + ` crossAxisIsBlockAxis=${ctx.crossAxisIsBlockAxis} baseline=${ctx.baselineRelevance}`,
      )
    }
  }

  return out
}
