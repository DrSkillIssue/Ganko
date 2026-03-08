import type { EvidenceValueKind, NumericEvidenceValue } from "./signal-model"

/**
 * Form control elements that behave as replaced elements for baseline
 * and layout sizing purposes.
 */
export const CONTROL_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  "input", "select", "textarea", "button",
])

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function kindRank(kind: EvidenceValueKind): number {
  if (kind === "exact") return 0
  if (kind === "interval") return 1
  if (kind === "conditional") return 2
  return 3
}

export function mergeEvidenceKind(left: EvidenceValueKind, right: EvidenceValueKind): EvidenceValueKind {
  if (kindRank(left) >= kindRank(right)) return left
  return right
}

export function toComparableExactValue(value: NumericEvidenceValue): number | null {
  if (value.value !== null) {
    if (value.kind !== "exact") return null
    return value.value
  }
  if (value.kind === "exact") return 0
  return null
}
