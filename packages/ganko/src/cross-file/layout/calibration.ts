import type { AlignmentFactorId } from "./signal-model"
import { isBlank } from "@drskillissue/ganko-shared"

interface AlignmentFactorContract {
  readonly polarity: "support" | "penalty"
  readonly maxMagnitude: number
  readonly rationale: string
}

export const ALIGNMENT_FACTOR_IDS = [
  "offset-delta",
  "declared-offset-delta",
  "baseline-conflict",
  "context-conflict",
  "replaced-control-risk",
  "content-composition-conflict",
  "context-certainty",
] as const satisfies readonly AlignmentFactorId[]

const ALIGNMENT_FACTOR_CONTRACTS: Readonly<Record<AlignmentFactorId, AlignmentFactorContract>> = {
  "offset-delta": {
    polarity: "support",
    maxMagnitude: 1.6,
    rationale: "effective block-axis offset deviation",
  },
  "declared-offset-delta": {
    polarity: "support",
    maxMagnitude: 0.42,
    rationale: "declared block-axis offset deviation",
  },
  "baseline-conflict": {
    polarity: "support",
    maxMagnitude: 1.35,
    rationale: "line-height and vertical-align baseline mismatch",
  },
  "context-conflict": {
    polarity: "support",
    maxMagnitude: 0.78,
    rationale: "cross-axis container and child alignment mismatch",
  },
  "replaced-control-risk": {
    polarity: "support",
    maxMagnitude: 1.35,
    rationale: "replaced/control baseline interaction",
  },
  "content-composition-conflict": {
    polarity: "support",
    maxMagnitude: 2.60,
    rationale: "content composition divergence causing baseline shift between siblings",
  },
  "context-certainty": {
    polarity: "penalty",
    maxMagnitude: 0.26,
    rationale: "context certainty state",
  },
}

export interface AlignmentPolicyCalibration {
  readonly priorLogOdds: number
  readonly posteriorThreshold: number
  readonly evidenceMassFloor: number
  readonly severityPosteriorWeight: number
  readonly severityOffsetWeight: number
  readonly severityBaselineWeight: number
  readonly confidenceMassFloor: number
  readonly confidenceMassWeight: number
  readonly confidenceIntervalPenalty: number
}

export interface AlignmentStrengthCalibration {
  readonly baselineConflictBoost: number
  readonly lineHeightWeight: number
  readonly contextConflictBoost: number
  readonly contextLineHeightWeight: number
  readonly contextCenterPenalty: number
  readonly replacedDifferentTextBoost: number
  readonly replacedUnknownTextBoost: number
  readonly replacedLineHeightWeight: number
  readonly compositionMixedUnmitigatedOutlierStrength: number
  readonly compositionMixedOutlierAmongReplacedStrength: number
  readonly compositionTextOutlierAmongMixedStrength: number
  readonly compositionUnknownPenalty: number
}

export interface EvidenceContributionCalibration {
  readonly supportIntervalLowerScale: number
  readonly supportConditionalUpperScale: number
  readonly penaltyIntervalUpperScale: number
}

export const alignmentPolicyCalibration: AlignmentPolicyCalibration = {
  priorLogOdds: -1.25,
  posteriorThreshold: 0.68,
  evidenceMassFloor: 0.34,
  severityPosteriorWeight: 0.72,
  severityOffsetWeight: 0.2,
  severityBaselineWeight: 0.08,
  confidenceMassFloor: 0.25,
  confidenceMassWeight: 0.75,
  confidenceIntervalPenalty: 0.35,
}

export const alignmentStrengthCalibration: AlignmentStrengthCalibration = {
  baselineConflictBoost: 0.66,
  lineHeightWeight: 0.7,
  contextConflictBoost: 0.7,
  contextLineHeightWeight: 0.35,
  contextCenterPenalty: 0.6,
  replacedDifferentTextBoost: 0.85,
  replacedUnknownTextBoost: 0.25,
  replacedLineHeightWeight: 0.4,
  compositionMixedUnmitigatedOutlierStrength: 0.85,
  compositionMixedOutlierAmongReplacedStrength: 0.6,
  compositionTextOutlierAmongMixedStrength: 0.55,
  compositionUnknownPenalty: 0.4,
}

export const evidenceContributionCalibration: EvidenceContributionCalibration = {
  supportIntervalLowerScale: 0.6,
  supportConditionalUpperScale: 0.7,
  penaltyIntervalUpperScale: 0.45,
}

assertCalibrationContracts()

export function resolveAlignmentFactorContract(factorId: AlignmentFactorId): AlignmentFactorContract {
  return ALIGNMENT_FACTOR_CONTRACTS[factorId]
}

