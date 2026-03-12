import type { ContextCertainty, LayoutAxisModel, AlignmentContext } from "./context-model"
import type { LayoutElementNode } from "./graph"
import type {
  AlignmentCohortProfile,
  AlignmentCohortSignals,
  AlignmentElementEvidence,
  AlignmentTextContrast,
  CohortIdentifiability,
  EvidenceProvenance,
  EvidenceValueKind,
  LayoutCohortStats,
  LayoutCohortSubjectStats,
  LayoutSignalSnapshot,
  LayoutSnapshotHotSignals,
  NumericEvidenceValue,
  SignalConflictEvidence,
} from "./signal-model"
import { summarizeSignalFacts } from "./consistency-domain"
import { computeContentCompositionFingerprint } from "./content-composition"
import { estimateBlockOffsetWithDeclaredFromHotSignals } from "./offset"
import { readKnownNormalized, isLayoutHidden } from "./signal-access"
import type { LayoutGuardConditionProvenance } from "./guard-model"
import { mergeEvidenceKind, toComparableExactValue } from "./util"

interface CohortMetrics {
  readonly key: string
  readonly element: AlignmentElementEvidence
  readonly measurementNode: LayoutElementNode
  readonly rootNode: LayoutElementNode
  readonly hotSignals: LayoutSnapshotHotSignals
  readonly declaredOffset: NumericEvidenceValue
  readonly effectiveOffset: NumericEvidenceValue
  readonly lineHeight: NumericEvidenceValue
}

interface CohortProfileBuffers {
  readonly declaredOffsets: number[]
  readonly effectiveOffsets: number[]
  readonly lineHeights: number[]
  readonly deviationScratch: number[]
  readonly baselineDeclaredValues: (number | null)[]
  readonly baselineEffectiveValues: (number | null)[]
  readonly baselineLineHeightValues: (number | null)[]
  readonly baselineDeclaredSorted: number[]
  readonly baselineEffectiveSorted: number[]
  readonly baselineLineHeightSorted: number[]
}

interface ComparableClusterSummary {
  readonly comparableCount: number
  readonly clusterCount: number
  readonly dominantClusterSize: number
  readonly dominantClusterCount: number
  readonly clusterSizeByKey: ReadonlyMap<string, number>
}

interface CohortSignalAggregate {
  readonly mergedKind: EvidenceValueKind
  readonly comparableCount: number
  readonly countsByValue: ReadonlyMap<string, number>
}

interface CohortSignalsByElement {
  readonly verticalAlign: LayoutSnapshotHotSignals["verticalAlign"]
  readonly alignSelf: LayoutSnapshotHotSignals["alignSelf"]
  readonly placeSelf: LayoutSnapshotHotSignals["placeSelf"]
  readonly textualContent: LayoutSignalSnapshot["textualContent"]
  readonly isControlOrReplaced: boolean
}

interface CohortSignalIndex {
  readonly byKey: ReadonlyMap<string, CohortSignalsByElement>
  readonly verticalAlign: CohortSignalAggregate
  readonly alignSelf: CohortSignalAggregate
  readonly placeSelf: CohortSignalAggregate
  readonly controlOrReplacedCount: number
  readonly textYesCount: number
  readonly textNoCount: number
  readonly textUnknownCount: number
}

export interface CohortIndex {
  readonly statsByParentNode: ReadonlyMap<LayoutElementNode, LayoutCohortStats>
  readonly conditionalSignals: number
  readonly totalSignals: number
  readonly unimodalFalseCount: number
  readonly measurementIndexHits: number
}

