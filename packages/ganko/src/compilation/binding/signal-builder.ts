/**
 * Signal snapshot types + construction.
 *
 * Moved from cross-file/layout/signal-normalization.ts + signal-collection.ts.
 */
import type { SignalSource, RuleGuard, ElementCascade, CascadedDeclaration } from "./cascade-binder"
import { parseUnitlessValue, parsePxValue } from "../../css/parser/value-util"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"

export { type SignalSource, type RuleGuard } from "./cascade-binder"

export const layoutSignalNames = [
  "line-height", "font-size", "width", "inline-size", "height", "block-size",
  "min-width", "min-block-size", "min-height", "max-width", "max-height",
  "aspect-ratio", "vertical-align", "display", "white-space", "object-fit",
  "overflow", "overflow-y", "overflow-anchor", "scrollbar-gutter", "scrollbar-width",
  "contain-intrinsic-size", "content-visibility", "align-items", "align-self",
  "justify-items", "place-items", "place-self", "flex-direction", "flex-basis",
  "grid-auto-flow", "appearance", "box-sizing", "padding-top", "padding-left",
  "padding-right", "padding-bottom", "border-top-width", "border-left-width",
  "border-right-width", "border-bottom-width", "position", "top", "bottom",
  "margin-top", "margin-bottom", "transform", "translate", "inset-block-start",
  "inset-block-end", "writing-mode", "direction", "contain",
] as const

export type LayoutSignalName = (typeof layoutSignalNames)[number]

export const enum SignalValueKind { Known = 0, Unknown = 1 }
export const enum SignalUnit { Px = 0, Unitless = 1, Keyword = 2, Unknown = 3 }
export const enum SignalQuality { Exact = 0, Estimated = 1 }

export interface KnownSignalValue {
  readonly kind: SignalValueKind.Known
  readonly name: LayoutSignalName
  readonly normalized: string
  readonly source: SignalSource
  readonly guard: RuleGuard
  readonly unit: SignalUnit
  readonly px: number | null
  readonly quality: SignalQuality
}

export interface UnknownSignalValue {
  readonly kind: SignalValueKind.Unknown
  readonly name: LayoutSignalName
  readonly source: SignalSource | null
  readonly guard: RuleGuard
  readonly reason: string
}

export type SignalValue = KnownSignalValue | UnknownSignalValue

export interface SignalSnapshot {
  readonly elementId: number
  readonly signals: ReadonlyMap<LayoutSignalName, SignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}


// ── Offset baseline parsing ──────────────────────────────────────────────

// layoutOffsetSignals and parseOffsetPx moved to analysis/alignment.ts per plan

const TRANSLATE_Y_RE = /translatey\(\s*([^)]+)\s*\)/i
const TRANSLATE_RE = /translate\(\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/i
const TRANSLATE_3D_RE = /translate3d\(\s*[^,]+,\s*([^,]+),\s*[^)]+\)/i

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

export function extractTransformYPx(raw: string): number | null {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) return null

  const translate3d = TRANSLATE_3D_RE.exec(normalized)
  if (translate3d) {
    const yVal = translate3d[1]
    if (!yVal) return null
    return parseSignedPxValue(yVal)
  }

  const translateY = TRANSLATE_Y_RE.exec(normalized)
  if (translateY) {
    const yVal = translateY[1]
    if (!yVal) return null
    return parseSignedPxValue(yVal)
  }

  const translate = TRANSLATE_RE.exec(normalized)
  if (!translate) return null

  const yRaw = translate[2] ?? "0px"
  return parseSignedPxValue(yRaw)
}

export function extractTranslatePropertyYPx(raw: string): number | null {
  const parts = splitWhitespaceTokens(raw.trim().toLowerCase())
  const yRaw = parts.length >= 2 ? (parts[1] ?? "0px") : "0px"
  return parseSignedPxValue(yRaw)
}



// ── Textual content state ────────────────────────────────────────────────

