import type {
  AlignmentCase,
  AlignmentEvaluation,
  AlignmentFactorId,
  AlignmentFindingKind,
  AlignmentSignalFinding,
  EvidenceAtom,
  PosteriorInterval,
} from "./signal-model"
import { buildConsistencyEvidence, type ConsistencyEvidence } from "./consistency-evidence"
import {
  applyConsistencyPolicy,
  type ConsistencyRejectDetail,
  type ConsistencyRejectionReason,
} from "./consistency-policy"
import {
  formatCompositionFixSuggestion,
} from "./content-composition"
import { clamp } from "./util"

export type AlignmentRejectionReason = ConsistencyRejectionReason
export type AlignmentRejectionDetail = ConsistencyRejectDetail

export type AlignmentEvaluationDecision =
  | {
    readonly kind: "accept"
    readonly evaluation: AlignmentEvaluation
  }
  | {
    readonly kind: "reject"
    readonly reason: AlignmentRejectionReason
    readonly detail: AlignmentRejectionDetail
    readonly posterior: PosteriorInterval
    readonly evidenceMass: number
  }

export function evaluateAlignmentCase(input: AlignmentCase): AlignmentEvaluationDecision {
  const evidence = buildConsistencyEvidence(input)
  const policy = applyConsistencyPolicy({ evidence })

  if (policy.kind === "reject") {
    return {
      kind: "reject",
      reason: policy.reason,
      detail: policy.detail,
      posterior: policy.posterior,
      evidenceMass: policy.evidenceMass,
    }
  }

  const signalFindings = buildFindingsFromAtoms(evidence.atoms, input, evidence)

  return {
    kind: "accept",
    evaluation: {
      severity: round(policy.severity),
      confidence: round(policy.confidence),
      declaredOffsetPx: input.subjectDeclaredOffsetDeviation.value === null ? null : round(input.subjectDeclaredOffsetDeviation.value),
      estimatedOffsetPx: input.subjectEffectiveOffsetDeviation.value === null ? null : round(input.subjectEffectiveOffsetDeviation.value),
      contextKind: input.context.kind,
      contextCertainty: input.context.certainty,
      posterior: {
        lower: round(policy.posterior.lower),
        upper: round(policy.posterior.upper),
      },
      evidenceMass: round(policy.evidenceMass),
      topFactors: policy.topFactors,
      signalFindings,
    },
  }
}

function buildFindingsFromAtoms(atoms: readonly EvidenceAtom[], input: AlignmentCase, evidence: ConsistencyEvidence): readonly AlignmentSignalFinding[] {
  const byKind = new Map<AlignmentFindingKind, AlignmentSignalFinding>()

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (!atom) continue
    const factor = toFindingFactor(atom.factorId, input, evidence)
    if (factor === null) continue

    const meanContribution = (atom.contribution.min + atom.contribution.max) / 2
    if (meanContribution <= 0) continue

    const weight = clamp(Math.abs(meanContribution), 0, 1)
    const next: AlignmentSignalFinding = {
      kind: factor.kind,
      message: factor.message,
      fix: factor.fix,
      weight,
    }

    const existing = byKind.get(factor.kind)
    if (!existing) {
      byKind.set(factor.kind, next)
      continue
    }

    if (next.weight > existing.weight) {
      byKind.set(factor.kind, next)
    }
  }

  return [...byKind.values()]
}

function toFindingFactor(
  factorId: AlignmentFactorId,
  input: AlignmentCase,
  _evidence: ConsistencyEvidence,
): {
  readonly kind: AlignmentFindingKind
  readonly message: string
  readonly fix: string
} | null {
  switch (factorId) {
    case "offset-delta":
      return {
        kind: "offset-delta",
        message: "block-axis offset differs from siblings",
        fix: "normalize margin/padding to match sibling cohort",
      }
    case "declared-offset-delta":
      return {
        kind: "declared-offset-delta",
        message: "declared block-axis offset differs from siblings",
        fix: "remove or unify the offset",
      }
    case "baseline-conflict":
      return {
        kind: "baseline-conflict",
        message: "baseline/line-height mismatch between siblings",
        fix: "unify line-height or add vertical-align",
      }
    case "context-conflict":
      return {
        kind: "context-conflict",
        message: "container and child alignment conflict",
        fix: "check align-items on the parent",
      }
    case "replaced-control-risk":
      return {
        kind: "replaced-control-risk",
        message: "replaced element baseline differs from text siblings",
        fix: "add vertical-align: middle to the replaced element",
      }
    case "content-composition-conflict":
      return {
        kind: "content-composition-conflict",
        message: "content composition differs from siblings",
        fix: formatCompositionFixSuggestion(input.subjectContentComposition),
      }
    default:
      return null
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}


