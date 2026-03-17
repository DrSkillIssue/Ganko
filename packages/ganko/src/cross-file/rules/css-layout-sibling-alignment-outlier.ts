import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import {
  collectAlignmentCases,
  evaluateAlignmentCase,
  formatAlignmentCauses,
  formatPrimaryFix,
  readFlowParticipationFact,
  runLayoutDetector,
  type AlignmentCase,
  type LayoutDetection,
  type LayoutDetector,
} from "../layout"
import type { LayoutElementNode, LayoutGraph } from "../layout/graph"
import { readNodeRefById, formatFixed } from "./rule-runtime"

const messages = {
  misalignedSibling:
    "Vertically misaligned '{{subject}}' in '{{parent}}'.{{fix}}{{offsetClause}}",
} as const

/**
 * Minimum confidence threshold for emitting alignment warnings.
 * Detections below this threshold indicate the rule is uncertain
 * about the alignment issue and would produce noise.
 *
 * Set to 0.48 rather than 0.50 to avoid rejecting cases where CSS
 * variables widen the posterior interval just enough to push
 * confidence marginally below 0.50, even though strong non-offset
 * factors (baseline-conflict, replaced-control-risk) are present.
 */
const MIN_CONFIDENCE_THRESHOLD = 0.48

/**
 * Minimum estimated offset (in CSS px) to consider as a meaningful alignment issue.
 *
 * Sub-2px differences are almost always intentional visual refinements (e.g. `mt-px`
 * to optically align an icon with adjacent text). They pose negligible CLS risk and
 * are standard practice in UI design.
 */
const MIN_OFFSET_PX_THRESHOLD = 2.0

const siblingAlignmentDetector: LayoutDetector<AlignmentCase> = {
  id: "sibling-alignment-outlier",
  collect: collectAlignmentCases,
  evaluate(input, context) {
    if (context.logger.enabled) {
      const ctx = input.context
      context.logger.trace(
        `[sibling-alignment] evaluate subject=${input.subject.elementKey} tag=${input.subject.tag}`
        + ` parent=${ctx.parentElementKey} parentTag=${ctx.parentTag}`
        + ` context.kind=${ctx.kind} certainty=${ctx.certainty}`
        + ` display=${ctx.parentDisplay} alignItems=${ctx.parentAlignItems}`
        + ` crossAxisIsBlockAxis=${ctx.crossAxisIsBlockAxis} crossAxisCertainty=${ctx.crossAxisIsBlockAxisCertainty}`
        + ` baseline=${ctx.baselineRelevance}`,
      )
    }
    const decision = evaluateAlignmentCase(input)
    if (decision.kind === "reject") {
      return {
        kind: "reject",
        reason: decision.reason,
        detail: decision.detail,
        posteriorLower: decision.posterior.lower,
        posteriorUpper: decision.posterior.upper,
        evidenceMass: decision.evidenceMass,
      }
    }

    return {
      kind: "accept",
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
    }
  },
}