export const enum TextualContentState { Yes = 0, No = 1, Unknown = 2, DynamicText = 3 }

// ── Control/replaced element tags ────────────────────────────────────────

const CONTROL_ELEMENT_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea", "button"])
const REPLACED_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  ...CONTROL_ELEMENT_TAGS, "img", "video", "canvas", "svg", "iframe",
])

export function isControlTag(tag: string | null): boolean {
  if (tag === null) return false
  return CONTROL_ELEMENT_TAGS.has(tag)
}

export function isReplacedTag(tag: string | null): boolean {
  if (tag === null) return false
  return REPLACED_ELEMENT_TAGS.has(tag)
}

// ── Signal normalization ─────────────────────────────────────────────────

const MONITORED_SIGNAL_SET = new Set<string>(layoutSignalNames)
const MONITORED_SHORTHAND_SET = new Set<string>([
  "padding", "border-width", "margin-block", "padding-block",
  "padding-inline", "inset-block", "flex-flow",
])

export const MONITORED_SIGNAL_NAME_MAP = new Map<string, LayoutSignalName>(
  layoutSignalNames.map((name) => [name, name]),
)

export function isMonitoredSignal(property: string): boolean {
  if (MONITORED_SIGNAL_SET.has(property)) return true
  return MONITORED_SHORTHAND_SET.has(property)
}

const LENGTH_SIGNAL_SET = new Set<LayoutSignalName>([
  "font-size", "width", "inline-size", "height", "block-size",
  "min-width", "min-block-size", "min-height", "max-width", "max-height",
  "flex-basis", "top", "bottom", "margin-top", "margin-bottom",
  "padding-top", "padding-left", "padding-right", "padding-bottom",
  "border-top-width", "border-left-width", "border-right-width", "border-bottom-width",
  "inset-block-start", "inset-block-end",
])

const KEYWORD_SIGNAL_SET = new Set<LayoutSignalName>([
  "vertical-align", "display", "white-space", "object-fit",
  "overflow", "overflow-y", "overflow-anchor", "scrollbar-gutter", "scrollbar-width",
  "content-visibility", "align-items", "align-self", "justify-items",
  "place-items", "place-self", "flex-direction", "grid-auto-flow",
  "appearance", "box-sizing", "position", "writing-mode", "direction",
])

const DIMENSION_KEYWORD_SET: ReadonlySet<string> = new Set([
  "auto", "none", "fit-content", "min-content", "max-content", "stretch",
  "inherit", "initial", "unset", "revert", "revert-layer",
])

interface NormalizedSignalMap {
  readonly signals: ReadonlyMap<LayoutSignalName, SignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}

function normalizeSignalMapWithCounts(
  values: ReadonlyMap<string, CascadedDeclaration>,
): NormalizedSignalMap {
  const out = new Map<LayoutSignalName, SignalValue>()

  const fontSizeEntry = values.get("font-size")
  let fontSizePx: number | null = null

  if (fontSizeEntry) {
    const parsedFontSize = normalizeSignal(
      "font-size", fontSizeEntry.value, fontSizeEntry.source, fontSizeEntry.guardProvenance, null,
    )
    out.set("font-size", parsedFontSize)
    if (parsedFontSize.kind === SignalValueKind.Known && parsedFontSize.guard.kind === 0 /* Unconditional */) {
      fontSizePx = parsedFontSize.px
    }
  }

  for (const [property, declaration] of values) {
    if (property === "font-size") continue

    const name = MONITORED_SIGNAL_NAME_MAP.get(property)
    if (!name) continue

    const normalized = normalizeSignal(
      name, declaration.value, declaration.source, declaration.guardProvenance, fontSizePx,
    )
    out.set(name, normalized)
  }

  let knownSignalCount = 0
  let unknownSignalCount = 0
  let conditionalSignalCount = 0

  for (const value of out.values()) {
    if (value.guard.kind === 1 /* Conditional */) {
      conditionalSignalCount++
      continue
    }
    if (value.kind === SignalValueKind.Known) {
      knownSignalCount++
      continue
    }
    unknownSignalCount++
  }

  return { signals: out, knownSignalCount, unknownSignalCount, conditionalSignalCount }
}

