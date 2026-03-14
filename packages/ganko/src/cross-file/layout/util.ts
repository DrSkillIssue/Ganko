import { EvidenceValueKind, type NumericEvidenceValue } from "./signal-model"

/**
 * Form control elements that behave as replaced elements for baseline
 * and layout sizing purposes.
 */
export const CONTROL_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  "input", "select", "textarea", "button",
])

export const INTRINSIC_REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img", "svg", "video", "canvas", "iframe", "object", "embed",
])

export const WHITESPACE_RE = /\s+/

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function mergeEvidenceKind(left: EvidenceValueKind, right: EvidenceValueKind): EvidenceValueKind {
  return left > right ? left : right
}

export function toComparableExactValue(value: NumericEvidenceValue): number | null {
  if (value.value !== null) {
    if (value.kind !== EvidenceValueKind.Exact) return null
    return value.value
  }
  if (value.kind === EvidenceValueKind.Exact) return 0
  return null
}
