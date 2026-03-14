import {
  AlignmentTextContrast,
  ContentCompositionClassification,
  EvidenceValueKind,
  SignalConflictValue,
  type AlignmentCase,
  type AlignmentFactorId,
  type CohortIdentifiability,
  type EvidenceAtom,
  type EvidenceProvenance,
  type LogOddsInterval,
  type NumericEvidenceValue,
} from "./signal-model"
import {
  alignmentStrengthCalibration,
  evidenceContributionCalibration,
  resolveAlignmentFactorContract,
} from "./calibration"
import { ContextCertainty } from "./context-model"
import { resolveCompositionDivergenceStrength } from "./content-composition"
import { clamp, mergeEvidenceKind } from "./util"

export interface ConsistencyEvidence {
  readonly offsetStrength: number
  readonly declaredOffsetStrength: number
  readonly baselineStrength: number
  readonly contextStrength: number
  readonly replacedStrength: number
  readonly compositionStrength: number
  readonly identifiability: CohortIdentifiability
  readonly factSummary: AlignmentCase["cohortFactSummary"]
  readonly atoms: readonly EvidenceAtom[]
}

interface StrengthEvidence {
  readonly strength: number
  readonly kind: EvidenceValueKind
}

export function buildConsistencyEvidence(input: AlignmentCase): ConsistencyEvidence {
  const factSummary = input.cohortFactSummary
  const effectiveOffsetScaleReference = resolveOffsetScaleReference(
    input.cohortProfile.medianLineHeightPx,
    input.cohortProfile.medianEffectiveOffsetPx,
  )
  const declaredOffsetScaleReference = resolveOffsetScaleReference(
    input.cohortProfile.medianLineHeightPx,
    input.cohortProfile.medianDeclaredOffsetPx,
  )

  const offsetRaw = normalizeDeviation(
    input.subjectEffectiveOffsetDeviation,
    input.cohortProfile.effectiveOffsetDispersionPx,
    effectiveOffsetScaleReference,
  )
  const declaredOffsetRaw = normalizeDeviation(
    input.subjectDeclaredOffsetDeviation,
    input.cohortProfile.declaredOffsetDispersionPx,
    declaredOffsetScaleReference,
  )
  const lineHeight = normalizeDeviation(
    input.subjectLineHeightDeviation,
    input.cohortProfile.lineHeightDispersionPx,
    input.cohortProfile.medianLineHeightPx,
  )

  // When the alignment context uses purely geometric positioning (e.g. flex
  // `align-items: center`, table-cell `vertical-align: middle`), baselines are
  // never consulted. All baseline-dependent evidence factors are suppressed.
  // See `context-model.ts::BaselineRelevance` for CSS spec references.
  const baselinesIrrelevant = input.context.baselineRelevance === "irrelevant"
  // When the block axis is the container's main axis (e.g. flex-direction: column),
  // vertical offset differences are the layout algorithm's normal behavior.
  // Suppress ALL evidence — offset, baseline, context, replaced, composition.
  const blockAxisIsMainAxis = !input.context.crossAxisIsBlockAxis
  const suppressAll = blockAxisIsMainAxis
  const offset = suppressAll ? ZERO_STRENGTH : offsetRaw
  const declaredOffset = suppressAll ? ZERO_STRENGTH : declaredOffsetRaw

  const baselineStrength = (baselinesIrrelevant || suppressAll) ? ZERO_STRENGTH : resolveBaselineStrength(input, lineHeight)
  const contextStrength = (baselinesIrrelevant || suppressAll) ? ZERO_STRENGTH : resolveContextStrength(input, lineHeight)
  const replacedStrength = (baselinesIrrelevant || suppressAll) ? ZERO_STRENGTH : resolveReplacedControlStrength(input, lineHeight)
  const compositionStrength = (baselinesIrrelevant || suppressAll) ? ZERO_STRENGTH : resolveContentCompositionStrength(input)
  const contextCertaintyPenalty = resolveContextCertaintyPenalty(input)
  const provenance = input.cohortProvenance
  const atoms = buildEvidenceAtoms(
    input,
    offset,
    declaredOffset,
    baselineStrength,
    contextStrength,
    replacedStrength,
    compositionStrength,
    contextCertaintyPenalty,
    provenance,
  )

  return {
    offsetStrength: offset.strength,
    declaredOffsetStrength: declaredOffset.strength,
    baselineStrength: baselineStrength.strength,
    contextStrength: contextStrength.strength,
    replacedStrength: replacedStrength.strength,
    compositionStrength: compositionStrength.strength,
    identifiability: input.subjectIdentifiability,
    factSummary,
    atoms,
  }
}