function normalizeSignal(
  name: LayoutSignalName,
  raw: string,
  source: SignalSource,
  guard: RuleGuard,
  fontSizePx: number | null,
): SignalValue {
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

function parseAspectRatio(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return createUnknown(name, source, guard, "aspect-ratio value is empty")
  if (hasDynamicExpression(trimmed)) return createUnknown(name, source, guard, "aspect-ratio uses runtime-dependent function")
  if (trimmed === "auto") return createUnknown(name, source, guard, "aspect-ratio auto does not reserve ratio")

  const slash = trimmed.indexOf("/")
  if (slash !== -1) {
    const left = Number(trimmed.slice(0, slash).trim())
    const right = Number(trimmed.slice(slash + 1).trim())
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
      return createUnknown(name, source, guard, "aspect-ratio ratio is invalid")
    }
    return createKnown(name, trimmed, source, guard, null, SignalUnit.Unitless, SignalQuality.Exact)
  }

  const ratio = Number(trimmed)
  if (!Number.isFinite(ratio) || ratio <= 0) return createUnknown(name, source, guard, "aspect-ratio is not statically parseable")
  return createKnown(name, trimmed, source, guard, null, SignalUnit.Unitless, SignalQuality.Exact)
}

function parseContainIntrinsicSize(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return createUnknown(name, source, guard, "contain-intrinsic-size value is empty")
  if (hasDynamicExpression(trimmed)) return createUnknown(name, source, guard, "contain-intrinsic-size uses runtime-dependent function")
  if (trimmed === "none" || trimmed === "auto") return createUnknown(name, source, guard, "contain-intrinsic-size does not reserve space")

  const parts = splitWhitespaceTokens(trimmed)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const px = parseSignedPxValue(part)
    if (px !== null) return createKnown(name, trimmed, source, guard, px, SignalUnit.Px, SignalQuality.Exact)
  }

  return createUnknown(name, source, guard, "contain-intrinsic-size is not statically parseable in px")
}

function parseLineHeight(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard, fontSizePx: number | null): SignalValue {
  const normalized = raw.trim().toLowerCase()
  const unitless = parseUnitlessValue(raw)
  if (unitless !== null) {
    const base = fontSizePx === null ? 16 : fontSizePx
    return createKnown(name, normalized, source, guard, unitless * base, SignalUnit.Unitless, SignalQuality.Estimated)
  }

  const px = parseSignedPxValue(raw)
  if (px !== null) return createKnown(name, normalized, source, guard, px, SignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "line-height is not statically parseable")
}

function parseLength(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const px = parseSignedPxValue(raw)
  const normalized = raw.trim().toLowerCase()
  if (px !== null) return createKnown(name, normalized, source, guard, px, SignalUnit.Px, SignalQuality.Exact)
  if (DIMENSION_KEYWORD_SET.has(normalized) || normalized.startsWith("fit-content(")) {
    return createKnown(name, normalized, source, guard, null, SignalUnit.Keyword, SignalQuality.Exact)
  }
  return createUnknown(name, source, guard, "length is not statically parseable in px")
}

function parseKeyword(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) return createUnknown(name, source, guard, "keyword value is empty")
  if (hasDynamicExpression(normalized)) return createUnknown(name, source, guard, "keyword uses runtime-dependent function")
  return createKnown(name, normalized, source, guard, null, SignalUnit.Keyword, SignalQuality.Exact)
}

function parseTransform(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) return createUnknown(name, source, guard, "transform value is empty")
  if (hasDynamicExpression(normalized)) return createUnknown(name, source, guard, "transform uses runtime-dependent function")

  const y = extractTransformYPx(normalized)
  if (y !== null) return createKnown(name, normalized, source, guard, y, SignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "transform has non-translational or non-px functions")
}

