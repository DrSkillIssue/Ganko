import type { CrossRuleContext } from "../rule"
import { ContextCertainty, type AlignmentContext } from "./context-model"
import type { LayoutElementNode } from "./graph"
import {
  AlignmentTextContrast,
  EvidenceValueKind,
  LayoutTextualContentState,
  SignalConflictValue,
  type AlignmentCase,
  type AlignmentFactorCoverage,
  type CohortIdentifiability,
  type ContentCompositionFingerprint,
  type EvidenceProvenance,
  type NumericEvidenceValue,
  type SignalConflictEvidence,
  type AlignmentCohortProfile,
  type AlignmentCohortSignals,
} from "./signal-model"
import { resolveCompositionCoverage } from "./content-composition"
import { clamp, toComparableExactValue } from "./util"

export function collectAlignmentCases(context: CrossRuleContext): readonly AlignmentCase[] {
  const startedAt = performance.now()
  const out: AlignmentCase[] = []

  for (const [parent, children] of context.layout.childrenByParentNode) {
    if (children.length < 2) continue



    const alignmentContext = context.layout.contextByParentNode.get(parent)
    if (!alignmentContext) {
      throw new Error(`missing precomputed alignment context for ${parent.key}`)
    }

    const cohortStats = context.layout.cohortStatsByParentNode.get(parent)
    if (!cohortStats) {
      // Cohort stats may be absent when visually-hidden element exclusion reduced
      // the cohort below the minimum size threshold (2). This is expected.
      continue
    }

    const cohortContentCompositions = collectCohortContentCompositions(cohortStats, children, context.layout.measurementNodeByRootKey)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child) continue

      // Skip children excluded from cohort analysis (e.g. visually-hidden accessible elements)
      if (cohortStats.excludedElementKeys.has(child.key)) continue

      const measurementNode = context.layout.measurementNodeByRootKey.get(child.key)
      if (!measurementNode) {
        throw new Error(`missing measurement node for ${child.key}`)
      }

      const subjectStats = cohortStats.subjectsByElementKey.get(measurementNode.key)
      if (!subjectStats) {
        throw new Error(`missing subject cohort stats for ${measurementNode.key}`)
      }

      // When the measurement node was resolved by descending into the child
      // (i.e. measurementNode !== child), the child may establish an independent
      // formatting context with geometric alignment (e.g. inline-flex items-center).
      // In that case, the measurement node's baseline characteristics are shielded
      // from the grandparent's alignment context. Propagate the child's
      // baselineRelevance to suppress false positives from baseline-dependent
      // evidence factors.
      const effectiveAlignmentContext = resolveEffectiveAlignmentContext(
        alignmentContext,
        child,
        measurementNode,
        context.layout.contextByParentNode,
      )

      const subjectDeclaredOffsetDeviation = computeDeviation(
        subjectStats.declaredOffset,
        subjectStats.baselineProfile.medianDeclaredOffsetPx,
      )
      const subjectEffectiveOffsetDeviation = computeDeviation(
        subjectStats.effectiveOffset,
        subjectStats.baselineProfile.medianEffectiveOffsetPx,
      )
      const subjectLineHeightDeviation = computeDeviation(
        subjectStats.lineHeight,
        subjectStats.baselineProfile.medianLineHeightPx,
      )

      out.push(
        buildAlignmentCase(
          parent,
          effectiveAlignmentContext,
          cohortStats.profile,
          subjectStats.signals,
          subjectStats.identifiability,
          cohortStats.snapshots,
          cohortStats.factSummary,
          cohortStats.provenance,
          subjectDeclaredOffsetDeviation,
          subjectEffectiveOffsetDeviation,
          subjectLineHeightDeviation,
          subjectStats.element.snapshot.node.textualContent,
          subjectStats.element,
          subjectStats.contentComposition,
          cohortContentCompositions,
        ),
      )
      context.layout.perf.casesCollected++
    }
  }



  context.layout.perf.caseBuildMs += performance.now() - startedAt
  out.sort(compareAlignmentCaseOrder)
  return out
}