export function buildCohortIndex(input: {
  readonly childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>
  readonly contextByParentNode: ReadonlyMap<LayoutElementNode, AlignmentContext>
  readonly measurementNodeByRootKey: ReadonlyMap<string, LayoutElementNode>
  readonly snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>
  readonly snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>
}): CohortIndex {
  const statsByParentNode = new Map<LayoutElementNode, LayoutCohortStats>()
  const profileBuffers = createCohortProfileBuffers()

  let conditionalSignals = 0
  let totalSignals = 0
  let unimodalFalseCount = 0
  let measurementIndexHits = 0

  for (const [parent, children] of input.childrenByParentNode) {
    if (children.length < 2) continue

    const context = input.contextByParentNode.get(parent)
    if (!context) {
      throw new Error(`missing context for parent ${parent.key}`)
    }

    const cohortMetricsResult = collectCohortMetrics({
      children,
      axis: context.axis,
      axisCertainty: context.axisCertainty,
      measurementNodeByRootKey: input.measurementNodeByRootKey,
      snapshotByElementNode: input.snapshotByElementNode,
      snapshotHotSignalsByElementKey: input.snapshotHotSignalsByElementKey,
    })
    measurementIndexHits += cohortMetricsResult.measurementHits

    const metrics = cohortMetricsResult.metrics
    if (metrics.length < 2) continue

    const clusterSummary = summarizeComparableClusters(metrics)
    const profile = buildCohortProfile(metrics, profileBuffers, clusterSummary)
    const baselineProfiles = buildSubjectBaselineProfiles(metrics, profile, clusterSummary, profileBuffers)
    const signalIndex = buildCohortSignalIndex(metrics)
    const cohortEvidenceKind = resolveCohortEvidenceKind(metrics)
    const snapshots = collectCohortSnapshots(metrics)
    const factSummary = summarizeSignalFacts(snapshots)
    const provenance = collectCohortProvenanceFromSnapshots(snapshots)
    const counts = collectConditionalSignalCounts(snapshots)
    const subjectsByElementKey = new Map<string, LayoutCohortSubjectStats>()

    for (let i = 0; i < metrics.length; i++) {
      const subjectMetrics = metrics[i]
      if (!subjectMetrics) continue
      const signals = collectSubjectCohortSignals(signalIndex, subjectMetrics, context)
      const baselineProfile = baselineProfiles[i]
      if (!baselineProfile) continue
      const identifiability = resolveSubjectIdentifiability(
        subjectMetrics,
        profile,
        baselineProfile,
        clusterSummary,
        signalIndex,
        cohortEvidenceKind,
        metrics.length,
      )

      const contentComposition = computeContentCompositionFingerprint(
        subjectMetrics.rootNode,
        input.childrenByParentNode,
        input.snapshotByElementNode,
        input.snapshotHotSignalsByElementKey,
      )

      subjectsByElementKey.set(subjectMetrics.key, {
        element: subjectMetrics.element,
        declaredOffset: subjectMetrics.declaredOffset,
        effectiveOffset: subjectMetrics.effectiveOffset,
        lineHeight: subjectMetrics.lineHeight,
        baselineProfile,
        signals,
        identifiability,
        contentComposition,
      })
    }

    statsByParentNode.set(parent, {
      profile,
      snapshots,
      factSummary,
      provenance,
      conditionalSignalCount: counts.conditional,
      totalSignalCount: counts.total,
      subjectsByElementKey,
      excludedElementKeys: cohortMetricsResult.excludedElementKeys,
    })

    conditionalSignals += counts.conditional
    totalSignals += counts.total
    if (!profile.unimodal) unimodalFalseCount++
  }

  return {
    statsByParentNode,
    conditionalSignals,
    totalSignals,
    unimodalFalseCount,
    measurementIndexHits,
  }
}

/**
 * Detects elements that are unconditionally out of normal flow. Elements with
 * `position: absolute` or `position: fixed` do not participate in the parent's
 * layout flow and must be excluded from sibling alignment cohort analysis.
 *
 * Covers patterns such as:
 * - Accessible hidden checkboxes (position: absolute; width: 0; height: 0)
 * - Floating notification badges (position: absolute; top: -16px)
 * - Fixed-position anchors
 *
 * Only excludes when the position value is unconditionally known (not behind
 * a state-dependent selector guard), since conditionally-positioned elements
 * may participate in flow in some states.
 */
function isUnconditionallyOutOfFlow(
  snapshot: LayoutSignalSnapshot,
): boolean {
  const position = readKnownNormalized(snapshot, "position")
  return position === "absolute" || position === "fixed"
}



function collectCohortMetrics(input: {
  readonly children: readonly LayoutElementNode[]
  readonly axis: LayoutAxisModel
  readonly axisCertainty: ContextCertainty
  readonly measurementNodeByRootKey: ReadonlyMap<string, LayoutElementNode>
  readonly snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>
  readonly snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>
}): {
  readonly metrics: readonly CohortMetrics[]
  readonly excludedElementKeys: ReadonlySet<string>
  readonly measurementHits: number
} {
  const out: CohortMetrics[] = []
  const excluded = new Set<string>()
  const axisKind = toEvidenceKind(input.axisCertainty)
  let measurementHits = 0

  for (let i = 0; i < input.children.length; i++) {
    const node = input.children[i]
    if (!node) continue

    // Skip children that don't participate in the parent's layout flow:
    // 1. Elements with display: none / hidden attribute generate no boxes at all.
    // 2. Elements with position: absolute/fixed are out of flow.
    // Check the child node's own snapshot, not the measurement node's, because
    // the child is the layout participant.
    const childSnapshot = input.snapshotByElementNode.get(node)
    if (isLayoutHidden(node, input.snapshotByElementNode)) {
      excluded.add(node.key)
      continue
    }
    if (childSnapshot && isUnconditionallyOutOfFlow(childSnapshot)) {
      excluded.add(node.key)
      continue
    }

    const measurementNode = input.measurementNodeByRootKey.get(node.key)
    if (!measurementNode) {
      throw new Error(`missing measurement node for ${node.key}`)
    }

    const snapshot = input.snapshotByElementNode.get(measurementNode)
    if (!snapshot) {
      throw new Error(`missing snapshot for measurement node ${measurementNode.key}`)
    }

    const hotSignals = input.snapshotHotSignalsByElementKey.get(measurementNode.key)
    if (!hotSignals) {
      throw new Error(`missing hot signals for measurement node ${measurementNode.key}`)
    }

    const element: AlignmentElementEvidence = {
      solidFile: measurementNode.solidFile,
      elementKey: measurementNode.key,
      elementId: measurementNode.elementId,
      tag: measurementNode.tag,
      snapshot,
    }

    const offset = estimateBlockOffsetWithDeclaredFromHotSignals(hotSignals, input.axis)
    out.push({
      key: element.elementKey,
      element,
      measurementNode,
      rootNode: node,
      hotSignals,
      declaredOffset: {
        value: offset.declared.value,
        kind: mergeEvidenceKind(offset.declared.kind, axisKind),
      },
      effectiveOffset: {
        value: offset.effective.value,
        kind: mergeEvidenceKind(offset.effective.kind, axisKind),
      },
      lineHeight: hotSignals.lineHeight,
    })

    measurementHits++
  }

  return {
    metrics: out,
    excludedElementKeys: excluded,
    measurementHits,
  }
}