function parseTranslateProperty(name: LayoutSignalName, raw: string, source: SignalSource, guard: RuleGuard): SignalValue {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return createUnknown(name, source, guard, "translate value is empty")
  if (hasDynamicExpression(trimmed)) return createUnknown(name, source, guard, "translate uses runtime-dependent function")

  const y = extractTranslatePropertyYPx(trimmed)
  if (y !== null) return createKnown(name, trimmed, source, guard, y, SignalUnit.Px, SignalQuality.Exact)
  return createUnknown(name, source, guard, "translate property vertical component is not px")
}

function hasDynamicExpression(raw: string): boolean {
  if (raw.includes("var(")) return true
  if (raw.includes("env(")) return true
  if (raw.includes("attr(")) return true
  return false
}

function createKnown(
  name: LayoutSignalName, normalized: string, source: SignalSource,
  guard: RuleGuard, px: number | null, unit: SignalUnit, quality: SignalQuality,
): KnownSignalValue {
  return { kind: SignalValueKind.Known, name, normalized, source, guard, unit, px, quality }
}

function createUnknown(
  name: LayoutSignalName, source: SignalSource | null, guard: RuleGuard, reason: string,
): UnknownSignalValue {
  return { kind: SignalValueKind.Unknown, name, source, guard, reason }
}


// ── Signal inheritance ───────────────────────────────────────────────────

const INHERITED_SIGNAL_NAMES: readonly LayoutSignalName[] = [
  "font-size", "line-height", "writing-mode", "direction",
]

interface InheritedSignalsResult {
  readonly signals: ReadonlyMap<LayoutSignalName, SignalValue>
  readonly knownDelta: number
  readonly unknownDelta: number
  readonly conditionalDelta: number
}

function inheritSignalsFromParent(
  parentSnapshot: SignalSnapshot | null,
  local: ReadonlyMap<LayoutSignalName, SignalValue>,
): InheritedSignalsResult {
  if (!parentSnapshot) {
    return { signals: local, knownDelta: 0, unknownDelta: 0, conditionalDelta: 0 }
  }

  let out: Map<LayoutSignalName, SignalValue> | null = null
  let knownDelta = 0
  let unknownDelta = 0
  let conditionalDelta = 0

  for (let i = 0; i < INHERITED_SIGNAL_NAMES.length; i++) {
    const signal = INHERITED_SIGNAL_NAMES[i]
    if (!signal) continue
    if (local.has(signal)) continue

    const inheritedValue = parentSnapshot.signals.get(signal)
    if (!inheritedValue) continue
    if (out === null) out = new Map(local)
    out.set(signal, inheritedValue)

    if (inheritedValue.guard.kind === 1 /* Conditional */) {
      conditionalDelta++
      continue
    }

    if (inheritedValue.kind === SignalValueKind.Known) {
      knownDelta++
      continue
    }
    unknownDelta++
  }

  if (out === null) {
    return { signals: local, knownDelta: 0, unknownDelta: 0, conditionalDelta: 0 }
  }

  return { signals: out, knownDelta, unknownDelta, conditionalDelta }
}


// ── buildSignalSnapshot ──────────────────────────────────────────────────

export function buildSignalSnapshot(
  elementId: number,
  cascade: ElementCascade,
  parentSnapshot: SignalSnapshot | null,
): SignalSnapshot {
  const normalized = normalizeSignalMapWithCounts(cascade.declarations)
  const inherited = inheritSignalsFromParent(parentSnapshot, normalized.signals)

  return {
    elementId,
    signals: inherited.signals,
    knownSignalCount: normalized.knownSignalCount + inherited.knownDelta,
    unknownSignalCount: normalized.unknownSignalCount + inherited.unknownDelta,
    conditionalSignalCount: normalized.conditionalSignalCount + inherited.conditionalDelta,
  }
}
