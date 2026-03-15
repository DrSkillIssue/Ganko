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

export function selectKth(values: number[], targetIndex: number): number {
  let left = 0
  let right = values.length - 1

  while (left <= right) {
    if (left === right) {
      const result = values[left]
      if (result === undefined) return 0
      return result
    }

    const pivotIndex = choosePivotIndex(values, left, right)
    const partitionIndex = partitionAroundPivot(values, left, right, pivotIndex)

    if (partitionIndex === targetIndex) {
      const result = values[partitionIndex]
      if (result === undefined) return 0
      return result
    }
    if (partitionIndex < targetIndex) {
      left = partitionIndex + 1
      continue
    }
    right = partitionIndex - 1
  }

  const fallback = values[targetIndex]
  if (fallback === undefined) return 0
  return fallback
}

function choosePivotIndex(values: number[], left: number, right: number): number {
  const middle = Math.floor((left + right) / 2)
  const leftValue = values[left] ?? 0
  const middleValue = values[middle] ?? 0
  const rightValue = values[right] ?? 0

  if (leftValue < middleValue) {
    if (middleValue < rightValue) return middle
    if (leftValue < rightValue) return right
    return left
  }

  if (leftValue < rightValue) return left
  if (middleValue < rightValue) return right
  return middle
}

function partitionAroundPivot(values: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = values[pivotIndex] ?? 0
  swap(values, pivotIndex, right)

  let storeIndex = left
  for (let i = left; i < right; i++) {
    const current = values[i]
    if (current === undefined || current > pivotValue) continue
    swap(values, storeIndex, i)
    storeIndex++
  }

  swap(values, storeIndex, right)
  return storeIndex
}

function swap(values: number[], left: number, right: number): void {
  if (left === right) return
  const leftValue = values[left] ?? 0
  const rightValue = values[right] ?? 0
  values[left] = rightValue
  values[right] = leftValue
}

export function toComparableExactValue(value: NumericEvidenceValue): number | null {
  if (value.value !== null) {
    if (value.kind !== EvidenceValueKind.Exact) return null
    return value.value
  }
  if (value.kind === EvidenceValueKind.Exact) return 0
  return null
}