function createCohortProfileBuffers(): CohortProfileBuffers {
  return {
    declaredOffsets: [],
    effectiveOffsets: [],
    lineHeights: [],
    deviationScratch: [],
    baselineDeclaredValues: [],
    baselineEffectiveValues: [],
    baselineLineHeightValues: [],
    baselineDeclaredSorted: [],
    baselineEffectiveSorted: [],
    baselineLineHeightSorted: [],
  }
}

function summarizeComparableClusters(metrics: readonly CohortMetrics[]): ComparableClusterSummary {
  const clusterSizeByKey = new Map<string, number>()
  let comparableCount = 0

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    const key = toComparableClusterKey(metric)
    if (key === null) continue
    comparableCount++
    const existing = clusterSizeByKey.get(key)
    if (existing !== undefined) {
      clusterSizeByKey.set(key, existing + 1)
      continue
    }
    clusterSizeByKey.set(key, 1)
  }

  let dominantClusterSize = 0
  let dominantClusterCount = 0
  for (const size of clusterSizeByKey.values()) {
    if (size > dominantClusterSize) {
      dominantClusterSize = size
      dominantClusterCount = 1
      continue
    }
    if (size === dominantClusterSize) dominantClusterCount++
  }

  return {
    comparableCount,
    clusterCount: clusterSizeByKey.size,
    dominantClusterSize,
    dominantClusterCount,
    clusterSizeByKey,
  }
}

function toComparableClusterKey(metric: CohortMetrics): string | null {
  const effectiveOffset = toComparableExactValue(metric.effectiveOffset)
  const lineHeight = toComparableExactValue(metric.lineHeight)
  if (effectiveOffset === null || lineHeight === null) return null
  return `${effectiveOffset}|${lineHeight}`
}

function buildCohortProfile(
  metrics: readonly CohortMetrics[],
  buffers: CohortProfileBuffers,
  clusterSummary: ComparableClusterSummary,
): AlignmentCohortProfile {
  const declaredOffsets = buffers.declaredOffsets
  const effectiveOffsets = buffers.effectiveOffsets
  const lineHeights = buffers.lineHeights
  declaredOffsets.length = 0
  effectiveOffsets.length = 0
  lineHeights.length = 0

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    const declaredOffset = toComparableExactValue(metric.declaredOffset)
    const effectiveOffset = toComparableExactValue(metric.effectiveOffset)
    const lineHeight = toComparableExactValue(metric.lineHeight)
    if (declaredOffset !== null) declaredOffsets.push(declaredOffset)
    if (effectiveOffset !== null) effectiveOffsets.push(effectiveOffset)
    if (lineHeight !== null) lineHeights.push(lineHeight)
  }

  const medianDeclaredOffsetPx = computeMedian(declaredOffsets)
  const declaredOffsetDispersionPx = computeMedianAbsoluteDeviation(
    declaredOffsets,
    medianDeclaredOffsetPx,
    buffers.deviationScratch,
  )
  const medianEffectiveOffsetPx = computeMedian(effectiveOffsets)
  const medianLineHeightPx = computeMedian(lineHeights)
  const effectiveOffsetDispersionPx = computeMedianAbsoluteDeviation(
    effectiveOffsets,
    medianEffectiveOffsetPx,
    buffers.deviationScratch,
  )
  const lineHeightDispersionPx = computeMedianAbsoluteDeviation(
    lineHeights,
    medianLineHeightPx,
    buffers.deviationScratch,
  )

  const dominantClusterSize = clusterSummary.dominantClusterSize
  const dominantClusterShare =
    clusterSummary.comparableCount === 0
      ? 0
      : dominantClusterSize / clusterSummary.comparableCount
  const unimodal = clusterSummary.clusterCount <= 1

  return {
    medianDeclaredOffsetPx,
    declaredOffsetDispersionPx,
    medianEffectiveOffsetPx,
    effectiveOffsetDispersionPx,
    medianLineHeightPx,
    lineHeightDispersionPx,
    dominantClusterSize,
    dominantClusterShare,
    unimodal,
  }
}

