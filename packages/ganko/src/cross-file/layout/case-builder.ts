import type { CrossRuleContext } from "../rule"
import type { ContextCertainty } from "./context-model"
import type { LayoutElementNode } from "./graph"
import type {
  AlignmentCase,
  AlignmentFactorCoverage,
  CohortIdentifiability,
  ContentCompositionFingerprint,
  EvidenceProvenance,
  EvidenceValueKind,
  NumericEvidenceValue,
  SignalConflictEvidence,
  AlignmentTextContrast,
  AlignmentCohortProfile,
  AlignmentCohortSignals,
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
          alignmentContext,
          cohortStats.profile,
          subjectStats.signals,
          subjectStats.identifiability,
          cohortStats.snapshots,
          cohortStats.factSummary,
          cohortStats.provenance,
          subjectDeclaredOffsetDeviation,
          subjectEffectiveOffsetDeviation,
          subjectLineHeightDeviation,
          subjectStats.element.snapshot.textualContent,
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
  subjectTextualContent: AlignmentCase["subject"]["snapshot"]["textualContent"],
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
  subjectTextualContent: AlignmentCase["subject"]["snapshot"]["textualContent"],
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
  if (value.value === "unknown") return certainty * 0.4
  return certainty
}

function coverageFromTextContrast(value: AlignmentTextContrast): number {
  if (value === "unknown") return 0.35
  return 1
}

function coverageFromSubjectText(
  subjectTextualContent: AlignmentCase["subject"]["snapshot"]["textualContent"],
): number {
  if (subjectTextualContent === "unknown") return 0.35
  return 1
}



function coverageFromContextCertainty(certainty: ContextCertainty): number {
  if (certainty === "resolved") return 1
  if (certainty === "conditional") return 0.55
  return 0.25
}

function coverageFromKind(kind: EvidenceValueKind): number {
  if (kind === "exact") return 1
  if (kind === "interval") return 0.78
  if (kind === "conditional") return 0.5
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

function compareAlignmentCaseOrder(left: AlignmentCase, right: AlignmentCase): number {
  if (left.subject.solidFile < right.subject.solidFile) return -1
  if (left.subject.solidFile > right.subject.solidFile) return 1
  return left.subject.elementId - right.subject.elementId
}
