import { parseUnitlessValue } from "../../css/parser/value-util"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import type { LayoutCascadedDeclaration } from "./graph"
import { extractTransformYPx, extractTranslatePropertyYPx, parseSignedPxValue } from "./offset-baseline"
import { expandShorthand, getShorthandLonghandNames } from "./shorthand-expansion"
import { CONTROL_ELEMENT_TAGS } from "./util"
import type {
  LayoutGuardProvenance,
  LayoutSignalGuard,
  LayoutKnownSignalValue,
  LayoutSignalName,
  LayoutSignalSource,
  LayoutSignalUnit,
  LayoutSignalValue,
  LayoutUnknownSignalValue,
} from "./signal-model"
import { layoutSignalNames } from "./signal-model"

const MONITORED_SIGNAL_SET = new Set<string>(layoutSignalNames)
export const MONITORED_SIGNAL_NAME_MAP = new Map<string, LayoutSignalName>(
  layoutSignalNames.map((name) => [name, name]),
)
const MONITORED_SHORTHAND_SET = new Set<string>([
  "padding",
  "border-width",
  "margin-block",
  "padding-block",
  "inset-block",
  "flex-flow",
])

const LENGTH_SIGNAL_SET = new Set<LayoutSignalName>([
  "font-size",
  "width",
  "inline-size",
  "height",
  "block-size",
  "min-width",
  "min-block-size",
  "min-height",
  "top",
  "bottom",
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-left",
  "padding-right",
  "padding-bottom",
  "border-top-width",
  "border-left-width",
  "border-right-width",
  "border-bottom-width",
  "inset-block-start",
  "inset-block-end",
])

const KEYWORD_SIGNAL_SET = new Set<LayoutSignalName>([
  "vertical-align",
  "display",
  "white-space",
  "object-fit",
  "overflow",
  "overflow-y",
  "overflow-anchor",
  "scrollbar-gutter",
  "scrollbar-width",
  "content-visibility",
  "align-items",
  "align-self",
  "justify-items",
  "place-items",
  "place-self",
  "flex-direction",
  "grid-auto-flow",
  "appearance",
  "box-sizing",
  "position",
  "writing-mode",
  "direction",
])

const REPLACED_TAGS = new Set(["input", "select", "textarea", "button", "img", "video", "canvas", "svg", "iframe"])

export interface NormalizedSignalMap {
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}

export function getMonitoredSignalNames(): readonly LayoutSignalName[] {
  return layoutSignalNames
}

export function isMonitoredSignal(property: string): boolean {
  if (MONITORED_SIGNAL_SET.has(property)) return true
  return MONITORED_SHORTHAND_SET.has(property)
}

export function isControlTag(tag: string | null): boolean {
  if (tag === null) return false
  return CONTROL_ELEMENT_TAGS.has(tag.toLowerCase())
}

export function isReplacedTag(tag: string | null): boolean {
  if (tag === null) return false
  return REPLACED_TAGS.has(tag.toLowerCase())
}

export function normalizeSignalMap(
  values: ReadonlyMap<string, LayoutCascadedDeclaration>,
): ReadonlyMap<LayoutSignalName, LayoutSignalValue> {
  return normalizeSignalMapWithCounts(values).signals
}