function buildSubjectBaselineProfiles(
  metrics: readonly CohortMetrics[],
  profile: AlignmentCohortProfile,
  clusterSummary: ComparableClusterSummary,
  buffers: CohortProfileBuffers,
): readonly AlignmentCohortProfile[] {
  const declaredValues = buffers.baselineDeclaredValues
  const effectiveValues = buffers.baselineEffectiveValues
  const lineHeightValues = buffers.baselineLineHeightValues
  collectComparableValuesInto(metrics, "declared", declaredValues)
  collectComparableValuesInto(metrics, "effective", effectiveValues)
  collectComparableValuesInto(metrics, "line-height", lineHeightValues)
  const declaredSorted = toSortedComparableValuesInto(declaredValues, buffers.baselineDeclaredSorted)
  const effectiveSorted = toSortedComparableValuesInto(effectiveValues, buffers.baselineEffectiveSorted)
  const lineHeightSorted = toSortedComparableValuesInto(lineHeightValues, buffers.baselineLineHeightSorted)
  const topClusters = resolveTopClusterSizes(clusterSummary)
  const out: AlignmentCohortProfile[] = []

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    const clusterKey = toComparableClusterKey(metric)
    const clusterAfterExclusion = resolveClusterSummaryExcluding(clusterSummary, topClusters, clusterKey)
    const declaredValue = declaredValues[i] ?? null
    const effectiveValue = effectiveValues[i] ?? null
    const lineHeightValue = lineHeightValues[i] ?? null

    out.push({
      medianDeclaredOffsetPx: resolveMedianExcluding(declaredSorted, declaredValue),
      declaredOffsetDispersionPx: profile.declaredOffsetDispersionPx,
      medianEffectiveOffsetPx: resolveMedianExcluding(effectiveSorted, effectiveValue),
      effectiveOffsetDispersionPx: profile.effectiveOffsetDispersionPx,
      medianLineHeightPx: resolveMedianExcluding(lineHeightSorted, lineHeightValue),
      lineHeightDispersionPx: profile.lineHeightDispersionPx,
      dominantClusterSize: clusterAfterExclusion.dominantClusterSize,
      dominantClusterShare: clusterAfterExclusion.dominantClusterShare,
      unimodal: clusterAfterExclusion.unimodal,
    })
  }

  return out
}

type ComparableValueKind = "declared" | "effective" | "line-height"

function collectComparableValuesInto(
  metrics: readonly CohortMetrics[],
  kind: ComparableValueKind,
  out: (number | null)[],
): void {
  out.length = 0
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    if (kind === "declared") {
      out.push(toComparableExactValue(metric.declaredOffset))
      continue
    }
    if (kind === "effective") {
      out.push(toComparableExactValue(metric.effectiveOffset))
      continue
    }
    out.push(toComparableExactValue(metric.lineHeight))
  }
}

function toSortedComparableValuesInto(
  values: readonly (number | null)[],
  out: number[],
): readonly number[] {
  out.length = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === null || value === undefined) continue
    out.push(value)
  }
  out.sort((left, right) => left - right)
  return out
}

function resolveMedianExcluding(sorted: readonly number[], excluded: number | null): number | null {
  if (excluded === null) return medianOfSorted(sorted)
  if (sorted.length <= 1) return null

  const size = sorted.length - 1
  const middle = Math.floor((size - 1) / 2)
  const lower = resolveValueAtIndexExcluding(sorted, middle, excluded)
  if (size % 2 === 1) return lower
  const upper = resolveValueAtIndexExcluding(sorted, middle + 1, excluded)
  return (lower + upper) / 2
}

function medianOfSorted(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor((sorted.length - 1) / 2)
  const midValue = sorted[mid]
  if (midValue === undefined) return null
  if (sorted.length % 2 === 1) return midValue
  const nextValue = sorted[mid + 1]
  if (nextValue === undefined) return null
  return (midValue + nextValue) / 2
}

function resolveValueAtIndexExcluding(sorted: readonly number[], index: number, excluded: number): number {
  const removedIndex = lowerBound(sorted, excluded)
  const effectiveIndex = index < removedIndex ? index : index + 1
  const value = sorted[effectiveIndex]
  if (value === undefined) return 0
  return value
}

function lowerBound(sorted: readonly number[], target: number): number {
  let low = 0
  let high = sorted.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const middleValue = sorted[middle]
    if (middleValue !== undefined && middleValue < target) {
      low = middle + 1
      continue
    }
    high = middle
  }

  return low
}

interface TopClusterSizes {
  readonly largest: number
  readonly largestCount: number
  readonly secondLargest: number
}

function resolveTopClusterSizes(summary: ComparableClusterSummary): TopClusterSizes {
  let largest = 0
  let largestCount = 0
  let secondLargest = 0

  for (const size of summary.clusterSizeByKey.values()) {
    if (size > largest) {
      secondLargest = largest
      largest = size
      largestCount = 1
      continue
    }

    if (size === largest) {
      largestCount++
      continue
    }

    if (size > secondLargest) secondLargest = size
  }

  return {
    largest,
    largestCount,
    secondLargest,
  }
}

