import { parsePxValue } from "../../css/parser/value-util"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import type { LayoutSignalName } from "./signal-model"

export const layoutOffsetSignals = [
  "top",
  "bottom",
  "margin-top",
  "margin-bottom",
  "inset-block-start",
  "inset-block-end",
  "transform",
  "translate",
] as const satisfies readonly LayoutSignalName[]

export type LayoutOffsetSignal = (typeof layoutOffsetSignals)[number]

const TRANSLATE_Y_RE = /translatey\(\s*([^)]+)\s*\)/i
const TRANSLATE_RE = /translate\(\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/i
const TRANSLATE_3D_RE = /translate3d\(\s*[^,]+,\s*([^,]+),\s*[^)]+\)/i

export function parseOffsetPx(property: LayoutOffsetSignal, raw: string): number | null {
  if (property === "transform") return extractTransformYPx(raw)
  if (property === "translate") return extractTranslatePropertyYPx(raw)
  return parseSignedPxValue(raw)
}

export function isEquivalentOffset(value: number | null, expectedPx: number, tolerancePx = 0.25): boolean {
  if (value === null) return false
  return Math.abs(value - expectedPx) <= tolerancePx
}

/**
 * Extracts the Y-axis px value from a `transform` property value.
 * Returns `null` if the value has no translational Y component or is not in px.
 */
export function extractTransformYPx(raw: string): number | null {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) return null

  const translate3d = TRANSLATE_3D_RE.exec(normalized)
  if (translate3d) {
    const yVal = translate3d[1];
    if (!yVal) return null;
    return parseSignedPxValue(yVal);
  }

  const translateY = TRANSLATE_Y_RE.exec(normalized)
  if (translateY) {
    const yVal = translateY[1];
    if (!yVal) return null;
    return parseSignedPxValue(yVal);
  }

  const translate = TRANSLATE_RE.exec(normalized)
  if (!translate) return null

  const yRaw = translate[2] ?? "0px"
  return parseSignedPxValue(yRaw)
}

/**
 * Extracts the Y-axis px value from a `translate` CSS property value.
 * The `translate` property uses whitespace-separated axes: `<x> <y> <z>`.
 * Returns `null` if the Y component is not in px.
 */
export function extractTranslatePropertyYPx(raw: string): number | null {
  const parts = splitWhitespaceTokens(raw.trim().toLowerCase())
  const yRaw = parts.length >= 2 ? (parts[1] ?? "0px") : "0px"
  return parseSignedPxValue(yRaw)
}

export function parseSignedPxValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (trimmed.startsWith("-")) {
    const px = parsePxValue(trimmed.slice(1))
    if (px === null) return null
    return -px
  }

  if (trimmed.startsWith("+")) {
    return parsePxValue(trimmed.slice(1))
  }

  return parsePxValue(trimmed)
}