function normalizeDeviation(
  value: NumericEvidenceValue,
  dispersion: number | null,
  baselineMagnitude: number | null,
): StrengthEvidence {
  if (value.value === null || value.value <= 0) {
    return {
      strength: 0,
      kind: value.kind,
    }
  }

  const scaledDispersion = dispersion === null ? 0 : Math.abs(dispersion) * 1.5
  const magnitudeScale = baselineMagnitude === null ? 0 : Math.abs(baselineMagnitude)
  let scale = scaledDispersion
  if (magnitudeScale > scale) scale = magnitudeScale
  if (scale <= 0) scale = Math.abs(value.value)

  if (scale <= 0) {
    return {
      strength: 0,
      kind: value.kind,
    }
  }

  return {
    strength: value.value / scale,
    kind: value.kind,
  }
}

function resolveOffsetScaleReference(
  medianLineHeightPx: number | null,
  fallbackMedianOffsetPx: number | null,
): number | null {
  if (medianLineHeightPx !== null) return Math.abs(medianLineHeightPx) * 0.1
  if (fallbackMedianOffsetPx === null) return null
  return Math.abs(fallbackMedianOffsetPx)
}

function resolveBaselineStrength(input: AlignmentCase, lineHeight: StrengthEvidence): StrengthEvidence {
  const verticalAlign = input.cohortSignals.verticalAlign
  const hasConflict = verticalAlign.value === SignalConflictValue.Conflict
  const conflict = hasConflict
    ? alignmentStrengthCalibration.baselineConflictBoost
    : 0
  const kind = resolveBaselineEvidenceKind(lineHeight.kind, verticalAlign.kind, hasConflict)

  return {
    strength: clamp(lineHeight.strength * alignmentStrengthCalibration.lineHeightWeight + conflict, 0, 1),
    kind,
  }
}

function resolveBaselineEvidenceKind(
  lineHeightKind: EvidenceValueKind,
  verticalAlignKind: EvidenceValueKind,
  hasConflict: boolean,
): EvidenceValueKind {
  if (!hasConflict) return mergeEvidenceKind(lineHeightKind, verticalAlignKind)
  if (lineHeightKind === EvidenceValueKind.Unknown) return verticalAlignKind
  return mergeEvidenceKind(lineHeightKind, verticalAlignKind)
}

function resolveContextStrength(input: AlignmentCase, lineHeight: StrengthEvidence): StrengthEvidence {
  const contextKind = mapContextCertaintyToEvidenceKind(input.context.certainty)
  if (input.context.kind !== "flex-cross-axis" && input.context.kind !== "grid-cross-axis") {
    return {
      strength: 0,
      kind: contextKind,
    }
  }

  const conflict = resolveContextConflictEvidence(input)
  const parentIsCenter = input.context.parentAlignItems === "center" || input.context.parentPlaceItems === "center"
  const centerPenalty = parentIsCenter ? alignmentStrengthCalibration.contextCenterPenalty : 0
  const kind = mergeEvidenceKind(mergeEvidenceKind(lineHeight.kind, conflict.kind), contextKind)

  return {
    strength: clamp(
      conflict.strength + lineHeight.strength * alignmentStrengthCalibration.contextLineHeightWeight - centerPenalty,
      0,
      1,
    ),
    kind,
  }
}