function resolveClusterSummaryExcluding(
  summary: ComparableClusterSummary,
  top: TopClusterSizes,
  excludedClusterKey: string | null,
): {
  readonly dominantClusterSize: number
  readonly dominantClusterShare: number
  readonly unimodal: boolean
} {
  if (excludedClusterKey === null) {
    const dominantClusterShare =
      summary.comparableCount === 0
        ? 0
        : summary.dominantClusterSize / summary.comparableCount
    return {
      dominantClusterSize: summary.dominantClusterSize,
      dominantClusterShare,
      unimodal: summary.clusterCount <= 1,
    }
  }

  const excludedClusterSize = summary.clusterSizeByKey.get(excludedClusterKey)
  if (excludedClusterSize === undefined || excludedClusterSize <= 0) {
    const dominantClusterShare =
      summary.comparableCount === 0
        ? 0
        : summary.dominantClusterSize / summary.comparableCount
    return {
      dominantClusterSize: summary.dominantClusterSize,
      dominantClusterShare,
      unimodal: summary.clusterCount <= 1,
    }
  }

  const comparableCount = summary.comparableCount - 1
  if (comparableCount <= 0) {
    return {
      dominantClusterSize: 0,
      dominantClusterShare: 0,
      unimodal: true,
    }
  }

  const clusterCount = excludedClusterSize === 1 ? summary.clusterCount - 1 : summary.clusterCount
  const reducedSize = excludedClusterSize - 1

  if (excludedClusterSize < top.largest) {
    return {
      dominantClusterSize: top.largest,
      dominantClusterShare: top.largest / comparableCount,
      unimodal: clusterCount <= 1,
    }
  }

  if (excludedClusterSize > top.largest) {
    return {
      dominantClusterSize: reducedSize,
      dominantClusterShare: reducedSize / comparableCount,
      unimodal: clusterCount <= 1,
    }
  }

  if (top.largestCount > 1) {
    return {
      dominantClusterSize: top.largest,
      dominantClusterShare: top.largest / comparableCount,
      unimodal: clusterCount <= 1,
    }
  }

  const dominantClusterSize = top.secondLargest > reducedSize ? top.secondLargest : reducedSize
  return {
    dominantClusterSize,
    dominantClusterShare: dominantClusterSize / comparableCount,
    unimodal: clusterCount <= 1,
  }
}

function buildCohortSignalIndex(metrics: readonly CohortMetrics[]): CohortSignalIndex {
  const byKey = new Map<string, CohortSignalsByElement>()
  const verticalAlignCounts = new Map<string, number>()
  const alignSelfCounts = new Map<string, number>()
  const placeSelfCounts = new Map<string, number>()

  let verticalAlignMergedKind: EvidenceValueKind = "exact"
  let alignSelfMergedKind: EvidenceValueKind = "exact"
  let placeSelfMergedKind: EvidenceValueKind = "exact"
  let verticalAlignComparableCount = 0
  let alignSelfComparableCount = 0
  let placeSelfComparableCount = 0
  let controlOrReplacedCount = 0
  let textYesCount = 0
  let textNoCount = 0
  let textUnknownCount = 0

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    const snapshot = metric.element.snapshot
    const alignSelf = metric.hotSignals.alignSelf
    const placeSelf = metric.hotSignals.placeSelf
    const isControlOrReplaced = snapshot.isControl || snapshot.isReplaced
    const verticalAlign = resolveComparableVerticalAlign(metric.hotSignals.verticalAlign, isControlOrReplaced)

    if (isControlOrReplaced) controlOrReplacedCount++
    if (snapshot.textualContent === "yes" || snapshot.textualContent === "dynamic-text") textYesCount++
    if (snapshot.textualContent === "no") textNoCount++
    if (snapshot.textualContent === "unknown") textUnknownCount++

    if (verticalAlign.value !== null) {
      verticalAlignMergedKind = mergeEvidenceKind(verticalAlignMergedKind, verticalAlign.kind)
      verticalAlignComparableCount++
      incrementCount(verticalAlignCounts, verticalAlign.value)
    }

    if (alignSelf.value !== null) {
      alignSelfMergedKind = mergeEvidenceKind(alignSelfMergedKind, alignSelf.kind)
      alignSelfComparableCount++
      incrementCount(alignSelfCounts, alignSelf.value)
    }

    if (placeSelf.value !== null) {
      placeSelfMergedKind = mergeEvidenceKind(placeSelfMergedKind, placeSelf.kind)
      placeSelfComparableCount++
      incrementCount(placeSelfCounts, placeSelf.value)
    }

    byKey.set(metric.key, {
      verticalAlign,
      alignSelf,
      placeSelf,
      textualContent: snapshot.textualContent,
      isControlOrReplaced,
    })
  }

  return {
    byKey,
    verticalAlign: {
      mergedKind: verticalAlignComparableCount === 0 ? "unknown" : verticalAlignMergedKind,
      comparableCount: verticalAlignComparableCount,
      countsByValue: verticalAlignCounts,
    },
    alignSelf: {
      mergedKind: alignSelfComparableCount === 0 ? "unknown" : alignSelfMergedKind,
      comparableCount: alignSelfComparableCount,
      countsByValue: alignSelfCounts,
    },
    placeSelf: {
      mergedKind: placeSelfComparableCount === 0 ? "unknown" : placeSelfMergedKind,
      comparableCount: placeSelfComparableCount,
      countsByValue: placeSelfCounts,
    },
    controlOrReplacedCount,
    textYesCount,
    textNoCount,
    textUnknownCount,
  }
}