function assertCalibrationContracts(): void {
  assertUnitInterval("alignmentPolicyCalibration.posteriorThreshold", alignmentPolicyCalibration.posteriorThreshold)
  assertUnitInterval("alignmentPolicyCalibration.evidenceMassFloor", alignmentPolicyCalibration.evidenceMassFloor)
  assertUnitInterval("alignmentPolicyCalibration.severityPosteriorWeight", alignmentPolicyCalibration.severityPosteriorWeight)
  assertUnitInterval("alignmentPolicyCalibration.severityOffsetWeight", alignmentPolicyCalibration.severityOffsetWeight)
  assertUnitInterval("alignmentPolicyCalibration.severityBaselineWeight", alignmentPolicyCalibration.severityBaselineWeight)
  assertUnitInterval("alignmentPolicyCalibration.confidenceMassFloor", alignmentPolicyCalibration.confidenceMassFloor)
  assertUnitInterval("alignmentPolicyCalibration.confidenceMassWeight", alignmentPolicyCalibration.confidenceMassWeight)
  assertUnitInterval("alignmentPolicyCalibration.confidenceIntervalPenalty", alignmentPolicyCalibration.confidenceIntervalPenalty)
  assertFinite("alignmentPolicyCalibration.priorLogOdds", alignmentPolicyCalibration.priorLogOdds)

  const severityWeightSum =
    alignmentPolicyCalibration.severityPosteriorWeight
    + alignmentPolicyCalibration.severityOffsetWeight
    + alignmentPolicyCalibration.severityBaselineWeight
  if (severityWeightSum > 1.5) {
    throw new Error("alignmentPolicyCalibration severity weights exceed allowed bound")
  }

  let supportCount = 0
  let penaltyCount = 0
  for (let i = 0; i < ALIGNMENT_FACTOR_IDS.length; i++) {
    const factorId = ALIGNMENT_FACTOR_IDS[i]
    if (!factorId) continue
    const contract = ALIGNMENT_FACTOR_CONTRACTS[factorId]
    assertPositiveFinite(`ALIGNMENT_FACTOR_CONTRACTS.${factorId}.maxMagnitude`, contract.maxMagnitude)
    if (isBlank(contract.rationale)) {
      throw new Error(`ALIGNMENT_FACTOR_CONTRACTS.${factorId}.rationale must be non-empty`)
    }
    if (contract.polarity === "support") supportCount++
    if (contract.polarity === "penalty") penaltyCount++
  }

  if (supportCount === 0 || penaltyCount === 0) {
    throw new Error("ALIGNMENT_FACTOR_CONTRACTS must include support and penalty factors")
  }

  assertUnitInterval("alignmentStrengthCalibration.baselineConflictBoost", alignmentStrengthCalibration.baselineConflictBoost)
  assertUnitInterval("alignmentStrengthCalibration.lineHeightWeight", alignmentStrengthCalibration.lineHeightWeight)
  assertUnitInterval("alignmentStrengthCalibration.contextConflictBoost", alignmentStrengthCalibration.contextConflictBoost)
  assertUnitInterval("alignmentStrengthCalibration.contextLineHeightWeight", alignmentStrengthCalibration.contextLineHeightWeight)
  assertUnitInterval("alignmentStrengthCalibration.contextCenterPenalty", alignmentStrengthCalibration.contextCenterPenalty)
  assertUnitInterval("alignmentStrengthCalibration.replacedDifferentTextBoost", alignmentStrengthCalibration.replacedDifferentTextBoost)
  assertUnitInterval("alignmentStrengthCalibration.replacedUnknownTextBoost", alignmentStrengthCalibration.replacedUnknownTextBoost)
  assertUnitInterval("alignmentStrengthCalibration.replacedLineHeightWeight", alignmentStrengthCalibration.replacedLineHeightWeight)
  if (alignmentStrengthCalibration.replacedDifferentTextBoost < alignmentStrengthCalibration.replacedUnknownTextBoost) {
    throw new Error("alignmentStrengthCalibration replaced text boosts violate monotonicity")
  }

  assertUnitInterval(
    "alignmentStrengthCalibration.compositionMixedUnmitigatedOutlierStrength",
    alignmentStrengthCalibration.compositionMixedUnmitigatedOutlierStrength,
  )
  assertUnitInterval(
    "alignmentStrengthCalibration.compositionMixedOutlierAmongReplacedStrength",
    alignmentStrengthCalibration.compositionMixedOutlierAmongReplacedStrength,
  )
  assertUnitInterval(
    "alignmentStrengthCalibration.compositionTextOutlierAmongMixedStrength",
    alignmentStrengthCalibration.compositionTextOutlierAmongMixedStrength,
  )
  assertUnitInterval(
    "alignmentStrengthCalibration.compositionUnknownPenalty",
    alignmentStrengthCalibration.compositionUnknownPenalty,
  )
  if (alignmentStrengthCalibration.compositionMixedUnmitigatedOutlierStrength < alignmentStrengthCalibration.compositionMixedOutlierAmongReplacedStrength) {
    throw new Error("alignmentStrengthCalibration composition strengths violate monotonicity")
  }

  assertUnitInterval(
    "evidenceContributionCalibration.supportIntervalLowerScale",
    evidenceContributionCalibration.supportIntervalLowerScale,
  )
  assertUnitInterval(
    "evidenceContributionCalibration.supportConditionalUpperScale",
    evidenceContributionCalibration.supportConditionalUpperScale,
  )
  assertUnitInterval(
    "evidenceContributionCalibration.penaltyIntervalUpperScale",
    evidenceContributionCalibration.penaltyIntervalUpperScale,
  )
  assertPositiveFinite(
    "evidenceContributionCalibration.supportIntervalLowerScale",
    evidenceContributionCalibration.supportIntervalLowerScale,
  )
  assertPositiveFinite(
    "evidenceContributionCalibration.supportConditionalUpperScale",
    evidenceContributionCalibration.supportConditionalUpperScale,
  )
}

function assertFinite(name: string, value: number): void {
  if (Number.isFinite(value)) return
  throw new Error(`${name} must be finite`)
}

function assertPositiveFinite(name: string, value: number): void {
  assertFinite(name, value)
  if (value > 0) return
  throw new Error(`${name} must be > 0`)
}

function assertUnitInterval(name: string, value: number): void {
  assertFinite(name, value)
  if (value >= 0 && value <= 1) return
  throw new Error(`${name} must be in [0, 1]`)
}