function resolveContextConflictEvidence(input: AlignmentCase): StrengthEvidence {
  const alignSelf = input.cohortSignals.alignSelf
  const placeSelf = input.cohortSignals.placeSelf
  const kind = mergeEvidenceKind(alignSelf.kind, placeSelf.kind)
  const hasConflict = alignSelf.value === SignalConflictValue.Conflict || placeSelf.value === SignalConflictValue.Conflict
  if (!hasConflict) {
    return {
      strength: 0,
      kind,
    }
  }

  return {
    strength: alignmentStrengthCalibration.contextConflictBoost,
    kind,
  }
}

function resolveReplacedControlStrength(input: AlignmentCase, lineHeight: StrengthEvidence): StrengthEvidence {
  const subject = input.subject.snapshot
  const hasReplacedPair =
    subject.node.isControl
    || subject.node.isReplaced
    || input.cohortSignals.hasControlOrReplacedPeer
  if (!hasReplacedPair) {
    return {
      strength: 0,
      kind: lineHeight.kind,
    }
  }

  if (input.cohortSignals.textContrastWithPeers === AlignmentTextContrast.Different) {
    return {
      strength: alignmentStrengthCalibration.replacedDifferentTextBoost,
      kind: EvidenceValueKind.Exact,
    }
  }

  if (input.cohortSignals.textContrastWithPeers === AlignmentTextContrast.Unknown) {
    return {
      strength: alignmentStrengthCalibration.replacedUnknownTextBoost,
      kind: EvidenceValueKind.Conditional,
    }
  }

  return {
    strength: clamp(lineHeight.strength * alignmentStrengthCalibration.replacedLineHeightWeight, 0, 1),
    kind: lineHeight.kind,
  }
}

function resolveContentCompositionStrength(input: AlignmentCase): StrengthEvidence {
  const divergenceStrength = resolveCompositionDivergenceStrength(
    input.subjectContentComposition,
    input.cohortContentCompositions,
    input.context,
  )

  if (divergenceStrength <= 0) {
    return {
      strength: 0,
      kind: EvidenceValueKind.Exact,
    }
  }

  const subjectClassification = input.subjectContentComposition.classification
  const kind: EvidenceValueKind = subjectClassification === ContentCompositionClassification.Unknown ? EvidenceValueKind.Conditional : EvidenceValueKind.Exact

  return {
    strength: clamp(divergenceStrength, 0, 1),
    kind,
  }
}

function resolveContextCertaintyPenalty(input: AlignmentCase): StrengthEvidence {
  const kind = mapContextCertaintyToEvidenceKind(input.context.certainty)
  const coverage = clamp(input.factorCoverage["context-certainty"], 0, 1)
  return {
    strength: 1 - coverage,
    kind,
  }
}

function buildEvidenceAtoms(
  input: AlignmentCase,
  offset: StrengthEvidence,
  declaredOffset: StrengthEvidence,
  baselineStrength: StrengthEvidence,
  contextStrength: StrengthEvidence,
  replacedStrength: StrengthEvidence,
  compositionStrength: StrengthEvidence,
  contextCertaintyPenalty: StrengthEvidence,
  provenance: EvidenceProvenance,
): readonly EvidenceAtom[] {
  const out: EvidenceAtom[] = []

  pushSupportAtom(
    out,
    "offset-delta",
    offset.kind,
    offset.strength,
    input.factorCoverage["offset-delta"],
    provenance,
  )
  pushSupportAtom(
    out,
    "declared-offset-delta",
    declaredOffset.kind,
    declaredOffset.strength,
    input.factorCoverage["declared-offset-delta"],
    provenance,
  )
  pushSupportAtom(
    out,
    "baseline-conflict",
    baselineStrength.kind,
    baselineStrength.strength,
    input.factorCoverage["baseline-conflict"],
    provenance,
  )
  pushSupportAtom(
    out,
    "context-conflict",
    contextStrength.kind,
    contextStrength.strength,
    input.factorCoverage["context-conflict"],
    provenance,
  )
  pushSupportAtom(
    out,
    "replaced-control-risk",
    replacedStrength.kind,
    replacedStrength.strength,
    input.factorCoverage["replaced-control-risk"],
    provenance,
  )
  pushSupportAtom(
    out,
    "content-composition-conflict",
    compositionStrength.kind,
    compositionStrength.strength,
    input.factorCoverage["content-composition-conflict"],
    provenance,
  )

  pushPenaltyAtom(
    out,
    "context-certainty",
    contextCertaintyPenalty.kind,
    contextCertaintyPenalty.strength,
    input.factorCoverage["context-certainty"],
    provenance,
  )

  return out
}

