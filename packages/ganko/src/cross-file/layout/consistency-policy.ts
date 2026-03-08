import type { AlignmentFactorId, PosteriorInterval } from "./signal-model"
import { alignmentPolicyCalibration } from "./calibration"
import type { ConsistencyEvidence } from "./consistency-evidence"
import { clamp } from "./util"

export type ConsistencyRejectionReason = "low-evidence" | "threshold" | "undecidable"

export type ConsistencyRejectDetail = "evidence-mass" | "posterior" | "interval" | "identifiability"

export type ConsistencyPolicyDecision =
  | {
    readonly kind: "accept"
    readonly severity: number
    readonly confidence: number
    readonly posterior: PosteriorInterval
    readonly evidenceMass: number
    readonly topFactors: readonly AlignmentFactorId[]
  }
  | {
    readonly kind: "reject"
    readonly reason: ConsistencyRejectionReason
    readonly detail: ConsistencyRejectDetail
    readonly posterior: PosteriorInterval
    readonly evidenceMass: number
  }

export interface ConsistencyPolicyInput {
  readonly evidence: ConsistencyEvidence
}

export function applyConsistencyPolicy(input: ConsistencyPolicyInput): ConsistencyPolicyDecision {
  const evidenceMass = resolveEvidenceMass(input.evidence)
  const posterior = resolvePosteriorBounds(input.evidence)

  if (input.evidence.identifiability.ambiguous) {
    return {
      kind: "reject",
      reason: "undecidable",
      detail: "identifiability",
      posterior,
      evidenceMass,
    }
  }

  if (posterior.lower >= alignmentPolicyCalibration.posteriorThreshold) {
    return {
      kind: "accept",
      severity: resolveSeverity(input.evidence, posterior),
      confidence: resolveConfidence(posterior, evidenceMass),
      posterior,
      evidenceMass,
      topFactors: selectTopFactors(input.evidence),
    }
  }

  if (posterior.upper < alignmentPolicyCalibration.posteriorThreshold) {
    return {
      kind: "reject",
      reason: "threshold",
      detail: "posterior",
      posterior,
      evidenceMass,
    }
  }

  return {
    kind: "reject",
    reason: "undecidable",
    detail: "interval",
    posterior,
    evidenceMass,
  }
}

function resolvePosteriorBounds(evidence: ConsistencyEvidence): PosteriorInterval {
  let minLogOdds = alignmentPolicyCalibration.priorLogOdds
  let maxLogOdds = alignmentPolicyCalibration.priorLogOdds

  for (let i = 0; i < evidence.atoms.length; i++) {
    const atom = evidence.atoms[i]
    if (!atom) continue
    const contribution = atom.contribution
    minLogOdds += contribution.min
    maxLogOdds += contribution.max
  }

  return {
    lower: logistic(minLogOdds),
    upper: logistic(maxLogOdds),
  }
}

function resolveEvidenceMass(evidence: ConsistencyEvidence): number {
  if (evidence.atoms.length === 0) return 0

  let coverageWeightedSum = 0
  let contributionWeightSum = 0
  for (let i = 0; i < evidence.atoms.length; i++) {
    const atom = evidence.atoms[i]
    if (!atom) continue
    const meanContribution = Math.abs((atom.contribution.min + atom.contribution.max) / 2)
    if (meanContribution <= 0) continue
    const weight = clamp(meanContribution, 0, 4)
    coverageWeightedSum += clamp(atom.coverage, 0, 1) * weight
    contributionWeightSum += weight
  }

  if (contributionWeightSum <= 0) return 0
  return clamp(coverageWeightedSum / contributionWeightSum, 0, 1)
}

function resolveSeverity(evidence: ConsistencyEvidence, posterior: PosteriorInterval): number {
  const midpoint = (posterior.lower + posterior.upper) / 2
  const severity =
    midpoint * alignmentPolicyCalibration.severityPosteriorWeight
    + evidence.offsetStrength * alignmentPolicyCalibration.severityOffsetWeight
    + evidence.baselineStrength * alignmentPolicyCalibration.severityBaselineWeight
  return clamp(severity, 0, 1)
}

function resolveConfidence(posterior: PosteriorInterval, evidenceMass: number): number {
  const intervalWidth = posterior.upper - posterior.lower
  const weightedMass =
    alignmentPolicyCalibration.confidenceMassFloor
    + evidenceMass * alignmentPolicyCalibration.confidenceMassWeight
  const confidence = posterior.lower * weightedMass * (1 - intervalWidth * alignmentPolicyCalibration.confidenceIntervalPenalty)
  return clamp(confidence, 0, 1)
}

function selectTopFactors(evidence: ConsistencyEvidence): readonly AlignmentFactorId[] {
  const sorted = [...evidence.atoms]
  sorted.sort((left, right) => {
    const leftMagnitude = Math.abs((left.contribution.min + left.contribution.max) / 2)
    const rightMagnitude = Math.abs((right.contribution.min + right.contribution.max) / 2)
    if (leftMagnitude !== rightMagnitude) return rightMagnitude - leftMagnitude
    if (left.factorId < right.factorId) return -1
    if (left.factorId > right.factorId) return 1
    return 0
  })

  const out: AlignmentFactorId[] = []
  for (let i = 0; i < sorted.length && i < 4; i++) {
    const item = sorted[i]
    if (!item) continue
    out.push(item.factorId)
  }

  return out
}

function logistic(value: number): number {
  if (value > 30) return 1
  if (value < -30) return 0
  return 1 / (1 + Math.exp(-value))
}


