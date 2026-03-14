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

const EMPTY_FACTOR_LIST: readonly AlignmentFactorId[] = Object.freeze([])

function selectTopFactors(evidence: ConsistencyEvidence): readonly AlignmentFactorId[] {
  const atoms = evidence.atoms
  if (atoms.length === 0) return EMPTY_FACTOR_LIST

  const top: { id: AlignmentFactorId; mag: number }[] = []
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (!atom) continue
    const mag = Math.abs((atom.contribution.min + atom.contribution.max) / 2)
    if (mag <= 0) continue

    if (top.length < 4) {
      top.push({ id: atom.factorId, mag })
      continue
    }

    let minIdx = 0
    for (let j = 1; j < top.length; j++) {
      const curr = top[j]
      const best = top[minIdx]
      if (curr && best && curr.mag < best.mag) minIdx = j
    }
    const minEntry = top[minIdx]
    if (minEntry && mag > minEntry.mag) {
      top[minIdx] = { id: atom.factorId, mag }
    }
  }

  top.sort((a, b) => {
    if (a.mag !== b.mag) return b.mag - a.mag
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
  return top.map(t => t.id)
}

function logistic(value: number): number {
  if (value > 30) return 1
  if (value < -30) return 0
  return 1 / (1 + Math.exp(-value))
}


