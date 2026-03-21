import { parseUnitlessValue } from "../../css/parser/value-util"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import type { LayoutCascadedDeclaration } from "./graph"
import { extractTransformYPx, extractTranslatePropertyYPx, parseSignedPxValue } from "./offset-baseline"
import { CONTROL_ELEMENT_TAGS } from "./util"
import type { LayoutRuleGuard } from "./guard-model"
import {
  LayoutSignalGuard,
  LayoutSignalUnit,
  SignalQuality,
  SignalValueKind,
  type LayoutKnownSignalValue,
  type LayoutSignalName,
  type LayoutSignalSource,
  type LayoutSignalValue,
  type LayoutUnknownSignalValue,
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
  "padding-inline",
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
  "max-width",
  "max-height",
  "flex-basis",
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

const REPLACED_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  ...CONTROL_ELEMENT_TAGS, "img", "video", "canvas", "svg", "iframe",
])

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
  return CONTROL_ELEMENT_TAGS.has(tag)
}

export function isReplacedTag(tag: string | null): boolean {
  if (tag === null) return false
  return REPLACED_ELEMENT_TAGS.has(tag)
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
      fontSizeEntry.guardProvenance, null,
    )
    out.set("font-size", parsedFontSize)
    if (parsedFontSize.kind === SignalValueKind.Known && parsedFontSize.guard.kind === LayoutSignalGuard.Unconditional) {
      fontSizePx = parsedFontSize.px
    }
  }

  for (const [property, declaration] of values) {
    if (property === "font-size") continue

    const name = toMonitoredSignalName(property)
    if (!name) continue

    const normalized = normalizeSignal(
      name,
      declaration.value,
      declaration.source,
      declaration.guardProvenance,
      fontSizePx,
    )
    out.set(name, normalized)
  }

  let knownSignalCount = 0
  let unknownSignalCount = 0
  let conditionalSignalCount = 0

  for (const value of out.values()) {
    if (value.guard.kind === LayoutSignalGuard.Conditional) {
      conditionalSignalCount++
      continue
    }

    if (value.kind === SignalValueKind.Known) {
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

function toMonitoredSignalName(property: string): LayoutSignalName | null {
  return MONITORED_SIGNAL_NAME_MAP.get(property) ?? null
}

function normalizeSignal(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
  fontSizePx: number | null,
): LayoutSignalValue {
  switch (name) {
    case "line-height":
      return parseLineHeight(name, raw, source, guard, fontSizePx)
    case "aspect-ratio":
      return parseAspectRatio(name, raw, source, guard)
    case "contain-intrinsic-size":
      return parseContainIntrinsicSize(name, raw, source, guard)
    case "transform":
      return parseTransform(name, raw, source, guard)
    case "translate":
      return parseTranslateProperty(name, raw, source, guard)
    default:
      break
  }
  if (LENGTH_SIGNAL_SET.has(name)) return parseLength(name, raw, source, guard)
  if (KEYWORD_SIGNAL_SET.has(name)) return parseKeyword(name, raw, source, guard)
  return createUnknown(name, source, guard, "unsupported signal")
}

function parseAspectRatio(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, source, guard, "aspect-ratio value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, source, guard, "aspect-ratio uses runtime-dependent function")
  }

  if (trimmed === "auto") {
    return createUnknown(name, source, guard, "aspect-ratio auto does not reserve ratio")
  }

  const slash = trimmed.indexOf("/")
  if (slash !== -1) {
    const left = Number(trimmed.slice(0, slash).trim())
    const right = Number(trimmed.slice(slash + 1).trim())
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
      return createUnknown(name, source, guard, "aspect-ratio ratio is invalid")
    }
    return createKnown(name, trimmed, source, guard, null, LayoutSignalUnit.Unitless, SignalQuality.Exact)
  }

  const ratio = Number(trimmed)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return createUnknown(name, source, guard, "aspect-ratio is not statically parseable")
  }
  return createKnown(name, trimmed, source, guard, null, LayoutSignalUnit.Unitless, SignalQuality.Exact)
}