function buildAlignmentCase(
  parent: LayoutElementNode,
  alignmentContext: AlignmentCase["context"],
  profile: AlignmentCohortProfile,
  cohortSignals: AlignmentCohortSignals,
  subjectIdentifiability: CohortIdentifiability,
  cohortSnapshots: AlignmentCase["cohortSnapshots"],
  cohortFactSummary: AlignmentCase["cohortFactSummary"],
  cohortProvenance: EvidenceProvenance,
  subjectDeclaredOffsetDeviation: NumericEvidenceValue,
  subjectEffectiveOffsetDeviation: NumericEvidenceValue,
  subjectLineHeightDeviation: NumericEvidenceValue,
  subjectTextualContent: LayoutTextualContentState,
  subject: AlignmentCase["subject"],
  subjectContentComposition: ContentCompositionFingerprint,
  cohortContentCompositions: readonly ContentCompositionFingerprint[],
): AlignmentCase {
  return {
    subject,
    cohort: {
      parentElementKey: parent.key,
      parentElementId: parent.elementId,
      parentTag: parent.tag,
      siblingCount: cohortSnapshots.length,
    },
    cohortProfile: profile,
    cohortSignals,
    subjectIdentifiability,
    factorCoverage: resolveFactorCoverage(
      alignmentContext,
      cohortSignals,
      subjectDeclaredOffsetDeviation,
      subjectEffectiveOffsetDeviation,
      subjectLineHeightDeviation,
      subjectTextualContent,
      subjectContentComposition,
      cohortContentCompositions,
    ),
    cohortSnapshots,
    cohortFactSummary,
    cohortProvenance,
    subjectDeclaredOffsetDeviation,
    subjectEffectiveOffsetDeviation,
    subjectLineHeightDeviation,
    context: alignmentContext,
    subjectContentComposition,
    cohortContentCompositions,
  }
}

function resolveFactorCoverage(
  context: AlignmentCase["context"],
  signals: AlignmentCohortSignals,
  subjectDeclaredOffsetDeviation: NumericEvidenceValue,
  subjectEffectiveOffsetDeviation: NumericEvidenceValue,
  subjectLineHeightDeviation: NumericEvidenceValue,
  subjectTextualContent: LayoutTextualContentState,
  subjectContentComposition: ContentCompositionFingerprint,
  cohortContentCompositions: readonly ContentCompositionFingerprint[],
): AlignmentFactorCoverage {
  const contextCoverage = coverageFromContextCertainty(context.certainty)
  const alignSelfCoverage = coverageFromConflict(signals.alignSelf)
  const placeSelfCoverage = coverageFromConflict(signals.placeSelf)

  return {
    "offset-delta": coverageFromNumeric(subjectEffectiveOffsetDeviation),
    "declared-offset-delta": coverageFromNumeric(subjectDeclaredOffsetDeviation),
    "baseline-conflict": averageCoverage(
      coverageFromNumeric(subjectLineHeightDeviation),
      coverageFromConflict(signals.verticalAlign),
    ),
    "context-conflict": averageCoverage(
      coverageFromNumeric(subjectLineHeightDeviation),
      contextCoverage,
      alignSelfCoverage,
      placeSelfCoverage,
    ),
    "replaced-control-risk": averageCoverage(
      coverageFromNumeric(subjectLineHeightDeviation),
      coverageFromTextContrast(signals.textContrastWithPeers),
      coverageFromSubjectText(subjectTextualContent),
    ),
    "content-composition-conflict": resolveCompositionCoverage(subjectContentComposition, cohortContentCompositions),
    "context-certainty": contextCoverage,
  }
}

function computeDeviation(value: NumericEvidenceValue, median: number | null): NumericEvidenceValue {
  const comparable = toComparableExactValue(value)
  const baseline = median === null ? 0 : median

  if (comparable === null) {
    return {
      value: null,
      kind: value.kind,
    }
  }

  return {
    value: Math.abs(comparable - baseline),
    kind: value.kind,
  }
}

function coverageFromNumeric(value: NumericEvidenceValue): number {
  const certainty = coverageFromKind(value.kind)
  if (value.value === null) return certainty * 0.35
  return certainty
}

function coverageFromConflict(value: SignalConflictEvidence): number {
  const certainty = coverageFromKind(value.kind)
  if (value.value === SignalConflictValue.Unknown) return certainty * 0.4
  return certainty
}

function coverageFromTextContrast(value: AlignmentTextContrast): number {
  if (value === AlignmentTextContrast.Unknown) return 0.35
  return 1
}

function coverageFromSubjectText(
  subjectTextualContent: LayoutTextualContentState,
): number {
  if (subjectTextualContent === LayoutTextualContentState.Unknown) return 0.35
  return 1
}