function collectSubjectCohortSignals(
  index: CohortSignalIndex,
  subjectMetrics: CohortMetrics,
  context: AlignmentContext,
): AlignmentCohortSignals {
  const subject = index.byKey.get(subjectMetrics.key)
  if (!subject) {
    throw new Error(`missing cohort signal entry for ${subjectMetrics.key}`)
  }

  const subjectVerticalAlign = subject.verticalAlign
  const subjectAlignSelf = subject.alignSelf
  const subjectPlaceSelf = subject.placeSelf
  const trackVerticalAlign = subjectVerticalAlign.value !== null
  const trackAlignSelf = subjectAlignSelf.value !== null
  const trackPlaceSelf = subjectPlaceSelf.value !== null

  const verticalAlignKind = trackVerticalAlign ? index.verticalAlign.mergedKind : subjectVerticalAlign.kind
  const alignSelfKind = trackAlignSelf ? index.alignSelf.mergedKind : subjectAlignSelf.kind
  const placeSelfKind = trackPlaceSelf ? index.placeSelf.mergedKind : subjectPlaceSelf.kind

  const sawComparableVerticalAlign = hasComparablePeer(index.verticalAlign, subjectVerticalAlign.value)
  const sawComparableAlignSelf = hasComparablePeer(index.alignSelf, subjectAlignSelf.value)
  const sawComparablePlaceSelf = hasComparablePeer(index.placeSelf, subjectPlaceSelf.value)

  const sawVerticalAlignConflict = hasConflictPeer(index.verticalAlign, subjectVerticalAlign.value)
  const sawAlignSelfConflict = hasConflictPeer(index.alignSelf, subjectAlignSelf.value)
  const sawPlaceSelfConflict = hasConflictPeer(index.placeSelf, subjectPlaceSelf.value)

  const hasControlOrReplacedPeer = index.controlOrReplacedCount - (subject.isControlOrReplaced ? 1 : 0) > 0
  const verticalAlign = finalizeConflictEvidence(
    subjectVerticalAlign.value,
    verticalAlignKind,
    sawComparableVerticalAlign,
    sawVerticalAlignConflict,
  )
  const tableCellControlFallback =
    context.kind === "table-cell"
    && subject.isControlOrReplaced
    && verticalAlign.value === "unknown"
    && index.byKey.size > index.controlOrReplacedCount
  const normalizedVerticalAlign: SignalConflictEvidence = tableCellControlFallback
    ? {
        value: "conflict",
        kind: verticalAlignKind,
      }
    : verticalAlign

  const textContrastWithPeers = resolveIndexedTextContrastWithPeers(
    index,
    subject.textualContent,
    subject.isControlOrReplaced,
    tableCellControlFallback,
  )

  return {
    verticalAlign: normalizedVerticalAlign,
    alignSelf: finalizeConflictEvidence(
      subjectAlignSelf.value,
      alignSelfKind,
      sawComparableAlignSelf,
      sawAlignSelfConflict,
    ),
    placeSelf: finalizeConflictEvidence(
      subjectPlaceSelf.value,
      placeSelfKind,
      sawComparablePlaceSelf,
      sawPlaceSelfConflict,
    ),
    hasControlOrReplacedPeer,
    textContrastWithPeers,
  }
}

function resolveComparableVerticalAlign(
  verticalAlign: LayoutSnapshotHotSignals["verticalAlign"],
  isControlOrReplaced: boolean,
): LayoutSnapshotHotSignals["verticalAlign"] {
  if (verticalAlign.value !== null) return verticalAlign
  if (!isControlOrReplaced) return verticalAlign

  return {
    present: verticalAlign.present,
    value: "baseline",
    kind: "exact",
  }
}

function hasComparablePeer(aggregate: CohortSignalAggregate, subjectValue: string | null): boolean {
  if (subjectValue === null) return false
  return aggregate.comparableCount - 1 > 0
}

function hasConflictPeer(aggregate: CohortSignalAggregate, subjectValue: string | null): boolean {
  if (subjectValue === null) return false

  const comparablePeers = aggregate.comparableCount - 1
  if (comparablePeers <= 0) return false

  const sameValueCount = (aggregate.countsByValue.get(subjectValue) ?? 0) - 1
  return comparablePeers > sameValueCount
}

function finalizeConflictEvidence(
  subjectValue: string | null,
  kind: EvidenceValueKind,
  sawComparablePeer: boolean,
  sawConflict: boolean,
): SignalConflictEvidence {
  if (subjectValue === null) {
    return {
      value: "unknown",
      kind,
    }
  }

  if (!sawComparablePeer) {
    return {
      value: "unknown",
      kind,
    }
  }

  return {
    value: sawConflict ? "conflict" : "aligned",
    kind,
  }
}