export function normalizeSignalMapWithCounts(
  values: ReadonlyMap<string, LayoutCascadedDeclaration>,
): NormalizedSignalMap {
  const out = new Map<LayoutSignalName, LayoutSignalValue>()

  const fontSizeEntry = values.get("font-size")
  let fontSizePx: number | null = null

  if (fontSizeEntry) {
    const parsedFontSize = normalizeSignal(
      "font-size",
      fontSizeEntry.value,
      fontSizeEntry.source,
      fontSizeEntry.guard,
      fontSizeEntry.guardProvenance,
      null,
    )
    out.set("font-size", parsedFontSize)
    if (parsedFontSize.kind === "known" && parsedFontSize.guard === "unconditional") {
      fontSizePx = parsedFontSize.px
    }
  }

  for (const [property, declaration] of values) {
    if (property === "font-size") continue

    if (MONITORED_SHORTHAND_SET.has(property)) {
      applyExpandedShorthand(out, property, declaration, fontSizePx)
      continue
    }

    const name = toMonitoredSignalName(property)
    if (!name) continue

    const normalized = normalizeSignal(
      name,
      declaration.value,
      declaration.source,
      declaration.guard,
      declaration.guardProvenance,
      fontSizePx,
    )
    out.set(name, normalized)
  }

  let knownSignalCount = 0
  let unknownSignalCount = 0
  let conditionalSignalCount = 0

  for (const value of out.values()) {
    if (value.guard === "conditional") {
      conditionalSignalCount++
      continue
    }

    if (value.kind === "known") {
      knownSignalCount++
      continue
    }
    unknownSignalCount++
  }

  return {
    signals: out,
    knownSignalCount,
    unknownSignalCount,
    conditionalSignalCount,
  }
}

function applyExpandedShorthand(
  out: Map<LayoutSignalName, LayoutSignalValue>,
  property: string,
  declaration: LayoutCascadedDeclaration,
  fontSizePx: number | null,
): void {
  const expanded = expandShorthand(property, declaration.value)
  if (expanded === null) {
    const reason = `${property} value is not statically parseable`
    const longhandNames = getShorthandLonghandNames(property)
    if (longhandNames === null) return
    for (let i = 0; i < longhandNames.length; i++) {
      const longhand = longhandNames[i]
      if (!longhand) continue
      const name = MONITORED_SIGNAL_NAME_MAP.get(longhand)
      if (name === undefined) continue
      out.set(name, createUnknown(name, declaration.value, declaration.source, declaration.guard, declaration.guardProvenance, reason))
    }
    return
  }

  if (expanded === undefined) return

  for (let i = 0; i < expanded.length; i++) {
    const entry = expanded[i]
    if (!entry) continue
    const name = MONITORED_SIGNAL_NAME_MAP.get(entry.name)
    if (name === undefined) continue
    out.set(name, normalizeSignal(name, entry.value, declaration.source, declaration.guard, declaration.guardProvenance, fontSizePx))
  }
}

function toMonitoredSignalName(property: string): LayoutSignalName | null {
  return MONITORED_SIGNAL_NAME_MAP.get(property) ?? null
}

function normalizeSignal(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
  fontSizePx: number | null,
): LayoutSignalValue {
  switch (name) {
    case "line-height":
      return parseLineHeight(name, raw, source, guard, guardProvenance, fontSizePx)
    case "aspect-ratio":
      return parseAspectRatio(name, raw, source, guard, guardProvenance)
    case "contain-intrinsic-size":
      return parseContainIntrinsicSize(name, raw, source, guard, guardProvenance)
    case "transform":
      return parseTransform(name, raw, source, guard, guardProvenance)
    case "translate":
      return parseTranslateProperty(name, raw, source, guard, guardProvenance)
    default:
      break
  }
  if (LENGTH_SIGNAL_SET.has(name)) return parseLength(name, raw, source, guard, guardProvenance)
  if (KEYWORD_SIGNAL_SET.has(name)) return parseKeyword(name, raw, source, guard, guardProvenance)
  return createUnknown(name, raw, source, guard, guardProvenance, "unsupported signal")
}

function parseAspectRatio(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "aspect-ratio value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, raw, source, guard, guardProvenance, "aspect-ratio uses runtime-dependent function")
  }

  if (trimmed === "auto") {
    return createUnknown(name, raw, source, guard, guardProvenance, "aspect-ratio auto does not reserve ratio")
  }

  const slash = trimmed.indexOf("/")
  if (slash !== -1) {
    const left = Number(trimmed.slice(0, slash).trim())
    const right = Number(trimmed.slice(slash + 1).trim())
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
      return createUnknown(name, raw, source, guard, guardProvenance, "aspect-ratio ratio is invalid")
    }
    return createKnown(name, raw, source, guard, guardProvenance, null, "unitless", "exact")
  }

  const ratio = Number(trimmed)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "aspect-ratio is not statically parseable")
  }
  return createKnown(name, raw, source, guard, guardProvenance, null, "unitless", "exact")
}