export const cssLayoutSiblingAlignmentOutlier = defineCrossRule({
  id: "css-layout-sibling-alignment-outlier",
  severity: "warn",
  messages,
  meta: {
    description:
      "Detect vertical alignment outliers between sibling elements in shared layout containers.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const log = context.logger
    const detections = runLayoutDetector(context, siblingAlignmentDetector)
    const uniqueDetections = dedupeDetectionsBySubject(detections)

    if (log.enabled) {
      log.debug(
        `[sibling-alignment] raw=${detections.length} deduped=${uniqueDetections.length}`,
      )
    }

    for (let i = 0; i < uniqueDetections.length; i++) {
      const detection = uniqueDetections[i]
      if (!detection) continue

      const subjectTag = detection.caseData.subject.tag ?? "element"
      const parentTag = detection.caseData.cohort.parentTag ?? "container"
      const subjectFile = detection.caseData.subject.solidFile
      const subjectId = detection.caseData.subject.elementId
      const logPrefix = `[sibling-alignment] <${subjectTag}> in <${parentTag}> (${subjectFile}#${subjectId})`

      // Skip low-confidence detections where the rule itself is uncertain.
      if (detection.evidence.confidence < MIN_CONFIDENCE_THRESHOLD) {
        if (log.enabled) {
          log.debug(
            `${logPrefix} SKIP: confidence=${detection.evidence.confidence.toFixed(2)} < threshold=${MIN_CONFIDENCE_THRESHOLD}`,
          )
        }
        continue
      }

      // Skip detections with negligible estimated offset when offset is the
      // primary evidence factor. Sub-pixel and 1px differences are standard
      // visual refinements (e.g. `mt-px` for optical icon alignment), not
      // CLS-relevant layout issues. However, when non-offset factors dominate
      // (baseline-conflict, context-conflict, replaced-control-risk), the
      // detection should proceed regardless of offset magnitude.
      const estimatedOffset = detection.evidence.estimatedOffsetPx
      if (
        estimatedOffset !== null
        && Math.abs(estimatedOffset) < MIN_OFFSET_PX_THRESHOLD
        && !hasNonOffsetPrimaryEvidence(detection.evidence.topFactors)
      ) {
        if (log.enabled) {
          log.debug(
            `${logPrefix} SKIP: offset=${estimatedOffset.toFixed(2)}px < ${MIN_OFFSET_PX_THRESHOLD}px`
            + ` (no non-offset primary evidence, topFactors=[${detection.evidence.topFactors.join(",")}])`,
          )
        }
        continue
      }

      // Skip detections where the cohort's parent (or any ancestor) is out of
      // normal flow. Elements inside fixed/absolute containers don't participate
      // in the main document layout, so alignment issues within them cannot
      // contribute to CLS.
      if (isInsideOutOfFlowAncestor(
        context.layout,
        detection.caseData.cohort.parentElementKey,
        detection.caseData.subject.solidFile,
      )) {
        if (log.enabled) {
          log.debug(`${logPrefix} SKIP: out-of-flow ancestor`)
        }
        continue
      }

      const subjectRef = readNodeRefById(
        context.layout,
        detection.caseData.subject.solidFile,
        detection.caseData.subject.elementId,
      )
      if (!subjectRef) {
        if (log.enabled) {
          log.debug(`${logPrefix} SKIP: no node ref`)
        }
        continue
      }

      const subject = subjectTag
      const parent = parentTag
      const severity = formatFixed(detection.evidence.severity)
      const confidence = formatFixed(detection.evidence.confidence)
      const offset = detection.evidence.estimatedOffsetPx
      const hasOffset =
        offset !== null
        && Math.abs(offset) > 0.25
      const offsetClause = hasOffset
        ? ` Estimated offset: ${formatFixed(offset)}px.`
        : ""
      const causes = detection.evidence.causes.length === 0
        ? "alignment signals indicate an outlier"
        : detection.evidence.causes.join("; ")
      const primaryFix = detection.evidence.primaryFix
      const firstChar = primaryFix.length > 0 ? primaryFix[0] : undefined
      const fix = firstChar !== undefined
        ? ` ${firstChar.toUpperCase()}${primaryFix.slice(1)}.`
        : ""

      if (log.enabled) {
        log.debug(
          `${logPrefix} EMIT: severity=${severity} confidence=${confidence}`
          + ` offset=${offset?.toFixed(2) ?? "null"}`
          + ` posterior=[${detection.evidence.posteriorLower.toFixed(3)},${detection.evidence.posteriorUpper.toFixed(3)}]`
          + ` evidenceMass=${detection.evidence.evidenceMass.toFixed(3)}`
          + ` topFactors=[${detection.evidence.topFactors.join(",")}]`
          + ` causes=[${causes}]`,
        )
      }

      emit(
        createDiagnostic(
          subjectRef.solid.file,
          subjectRef.element.node,
          subjectRef.solid.sourceFile,
          cssLayoutSiblingAlignmentOutlier.id,
          "misalignedSibling",
          resolveMessage(messages.misalignedSibling, {
            subject,
            parent,
            fix,
            offsetClause,
          }),
          "warn",
        ),
      )
    }
  },
})

/**
 * Check if an element's parent (or any ancestor) is out of normal flow.
 * Walks up the parent chain from the cohort's parent element to the root,
 * checking if any ancestor has position: fixed or position: absolute.
 */
function isInsideOutOfFlowAncestor(
  layout: LayoutGraph,
  parentElementKey: string,
  solidFile: string,
): boolean {
  const elementsByFile = layout.elementBySolidFileAndId.get(solidFile)
  if (!elementsByFile) return false

  // Find the parent node by walking the element map
  let current: LayoutElementNode | null = null
  for (const node of elementsByFile.values()) {
    if (node.key === parentElementKey) {
      current = node
      break
    }
  }

  // Walk up ancestor chain checking flow participation
  while (current !== null) {
    const flowFact = readFlowParticipationFact(layout, current)
    if (!flowFact.inFlow) return true
    current = current.parentElementNode
  }

  return false
}

function dedupeDetectionsBySubject(
  detections: readonly LayoutDetection<AlignmentCase>[],
): readonly LayoutDetection<AlignmentCase>[] {
  const bySubject = new Map<string, LayoutDetection<AlignmentCase>>()

  for (let i = 0; i < detections.length; i++) {
    const current = detections[i]
    if (!current) continue
    const key = `${current.caseData.subject.solidFile}::${current.caseData.subject.elementId}`
    const existing = bySubject.get(key)

    if (!existing) {
      bySubject.set(key, current)
      continue
    }

    if (isStrongerDetection(current, existing)) {
      bySubject.set(key, current)
    }
  }

  const out: LayoutDetection<AlignmentCase>[] = new Array(bySubject.size)
  let index = 0
  for (const detection of bySubject.values()) {
    out[index] = detection
    index++
  }
  out.sort((left, right) => {
    if (left.caseData.subject.solidFile < right.caseData.subject.solidFile) return -1
    if (left.caseData.subject.solidFile > right.caseData.subject.solidFile) return 1
    return left.caseData.subject.elementId - right.caseData.subject.elementId
  })
  return out
}

function isStrongerDetection(
  current: LayoutDetection<AlignmentCase>,
  existing: LayoutDetection<AlignmentCase>,
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

const NON_OFFSET_FACTORS: ReadonlySet<string> = new Set([
  "baseline-conflict",
  "context-conflict",
  "replaced-control-risk",
  "content-composition-conflict",
])

/**
 * Returns true when at least one top factor is a non-offset signal
 * (baseline-conflict, context-conflict, or replaced-control-risk).
 * When these factors dominate, the detection is meaningful regardless
 * of the estimated pixel offset.
 */
function hasNonOffsetPrimaryEvidence(topFactors: readonly string[]): boolean {
  for (let i = 0; i < topFactors.length; i++) {
    const factor = topFactors[i]
    if (!factor) continue
    if (NON_OFFSET_FACTORS.has(factor)) return true
  }
  return false
}