function resolveIndexedTextContrastWithPeers(
  index: CohortSignalIndex,
  subjectTextualContent: LayoutSignalSnapshot["textualContent"],
  subjectIsControlOrReplaced: boolean,
  tableCellControlFallback: boolean,
): AlignmentTextContrast {
  if (subjectTextualContent === "unknown") return "unknown"

  const unknownPeers = index.textUnknownCount
  const cohortSize = index.byKey.size
  if (subjectTextualContent === "yes" || subjectTextualContent === "dynamic-text") {
    if (index.textNoCount > 0) return "different"
    if (unknownPeers > 0) return "unknown"
    return "same"
  }

  if (index.textYesCount > 0) return "different"
  if (tableCellControlFallback) return "different"
  if (subjectIsControlOrReplaced && index.controlOrReplacedCount === 1 && cohortSize >= 3 && unknownPeers > 0) {
    return "different"
  }
  if (unknownPeers > 0) return "unknown"
  return "same"
}

function resolveSubjectIdentifiability(
  subjectMetrics: CohortMetrics,
  profile: AlignmentCohortProfile,
  subjectBaselineProfile: AlignmentCohortProfile,
  clusterSummary: ComparableClusterSummary,
  signalIndex: CohortSignalIndex,
  cohortKind: EvidenceValueKind,
  cohortSize: number,
): CohortIdentifiability {
  const subjectClusterKey = toComparableClusterKey(subjectMetrics)
  const kind = cohortKind
  if (subjectClusterKey === null) {
    const roleFallback = resolveControlRoleIdentifiability(
      subjectMetrics,
      signalIndex,
      kind,
      cohortSize,
    )
    if (roleFallback !== null) return roleFallback

    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "insufficient",
      ambiguous: true,
      kind,
    }
  }

  if (cohortSize <= 2) {
    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "dominant",
      ambiguous: false,
      kind,
    }
  }

  if (clusterSummary.comparableCount < 2 || clusterSummary.clusterCount === 0) {
    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "insufficient",
      ambiguous: true,
      kind,
    }
  }

  const subjectClusterSize = clusterSummary.clusterSizeByKey.get(subjectClusterKey)
  if (subjectClusterSize === undefined || subjectClusterSize <= 0) {
    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "insufficient",
      ambiguous: true,
      kind,
    }
  }

  const ambiguous =
    clusterSummary.dominantClusterCount > 1
    && subjectClusterSize === clusterSummary.dominantClusterSize
  if (ambiguous) {
    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "ambiguous",
      ambiguous: true,
      kind,
    }
  }

  if (subjectClusterSize >= clusterSummary.dominantClusterSize) {
    return {
      dominantShare: profile.dominantClusterShare,
      subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
      subjectMembership: "dominant",
      ambiguous: false,
      kind,
    }
  }

  return {
    dominantShare: profile.dominantClusterShare,
    subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare,
    subjectMembership: "nondominant",
    ambiguous: false,
    kind,
  }
}

function resolveControlRoleIdentifiability(
  subjectMetrics: CohortMetrics,
  signalIndex: CohortSignalIndex,
  kind: EvidenceValueKind,
  cohortSize: number,
): CohortIdentifiability | null {
  const subjectIsControlOrReplaced =
    subjectMetrics.element.snapshot.isControl
    || subjectMetrics.element.snapshot.isReplaced

  const controlCount = signalIndex.controlOrReplacedCount
  const nonControlCount = cohortSize - controlCount
  if (controlCount <= 0 || nonControlCount <= 0) return null

  const dominantShare = Math.max(controlCount, nonControlCount) / cohortSize
  const excludedDominantShare = resolveExcludedRoleDominantShare(
    controlCount,
    nonControlCount,
    subjectIsControlOrReplaced,
  )
  const subjectMembership = resolveRoleMembership(controlCount, nonControlCount, subjectIsControlOrReplaced)

  if (cohortSize <= 2) {
    return {
      dominantShare,
      subjectExcludedDominantShare: excludedDominantShare,
      subjectMembership: subjectMembership === "ambiguous" ? "dominant" : subjectMembership,
      ambiguous: false,
      kind,
    }
  }

  if (subjectMembership === "ambiguous") {
    return {
      dominantShare,
      subjectExcludedDominantShare: excludedDominantShare,
      subjectMembership,
      ambiguous: true,
      kind,
    }
  }

  return {
    dominantShare,
    subjectExcludedDominantShare: excludedDominantShare,
    subjectMembership,
    ambiguous: false,
    kind,
  }
}

function resolveRoleMembership(
  controlCount: number,
  nonControlCount: number,
  subjectIsControlOrReplaced: boolean,
): "dominant" | "nondominant" | "ambiguous" {
  if (controlCount === nonControlCount) return "ambiguous"
  const dominantRoleIsControl = controlCount > nonControlCount
  return dominantRoleIsControl === subjectIsControlOrReplaced ? "dominant" : "nondominant"
}

function resolveExcludedRoleDominantShare(
  controlCount: number,
  nonControlCount: number,
  subjectIsControlOrReplaced: boolean,
): number {
  const controlAfterExclusion = controlCount - (subjectIsControlOrReplaced ? 1 : 0)
  const nonControlAfterExclusion = nonControlCount - (subjectIsControlOrReplaced ? 0 : 1)
  const totalAfterExclusion = controlAfterExclusion + nonControlAfterExclusion
  if (totalAfterExclusion <= 0) return 0
  return Math.max(controlAfterExclusion, nonControlAfterExclusion) / totalAfterExclusion
}