function coverageFromContextCertainty(certainty: ContextCertainty): number {
  if (certainty === ContextCertainty.Resolved) return 1
  if (certainty === ContextCertainty.Conditional) return 0.55
  return 0.25
}

function coverageFromKind(kind: EvidenceValueKind): number {
  if (kind === EvidenceValueKind.Exact) return 1
  if (kind === EvidenceValueKind.Interval) return 0.78
  if (kind === EvidenceValueKind.Conditional) return 0.5
  return 0.2
}

function averageCoverage(...values: readonly number[]): number {
  if (values.length === 0) return 0

  let sum = 0
  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val === undefined) continue
    sum += val
  }
  return clamp(sum / values.length, 0, 1)
}

function collectCohortContentCompositions(
  cohortStats: { readonly subjectsByElementKey: ReadonlyMap<string, { readonly contentComposition: ContentCompositionFingerprint }>, readonly excludedElementKeys: ReadonlySet<string> },
  children: readonly LayoutElementNode[],
  measurementNodeByRootKey: ReadonlyMap<string, LayoutElementNode>,
): readonly ContentCompositionFingerprint[] {
  const out: ContentCompositionFingerprint[] = []

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (cohortStats.excludedElementKeys.has(child.key)) continue

    const measurementNode = measurementNodeByRootKey.get(child.key)
    if (!measurementNode) continue

    const subjectStats = cohortStats.subjectsByElementKey.get(measurementNode.key)
    if (!subjectStats) continue

    out.push(subjectStats.contentComposition)
  }

  return out
}

/**
 * When the measurement node differs from the cohort child, the child may
 * establish an independent formatting context with geometric alignment
 * (e.g. `display: inline-flex; align-items: center`). In that scenario the
 * measurement node's baseline characteristics are shielded from the
 * grandparent's alignment context — baselines never propagate across a
 * formatting context boundary that uses geometric alignment.
 *
 * This function checks whether the child has its own alignment context
 * with `baselineRelevance: "irrelevant"`, and if so, returns a derived
 * context that propagates the irrelevance to the grandparent's case.
 * Otherwise the original parent alignment context is returned unchanged.
 */
function resolveEffectiveAlignmentContext(
  parentContext: AlignmentContext,
  child: LayoutElementNode,
  measurementNode: LayoutElementNode,
  contextByParentNode: ReadonlyMap<LayoutElementNode, AlignmentContext>,
): AlignmentContext {
  // No indirection — the child IS the measurement node.
  if (child === measurementNode) return parentContext

  // Already irrelevant — nothing to propagate.
  if (parentContext.baselineRelevance === "irrelevant") return parentContext

  // Check whether the child itself is a parent in the layout graph with
  // its own alignment context. If it uses geometric alignment internally,
  // its descendant's baseline characteristics are invisible to the
  // grandparent.
  const childContext = contextByParentNode.get(child)
  if (!childContext) return parentContext
  if (childContext.baselineRelevance !== "irrelevant") return parentContext

  // The child shields its descendants' baselines from the grandparent.
  // Derive a new context with baselineRelevance overridden.
  return {
    kind: parentContext.kind,
    certainty: parentContext.certainty,
    parentSolidFile: parentContext.parentSolidFile,
    parentElementId: parentContext.parentElementId,
    parentElementKey: parentContext.parentElementKey,
    parentTag: parentContext.parentTag,
    axis: parentContext.axis,
    axisCertainty: parentContext.axisCertainty,
    inlineDirection: parentContext.inlineDirection,
    inlineDirectionCertainty: parentContext.inlineDirectionCertainty,
    parentDisplay: parentContext.parentDisplay,
    parentAlignItems: parentContext.parentAlignItems,
    parentPlaceItems: parentContext.parentPlaceItems,
    hasPositionedOffset: parentContext.hasPositionedOffset,
    crossAxisIsBlockAxis: parentContext.crossAxisIsBlockAxis,
    crossAxisIsBlockAxisCertainty: parentContext.crossAxisIsBlockAxisCertainty,
    baselineRelevance: "irrelevant",
    evidence: parentContext.evidence,
  }
}

function compareAlignmentCaseOrder(left: AlignmentCase, right: AlignmentCase): number {
  if (left.subject.solidFile < right.subject.solidFile) return -1
  if (left.subject.solidFile > right.subject.solidFile) return 1
  return left.subject.elementId - right.subject.elementId
}
