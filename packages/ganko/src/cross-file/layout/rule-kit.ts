import { Level } from "@drskillissue/ganko-shared"
import type { AlignmentContextKind, ContextCertainty } from "./context-model"
import type { AlignmentFactorId } from "./signal-model"
import type { CrossRuleContext } from "../rule"
import { reservoirPush } from "./perf"
import { clamp } from "./util"

export interface LayoutEvidence {
  readonly severity: number
  readonly confidence: number
  readonly causes: readonly string[]
  readonly primaryFix: string
  readonly contextKind: AlignmentContextKind
  readonly contextCertainty: ContextCertainty
  readonly estimatedOffsetPx: number | null
  readonly decisionReason: "accepted-lower-bound"
  readonly posteriorLower: number
  readonly posteriorUpper: number
  readonly evidenceMass: number
  readonly topFactors: readonly AlignmentFactorId[]
}

export type LayoutEvaluationResult =
  | {
    readonly kind: "accept"
    readonly evidence: LayoutEvidence
  }
  | {
    readonly kind: "reject"
    readonly reason: "low-evidence" | "threshold" | "undecidable"
    readonly detail?: "evidence-mass" | "posterior" | "interval" | "identifiability"
    readonly posteriorLower: number
    readonly posteriorUpper: number
    readonly evidenceMass: number
  }

export interface LayoutDetector<TCase> {
  readonly id: string
  collect(context: CrossRuleContext): readonly TCase[]
  evaluate(input: TCase, context: CrossRuleContext): LayoutEvaluationResult
}

export interface LayoutDetection<TCase> {
  readonly caseData: TCase
  readonly evidence: LayoutEvidence
}

export function runLayoutDetector<TCase>(
  context: CrossRuleContext,
  detector: LayoutDetector<TCase>,
): readonly LayoutDetection<TCase>[] {
  const cases = detector.collect(context)
  const startedAt = performance.now()
  const out: LayoutDetection<TCase>[] = []
  const log = context.logger

  for (let i = 0; i < cases.length; i++) {
    const current = cases[i]
    if (!current) continue
    context.layout.perf.casesScored++

    const result = detector.evaluate(current, context)
    if (result.kind === "accept") {
      recordPolicyMetrics(
        context,
        result.evidence.evidenceMass,
        result.evidence.posteriorLower,
        result.evidence.posteriorUpper,
      )
      if (log.isLevelEnabled(Level.Debug)) {
        log.debug(
          `[${detector.id}] accept case=${i}`
          + ` severity=${result.evidence.severity.toFixed(2)}`
          + ` confidence=${result.evidence.confidence.toFixed(2)}`
          + ` posterior=[${result.evidence.posteriorLower.toFixed(3)},${result.evidence.posteriorUpper.toFixed(3)}]`
          + ` evidenceMass=${result.evidence.evidenceMass.toFixed(3)}`
          + ` context=${result.evidence.contextKind}`
          + ` offset=${result.evidence.estimatedOffsetPx?.toFixed(2) ?? "null"}`
          + ` topFactors=[${result.evidence.topFactors.join(",")}]`
          + ` causes=[${result.evidence.causes.join("; ")}]`,
        )
      }
      out.push({ caseData: current, evidence: result.evidence })
      continue
    }

    recordPolicyMetrics(context, result.evidenceMass, result.posteriorLower, result.posteriorUpper)

    if (log.isLevelEnabled(Level.Debug)) {
      log.debug(
        `[${detector.id}] reject case=${i}`
        + ` reason=${result.reason}`
        + ` detail=${result.detail ?? "none"}`
        + ` posterior=[${result.posteriorLower.toFixed(3)},${result.posteriorUpper.toFixed(3)}]`
        + ` evidenceMass=${result.evidenceMass.toFixed(3)}`,
      )
    }

    if (result.reason === "low-evidence") {
      context.layout.perf.casesRejectedLowEvidence++
      continue
    }

    if (result.reason === "undecidable") {
      context.layout.perf.casesRejectedUndecidable++
      if (result.detail === "identifiability") context.layout.perf.casesRejectedIdentifiability++
      if (result.detail === "interval") context.layout.perf.undecidableInterval++
      continue
    }

    context.layout.perf.casesRejectedThreshold++
  }

  context.layout.perf.scoringMs += performance.now() - startedAt

  return out
}

function recordPolicyMetrics(
  context: CrossRuleContext,
  evidenceMass: number,
  posteriorLower: number,
  posteriorUpper: number,
): void {
  context.layout.perf.factorCoverageSum += clamp(evidenceMass, 0, 1)
  context.layout.perf.factorCoverageCount++

  const width = clamp(posteriorUpper - posteriorLower, 0, 1)
  reservoirPush(context.layout.perf.posteriorWidths, width)
  if (width > 0.001) context.layout.perf.uncertaintyEscalations++
}


