import type { LayoutAxisModel } from "./context-model"
import type {
  EvidenceValueKind,
  HotNumericSignalEvidence,
  LayoutSignalSnapshot,
  LayoutSnapshotHotSignals,
  NumericEvidenceValue,
} from "./signal-model"
import { readNormalizedSignalEvidence, readNumericSignalEvidence } from "./signal-access"
import { mergeEvidenceKind as mergeKind } from "./util"

export interface LayoutBlockOffsetEstimate {
  readonly declared: NumericEvidenceValue
  readonly effective: NumericEvidenceValue
}

export interface LayoutBlockOffsetDelta {
  readonly declared: number | null
  readonly effective: number | null
}

export function estimateBlockOffset(snapshot: LayoutSignalSnapshot, axis: LayoutAxisModel): number | null {
  return estimateBlockOffsetWithDeclared(snapshot, axis).effective.value
}

export function estimateBlockOffsetWithDeclared(
  snapshot: LayoutSignalSnapshot,
  axis: LayoutAxisModel,
): LayoutBlockOffsetEstimate {
  const position = readNormalizedSignalEvidence(snapshot, "position")
  return estimateBlockOffsetWithDeclaredFromSources(axis, position, (name) => ({
    present: snapshot.signals.has(name),
    ...readNumericSignalEvidence(snapshot, name),
  }))
}

export function estimateBlockOffsetWithDeclaredFromHotSignals(
  hot: LayoutSnapshotHotSignals,
  axis: LayoutAxisModel,
): LayoutBlockOffsetEstimate {
  return estimateBlockOffsetWithDeclaredFromSources(axis, hot.position, (name) => {
    switch (name) {
      case "inset-block-start":
        return hot.insetBlockStart
      case "inset-block-end":
        return hot.insetBlockEnd
      case "transform":
        return hot.transform
      case "translate":
        return hot.translate
      case "top":
        return hot.top
      case "bottom":
        return hot.bottom
      case "margin-top":
        return hot.marginTop
      default:
        return hot.marginBottom
    }
  })
}

function estimateBlockOffsetWithDeclaredFromSources(
  axis: LayoutAxisModel,
  position: {
    readonly value: string | null
    readonly kind: EvidenceValueKind
  },
  readNumeric: (name:
    | "inset-block-start"
    | "inset-block-end"
    | "transform"
    | "translate"
    | "top"
    | "bottom"
    | "margin-top"
    | "margin-bottom") => HotNumericSignalEvidence,
): LayoutBlockOffsetEstimate {
  let declaredTotal = 0
  let declaredCount = 0
  let declaredKind: EvidenceValueKind = "exact"
  let declaredMissingKind: EvidenceValueKind = "exact"

  let effectiveTotal = 0
  let effectiveCount = 0
  let effectiveKind: EvidenceValueKind = "exact"
  let effectiveMissingKind: EvidenceValueKind = "exact"
  const positioned = position.value !== null && position.value !== "static"

  const add = (
    name:
      | "inset-block-start"
      | "inset-block-end"
      | "transform"
      | "translate"
      | "top"
      | "bottom"
      | "margin-top"
      | "margin-bottom",
    sign: number,
    requiresPositioning: boolean,
  ): void => {
    const v = readNumeric(name)
    if (!v.present) return

    if (v.value === null) {
      declaredMissingKind = mergeKind(declaredMissingKind, v.kind)

      if (requiresPositioning) {
        effectiveMissingKind = mergeKind(effectiveMissingKind, mergeKind(v.kind, position.kind))
      }
      if (!requiresPositioning) {
        effectiveMissingKind = mergeKind(effectiveMissingKind, v.kind)
      }

      return
    }

    const signed = v.value * sign
    declaredTotal += signed
    declaredCount++
    declaredKind = mergeKind(declaredKind, v.kind)

    const effectiveContributionKind = requiresPositioning ? mergeKind(v.kind, position.kind) : v.kind
    if (requiresPositioning && !positioned) {
      effectiveMissingKind = mergeKind(effectiveMissingKind, effectiveContributionKind)
      return
    }

    effectiveTotal += signed
    effectiveCount++
    effectiveKind = mergeKind(effectiveKind, effectiveContributionKind)
  }

  add("inset-block-start", 1, true)
  add("inset-block-end", -1, true)

  if (axis === "horizontal-tb") {
    add("transform", 1, false)
    add("translate", 1, false)
    add("top", 1, true)
    add("bottom", -1, true)
    add("margin-top", 1, false)
    add("margin-bottom", -1, false)
  }

  return {
    declared: {
      value: declaredCount === 0 ? null : declaredTotal,
      kind: declaredCount === 0 ? declaredMissingKind : declaredKind,
    },
    effective: {
      value: effectiveCount === 0 ? null : effectiveTotal,
      kind: effectiveCount === 0 ? effectiveMissingKind : effectiveKind,
    },
  }
}

export function computeBlockOffsetDelta(
  subject: LayoutSignalSnapshot,
  reference: LayoutSignalSnapshot,
  axis: LayoutAxisModel,
): number | null {
  return computeBlockOffsetDeltaWithDeclared(subject, reference, axis).effective
}

export function computeBlockOffsetDeltaWithDeclared(
  subject: LayoutSignalSnapshot,
  reference: LayoutSignalSnapshot,
  axis: LayoutAxisModel,
): LayoutBlockOffsetDelta {
  const subjectOffset = estimateBlockOffsetWithDeclared(subject, axis)
  const referenceOffset = estimateBlockOffsetWithDeclared(reference, axis)

  return {
    declared: computeDelta(subjectOffset.declared.value, referenceOffset.declared.value),
    effective: computeDelta(subjectOffset.effective.value, referenceOffset.effective.value),
  }
}

function computeDelta(subject: number | null, reference: number | null): number | null {
  if (subject === null && reference === null) return null
  if (subject === null) {
    if (reference === null) return null
    return Math.abs(reference)
  }
  if (reference === null) return Math.abs(subject)
  return Math.abs(subject - reference)
}