function mapContextCertaintyToEvidenceKind(certainty: AlignmentCase["context"]["certainty"]): EvidenceValueKind {
  if (certainty === ContextCertainty.Resolved) return EvidenceValueKind.Exact
  if (certainty === ContextCertainty.Conditional) return EvidenceValueKind.Conditional
  return EvidenceValueKind.Unknown
}

function pushSupportAtom(
  out: EvidenceAtom[],
  factorId: AlignmentFactorId,
  valueKind: EvidenceValueKind,
  strength: number,
  coverage: number,
  provenance: EvidenceProvenance,
): void {
  pushAtom(out, factorId, valueKind, strength, coverage, provenance, "support")
}

function pushPenaltyAtom(
  out: EvidenceAtom[],
  factorId: AlignmentFactorId,
  valueKind: EvidenceValueKind,
  strength: number,
  coverage: number,
  provenance: EvidenceProvenance,
): void {
  pushAtom(out, factorId, valueKind, strength, coverage, provenance, "penalty")
}

function pushAtom(
  out: EvidenceAtom[],
  factorId: AlignmentFactorId,
  valueKind: EvidenceValueKind,
  strength: number,
  coverage: number,
  provenance: EvidenceProvenance,
  expectedPolarity: "support" | "penalty",
): void {
  if (strength <= 0) return

  const contract = resolveAlignmentFactorContract(factorId)
  if (contract.polarity !== expectedPolarity) {
    throw new Error(`alignment factor polarity mismatch for ${factorId}`)
  }

  const contribution = expectedPolarity === "support"
    ? toPositiveContribution(strength, contract.maxMagnitude, valueKind)
    : toNegativeContribution(strength, contract.maxMagnitude, valueKind)

  out.push({
    factorId,
    valueKind,
    contribution,
    provenance,
    relevanceWeight: clamp(strength, 0, 1),
    coverage: clamp(coverage, 0, 1),
  })
}

function toPositiveContribution(strength: number, maxWeight: number, valueKind: EvidenceValueKind): LogOddsInterval {
  const contribution = clamp(strength, 0, 2) * maxWeight
  if (valueKind === EvidenceValueKind.Exact) {
    return {
      min: contribution,
      max: contribution,
    }
  }
  if (valueKind === EvidenceValueKind.Interval) {
    return {
      min: contribution * evidenceContributionCalibration.supportIntervalLowerScale,
      max: contribution,
    }
  }
  if (valueKind === EvidenceValueKind.Conditional) {
    return {
      min: 0,
      max: contribution * evidenceContributionCalibration.supportConditionalUpperScale,
    }
  }

  return {
    min: 0,
    max: 0,
  }
}

function toNegativeContribution(strength: number, maxPenalty: number, valueKind: EvidenceValueKind): LogOddsInterval {
  const penalty = clamp(strength, 0, 1) * maxPenalty

  if (valueKind === EvidenceValueKind.Exact) {
    return {
      min: -penalty,
      max: -penalty,
    }
  }
  if (valueKind === EvidenceValueKind.Interval) {
    return {
      min: -penalty,
      max: -penalty * evidenceContributionCalibration.penaltyIntervalUpperScale,
    }
  }
  if (valueKind === EvidenceValueKind.Conditional) {
    return {
      min: -penalty,
      max: 0,
    }
  }

  return {
    min: -penalty,
    max: 0,
  }
}

const ZERO_STRENGTH: StrengthEvidence = { strength: 0, kind: EvidenceValueKind.Exact }

