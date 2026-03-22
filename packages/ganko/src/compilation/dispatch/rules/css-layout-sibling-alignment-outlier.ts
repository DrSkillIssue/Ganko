import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import type { AlignmentContext, CohortStats, CohortSubjectStats, AlignmentCase, AlignmentFactorCoverage } from "../../analysis/alignment"
import {
  scoreAlignmentCase,
  formatAlignmentCauses,
  formatPrimaryFix,
  resolveCompositionCoverage,
  type LayoutDetection,
  type AlignmentFactorId,
} from "../../analysis/alignment"
import type { FileSemanticModel } from "../../binding/semantic-model"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  misalignedSibling:
    "Vertically misaligned '{{subject}}' in '{{parent}}'.{{fix}}{{offsetClause}}",
} as const

const MIN_CONFIDENCE_THRESHOLD = 0.48
const MIN_OFFSET_PX_THRESHOLD = 2.0

const NON_OFFSET_FACTORS: ReadonlySet<string> = new Set([
  "baseline-conflict", "context-conflict", "replaced-control-risk", "content-composition-conflict",
])

export const cssLayoutSiblingAlignmentOutlier = defineAnalysisRule({
  id: "css-layout-sibling-alignment-outlier",
  severity: "warn",
  messages,
  meta: {
    description: "Detect vertical alignment outliers between sibling elements in shared layout containers.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.AlignmentModel },
  register(registry) {
    registry.registerAlignmentAction((parentElement, context, cohort, semanticModel, emit) => {
      const detections = collectAndEvaluate(context, cohort, semanticModel)
      const uniqueDetections = dedupeDetectionsBySubject(detections)

      for (let i = 0; i < uniqueDetections.length; i++) {
        const detection = uniqueDetections[i]
        if (!detection) continue

        if (detection.evidence.confidence < MIN_CONFIDENCE_THRESHOLD) continue

        const estimatedOffset = detection.evidence.estimatedOffsetPx
        if (estimatedOffset !== null && Math.abs(estimatedOffset) < MIN_OFFSET_PX_THRESHOLD && !hasNonOffsetPrimaryEvidence(detection.evidence.topFactors)) continue

        if (isInsideOutOfFlowAncestor(detection.caseData.cohort.parentElementKey, parentElement, semanticModel)) continue

        const subjectNode = semanticModel.getElementNode(detection.caseData.subject.elementId)
        if (!subjectNode) continue

        const subjectTag = detection.caseData.subject.tag ?? "element"
        const parentTag = detection.caseData.cohort.parentTag ?? "container"
        const offset = detection.evidence.estimatedOffsetPx
        const hasOffset = offset !== null && Math.abs(offset) > 0.25
        const offsetClause = hasOffset ? ` Estimated offset: ${offset!.toFixed(2)}px.` : ""
        const primaryFix = detection.evidence.primaryFix
        const firstChar = primaryFix.length > 0 ? primaryFix[0] : undefined
        const fix = firstChar !== undefined ? ` ${firstChar.toUpperCase()}${primaryFix.slice(1)}.` : ""

        emit(
          createDiagnostic(
            subjectNode.solidFile,
            subjectNode.jsxEntity.node,
            semanticModel.solidTree.sourceFile,
            cssLayoutSiblingAlignmentOutlier.id,
            "misalignedSibling",
            resolveMessage(messages.misalignedSibling, { subject: subjectTag, parent: parentTag, fix, offsetClause }),
            "warn",
          ),
        )
      }
    })
  },
})

interface AlignmentDetectionCase {
  readonly subject: { readonly solidFile: string; readonly elementKey: string; readonly elementId: number; readonly tag: string | null }
  readonly cohort: { readonly parentElementKey: string; readonly parentElementId: number; readonly parentTag: string | null; readonly siblingCount: number }
}

function collectAndEvaluate(
  context: AlignmentContext,
  cohort: CohortStats,
  semanticModel: FileSemanticModel,
): readonly LayoutDetection<AlignmentDetectionCase>[] {
  const out: LayoutDetection<AlignmentDetectionCase>[] = []
  const cohortCompositions: import("../../analysis/alignment").ContentCompositionFingerprint[] = []

  for (const [, subjectStats] of cohort.subjectsByElementKey) {
    cohortCompositions.push(subjectStats.contentComposition)
  }

  for (const [, subjectStats] of cohort.subjectsByElementKey) {
    const subjectNode = semanticModel.getElementNode(subjectStats.element.elementId)
    const subjectIsControlOrReplaced = subjectNode !== null && (subjectNode.isControl || subjectNode.isReplaced)

    const factorCoverage = buildFactorCoverage(subjectStats, cohort, context, cohortCompositions)

    const alignmentCase: AlignmentCase = {
      subject: subjectStats.element,
      subjectIsControlOrReplaced,
      cohort: {
        parentElementKey: context.parentElementKey,
        parentElementId: context.parentElementId,
        parentTag: context.parentTag,
        siblingCount: cohort.subjectsByElementKey.size,
      },
      cohortProfile: cohort.profile,
      cohortSignals: subjectStats.signals,
      subjectIdentifiability: subjectStats.identifiability,
      factorCoverage,
      cohortSnapshots: cohort.snapshots,
      cohortFactSummary: cohort.factSummary,
      cohortProvenance: cohort.provenance,
      subjectDeclaredOffsetDeviation: subjectStats.declaredOffset,
      subjectEffectiveOffsetDeviation: subjectStats.effectiveOffset,
      subjectLineHeightDeviation: subjectStats.lineHeight,
      context,
      subjectContentComposition: subjectStats.contentComposition,
      cohortContentCompositions: cohortCompositions,
    }

    const decision = scoreAlignmentCase(alignmentCase)
    if (decision.kind === "reject") continue

    out.push({
      caseData: {
        subject: { solidFile: subjectStats.element.solidFile, elementKey: subjectStats.element.elementKey, elementId: subjectStats.element.elementId, tag: subjectStats.element.tag },
        cohort: alignmentCase.cohort,
      },
      evidence: {
        severity: decision.evaluation.severity,
        confidence: decision.evaluation.confidence,
        causes: formatAlignmentCauses(decision.evaluation.signalFindings),
        primaryFix: formatPrimaryFix(decision.evaluation.signalFindings),
        contextKind: decision.evaluation.contextKind,
        contextCertainty: decision.evaluation.contextCertainty,
        estimatedOffsetPx: decision.evaluation.estimatedOffsetPx,
        decisionReason: "accepted-lower-bound",
        posteriorLower: decision.evaluation.posterior.lower,
        posteriorUpper: decision.evaluation.posterior.upper,
        evidenceMass: decision.evaluation.evidenceMass,
        topFactors: decision.evaluation.topFactors,
      },
    })
  }

  return out
}

function buildFactorCoverage(
  subjectStats: CohortSubjectStats,
  cohort: CohortStats,
  context: AlignmentContext,
  cohortCompositions: readonly import("../../analysis/alignment").ContentCompositionFingerprint[],
): AlignmentFactorCoverage {
  const factSummary = cohort.factSummary
  const baseCoverage = factSummary.total > 0 ? factSummary.exactShare + factSummary.intervalShare * 0.7 : 0
  const contextCoverage = context.certainty === 0 /* Resolved */ ? 1 : context.certainty === 1 /* Conditional */ ? 0.6 : 0.2
  const compositionCoverage = resolveCompositionCoverage(subjectStats.contentComposition, cohortCompositions)

  return {
    "offset-delta": baseCoverage,
    "declared-offset-delta": baseCoverage,
    "baseline-conflict": baseCoverage,
    "context-conflict": contextCoverage,
    "replaced-control-risk": baseCoverage,
    "content-composition-conflict": compositionCoverage,
    "context-certainty": contextCoverage,
  }
}

function isInsideOutOfFlowAncestor(
  _parentElementKey: string,
  parentElement: ElementNode,
  semanticModel: FileSemanticModel,
): boolean {
  let current: ElementNode | null = parentElement
  while (current !== null) {
    const flowFact = semanticModel.getLayoutFact(current.elementId, "flowParticipation")
    if (!flowFact.inFlow) return true
    current = current.parentElementNode
  }
  return false
}

function dedupeDetectionsBySubject(
  detections: readonly LayoutDetection<AlignmentDetectionCase>[],
): readonly LayoutDetection<AlignmentDetectionCase>[] {
  const bySubject = new Map<string, LayoutDetection<AlignmentDetectionCase>>()
  for (let i = 0; i < detections.length; i++) {
    const current = detections[i]
    if (!current) continue
    const key = `${current.caseData.subject.solidFile}::${current.caseData.subject.elementId}`
    const existing = bySubject.get(key)
    if (!existing) { bySubject.set(key, current); continue }
    if (isStrongerDetection(current, existing)) bySubject.set(key, current)
  }

  const out: LayoutDetection<AlignmentDetectionCase>[] = new Array(bySubject.size)
  let index = 0
  for (const detection of bySubject.values()) { out[index] = detection; index++ }
  out.sort((left, right) => {
    if (left.caseData.subject.solidFile < right.caseData.subject.solidFile) return -1
    if (left.caseData.subject.solidFile > right.caseData.subject.solidFile) return 1
    return left.caseData.subject.elementId - right.caseData.subject.elementId
  })
  return out
}

function isStrongerDetection(
  current: LayoutDetection<AlignmentDetectionCase>,
  existing: LayoutDetection<AlignmentDetectionCase>,
): boolean {
  if (current.evidence.confidence > existing.evidence.confidence) return true
  if (current.evidence.confidence < existing.evidence.confidence) return false
  if (current.evidence.severity > existing.evidence.severity) return true
  if (current.evidence.severity < existing.evidence.severity) return false
  if (current.evidence.posteriorLower > existing.evidence.posteriorLower) return true
  if (current.evidence.posteriorLower < existing.evidence.posteriorLower) return false
  if (current.caseData.cohort.siblingCount > existing.caseData.cohort.siblingCount) return true
  if (current.caseData.cohort.siblingCount < existing.caseData.cohort.siblingCount) return false
  return current.caseData.cohort.parentElementId < existing.caseData.cohort.parentElementId
}

function hasNonOffsetPrimaryEvidence(topFactors: readonly AlignmentFactorId[]): boolean {
  for (let i = 0; i < topFactors.length; i++) {
    const factor = topFactors[i]
    if (!factor) continue
    if (NON_OFFSET_FACTORS.has(factor)) return true
  }
  return false
}