function parseContainIntrinsicSize(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, source, guard, "contain-intrinsic-size value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, source, guard, "contain-intrinsic-size uses runtime-dependent function")
  }

  if (trimmed === "none" || trimmed === "auto") {
    return createUnknown(name, source, guard, "contain-intrinsic-size does not reserve space")
  }

  const parts = splitWhitespaceTokens(trimmed)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const px = parseSignedPxValue(part)
    if (px !== null) return createKnown(name, trimmed, source, guard, px, LayoutSignalUnit.Px, SignalQuality.Exact)
  }

  return createUnknown(name, source, guard, "contain-intrinsic-size is not statically parseable in px")
}

function parseLineHeight(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
  fontSizePx: number | null,
): LayoutSignalValue {
  const normalized = raw.trim().toLowerCase()
  const unitless = parseUnitlessValue(raw)
  if (unitless !== null) {
    const base = fontSizePx === null ? 16 : fontSizePx
    return createKnown(name, normalized, source, guard, unitless * base, LayoutSignalUnit.Unitless, SignalQuality.Estimated)
  }

  const px = parseSignedPxValue(raw)
  if (px !== null) return createKnown(name, normalized, source, guard, px, LayoutSignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "line-height is not statically parseable")
}

const DIMENSION_KEYWORD_SET: ReadonlySet<string> = new Set([
  "auto", "none", "fit-content", "min-content", "max-content", "stretch",
  "inherit", "initial", "unset", "revert", "revert-layer",
])

function parseLength(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const px = parseSignedPxValue(raw)
  const normalized = raw.trim().toLowerCase()
  if (px !== null) {
    return createKnown(name, normalized, source, guard, px, LayoutSignalUnit.Px, SignalQuality.Exact)
  }
  if (DIMENSION_KEYWORD_SET.has(normalized) || normalized.startsWith("fit-content(")) {
    return createKnown(name, normalized, source, guard, null, LayoutSignalUnit.Keyword, SignalQuality.Exact)
  }
  return createUnknown(name, source, guard, "length is not statically parseable in px")
}

function parseKeyword(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) {
    return createUnknown(name, source, guard, "keyword value is empty")
  }

  if (hasDynamicExpression(normalized)) {
    return createUnknown(name, source, guard, "keyword uses runtime-dependent function")
  }

  return createKnown(name, normalized, source, guard, null, LayoutSignalUnit.Keyword, SignalQuality.Exact)
}

function parseTransform(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) {
    return createUnknown(name, source, guard, "transform value is empty")
  }

  if (hasDynamicExpression(normalized)) {
    return createUnknown(name, source, guard, "transform uses runtime-dependent function")
  }

  const y = extractTransformYPx(normalized)
  if (y !== null) return createKnown(name, normalized, source, guard, y, LayoutSignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "transform has non-translational or non-px functions")
}

function parseTranslateProperty(
  name: LayoutSignalName,
  raw: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
): LayoutSignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return createUnknown(name, source, guard, "translate value is empty")
  }

  if (hasDynamicExpression(trimmed)) {
    return createUnknown(name, source, guard, "translate uses runtime-dependent function")
  }

  const y = extractTranslatePropertyYPx(trimmed)
  if (y !== null) return createKnown(name, trimmed, source, guard, y, LayoutSignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "translate property vertical component is not px")
}

function hasDynamicExpression(raw: string): boolean {
  // var() references should have been substituted by the cascade builder's
  // resolveVarReferencesInCascade step. Any remaining var() is unresolvable.
  if (raw.includes("var(")) return true
  if (raw.includes("env(")) return true
  if (raw.includes("attr(")) return true
  // calc(), min(), max(), clamp() are NOT considered dynamic — parsePxValue
  // evaluates constant expressions and returns null for truly dynamic ones.
  return false
}

function createKnown(
  name: LayoutSignalName,
  normalized: string,
  source: LayoutSignalSource,
  guard: LayoutRuleGuard,
  px: number | null,
  unit: LayoutSignalUnit,
  quality: SignalQuality,
): LayoutKnownSignalValue {
  return {
    kind: SignalValueKind.Known,
    name,
    normalized,
    source,
    guard,
    unit,
    px,
    quality,
  }
}

function createUnknown(
  name: LayoutSignalName,
  source: LayoutSignalSource | null,
  guard: LayoutRuleGuard,
  reason: string,
): LayoutUnknownSignalValue {
  return {
    kind: SignalValueKind.Unknown,
    name,
    source,
    guard,
    reason,
  }
}