function parseContainIntrinsicSize(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "contain-intrinsic-size value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, raw, source, guard, guardProvenance, "contain-intrinsic-size uses runtime-dependent function")
  }

  if (trimmed === "none" || trimmed === "auto") {
    return createUnknown(name, raw, source, guard, guardProvenance, "contain-intrinsic-size does not reserve space")
  }

  const parts = splitWhitespaceTokens(trimmed)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const px = parseSignedPxValue(part)
    if (px !== null) return createKnown(name, raw, source, guard, guardProvenance, px, "px", "exact")
  }

  return createUnknown(name, raw, source, guard, guardProvenance, "contain-intrinsic-size is not statically parseable in px")
}

function parseLineHeight(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
  fontSizePx: number | null,
): LayoutSignalValue {
  const unitless = parseUnitlessValue(raw)
  if (unitless !== null) {
    const base = fontSizePx === null ? 16 : fontSizePx
    return createKnown(name, raw, source, guard, guardProvenance, unitless * base, "unitless", "estimated")
  }

  const px = parseSignedPxValue(raw)
  if (px !== null) return createKnown(name, raw, source, guard, guardProvenance, px, "px", "exact")
  return createUnknown(name, raw, source, guard, guardProvenance, "line-height is not statically parseable")
}

function parseLength(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const px = parseSignedPxValue(raw)
  if (px === null) {
    return createUnknown(name, raw, source, guard, guardProvenance, "length is not statically parseable in px")
  }
  return createKnown(name, raw, source, guard, guardProvenance, px, "px", "exact")
}

function parseKeyword(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "keyword value is empty")
  }

  if (hasDynamicExpression(normalized)) {
    return createUnknown(name, raw, source, guard, guardProvenance, "keyword uses runtime-dependent function")
  }

  return createKnown(name, raw, source, guard, guardProvenance, null, "keyword", "exact")
}

function parseTransform(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "transform value is empty")
  }

  if (hasDynamicExpression(normalized)) {
    return createUnknown(name, raw, source, guard, guardProvenance, "transform uses runtime-dependent function")
  }

  const y = extractTransformYPx(normalized)
  if (y !== null) return createKnown(name, raw, source, guard, guardProvenance, y, "px", "exact")
  return createUnknown(name, raw, source, guard, guardProvenance, "transform has non-translational or non-px functions")
}

function parseTranslateProperty(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, raw, source, guard, guardProvenance, "translate value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, raw, source, guard, guardProvenance, "translate uses runtime-dependent function")
  }

  const y = extractTranslatePropertyYPx(trimmed)
  if (y !== null) return createKnown(name, raw, source, guard, guardProvenance, y, "px", "exact")
  return createUnknown(name, raw, source, guard, guardProvenance, "translate property vertical component is not px")
}

function hasDynamicExpression(raw: string): boolean {
  if (raw.includes("var(")) return true
  if (raw.includes("calc(")) return true
  if (raw.includes("env(")) return true
  if (raw.includes("attr(")) return true
  if (raw.includes("min(")) return true
  if (raw.includes("max(")) return true
  if (raw.includes("clamp(")) return true
  return false
}

function createKnown(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
  px: number | null,
  unit: LayoutSignalUnit,
  quality: "exact" | "estimated",
): LayoutKnownSignalValue {
  return {
    kind: "known",
    name,
    raw,
    normalized: raw.trim().toLowerCase(),
    source,
    guard,
    guardProvenance,
    unit,
    px,
    quality,
  }
}

function createUnknown(
  name: LayoutSignalName,
  raw: string | null,
  source: LayoutSignalSource | null,
  guard: LayoutSignalGuard,
  guardProvenance: LayoutGuardProvenance,
  reason: string,
): LayoutUnknownSignalValue {
  return {
    kind: "unknown",
    name,
    raw,
    source,
    guard,
    guardProvenance,
    reason,
  }
}