function collectConditionalSignalCounts(
  snapshots: readonly LayoutSignalSnapshot[],
): {
  readonly conditional: number
  readonly total: number
} {
  let conditional = 0
  let total = 0

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]
    if (!snapshot) continue
    conditional += snapshot.conditionalSignalCount
    total += snapshot.knownSignalCount + snapshot.unknownSignalCount + snapshot.conditionalSignalCount
  }

  return {
    conditional,
    total,
  }
}

function collectCohortSnapshots(metrics: readonly CohortMetrics[]): readonly LayoutSignalSnapshot[] {
  const out: LayoutSignalSnapshot[] = []
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    out.push(metric.element.snapshot)
  }
  return out
}

function collectCohortProvenanceFromSnapshots(snapshots: readonly LayoutSignalSnapshot[]): EvidenceProvenance {
  const byKey = new Map<string, LayoutGuardConditionProvenance>()

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]
    if (!snapshot) continue

    for (const signal of snapshot.signals.values()) {
      for (let j = 0; j < signal.guardProvenance.conditions.length; j++) {
        const guard = signal.guardProvenance.conditions[j]
        if (!guard) continue
        if (!byKey.has(guard.key)) byKey.set(guard.key, guard)
      }
    }
  }

  const guards = [...byKey.values()]
  guards.sort((left, right) => {
    if (left.key < right.key) return -1
    if (left.key > right.key) return 1
    return 0
  })

  const guardKey = buildGuardKey(guards)

  return {
    reason: "cohort-derived alignment evidence",
    guardKey,
    guards,
  }
}

function buildGuardKey(guards: readonly LayoutGuardConditionProvenance[]): string {
  if (guards.length === 0) return "always"
  const keys: string[] = []
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i]
    if (!guard) continue
    keys.push(guard.key)
  }
  return keys.join("&")
}

function resolveCohortEvidenceKind(metrics: readonly CohortMetrics[]): EvidenceValueKind {
  let kind: EvidenceValueKind = "exact"

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    kind = mergeEvidenceKind(kind, mergeEvidenceKind(metric.effectiveOffset.kind, metric.lineHeight.kind))
  }

  return kind
}

function incrementCount(counts: Map<string, number>, key: string): void {
  const existing = counts.get(key)
  if (existing === undefined) {
    counts.set(key, 1)
    return
  }

  counts.set(key, existing + 1)
}

function toEvidenceKind(certainty: ContextCertainty): EvidenceValueKind {
  if (certainty === "resolved") return "exact"
  if (certainty === "conditional") return "conditional"
  return "unknown"
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null

  const middle = Math.floor((values.length - 1) / 2)
  const lower = selectKth(values, middle)
  if (values.length % 2 === 1) return lower
  const upper = selectKth(values, middle + 1)
  return (lower + upper) / 2
}

function computeMedianAbsoluteDeviation(
  values: readonly number[],
  median: number | null,
  scratch: number[],
): number | null {
  if (median === null || values.length === 0) return null

  scratch.length = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === undefined) continue
    scratch.push(Math.abs(value - median))
  }

  return computeMedian(scratch)
}

function selectKth(values: number[], targetIndex: number): number {
  let left = 0
  let right = values.length - 1

  while (left <= right) {
    if (left === right) {
      const result = values[left]
      if (result === undefined) return 0
      return result
    }

    const pivotIndex = choosePivotIndex(values, left, right)
    const partitionIndex = partitionAroundPivot(values, left, right, pivotIndex)

    if (partitionIndex === targetIndex) {
      const result = values[partitionIndex]
      if (result === undefined) return 0
      return result
    }
    if (partitionIndex < targetIndex) {
      left = partitionIndex + 1
      continue
    }
    right = partitionIndex - 1
  }

  const fallback = values[targetIndex]
  if (fallback === undefined) return 0
  return fallback
}

function choosePivotIndex(values: number[], left: number, right: number): number {
  const middle = Math.floor((left + right) / 2)
  const leftValue = values[left] ?? 0
  const middleValue = values[middle] ?? 0
  const rightValue = values[right] ?? 0

  if (leftValue < middleValue) {
    if (middleValue < rightValue) return middle
    if (leftValue < rightValue) return right
    return left
  }

  if (leftValue < rightValue) return left
  if (middleValue < rightValue) return right
  return middle
}

function partitionAroundPivot(values: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = values[pivotIndex] ?? 0
  swap(values, pivotIndex, right)

  let storeIndex = left
  for (let i = left; i < right; i++) {
    const current = values[i]
    if (current === undefined || current > pivotValue) continue
    swap(values, storeIndex, i)
    storeIndex++
  }

  swap(values, storeIndex, right)
  return storeIndex
}

function swap(values: number[], left: number, right: number): void {
  if (left === right) return
  const leftValue = values[left] ?? 0
  const rightValue = values[right] ?? 0
  values[left] = rightValue
  values[right] = leftValue
}
