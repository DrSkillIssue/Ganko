/**
 * Alignment model types + computation.
 *
 * Moved from cross-file/layout/context-classification.ts + cohort-index.ts +
 * measurement-node.ts + content-composition.ts + consistency-domain.ts +
 * offset.ts + signal-access helpers + util helpers.
 */
import type { ElementNode } from "../binding/element-builder"
import type { GuardConditionProvenance } from "../binding/cascade-binder"
import type { SignalSnapshot, SignalValue, KnownSignalValue, LayoutSignalName } from "../binding/signal-builder"
import { SignalValueKind, SignalQuality, parseSignedPxValue, extractTransformYPx, extractTranslatePropertyYPx } from "../binding/signal-builder"
import { TextualContentState } from "../binding/signal-builder"


// ══════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════

export type AlignmentContextKind = "inline-formatting" | "table-cell" | "flex-cross-axis" | "grid-cross-axis" | "block-flow" | "positioned-offset"
export type LayoutAxisModel = "horizontal-tb" | "vertical-rl" | "vertical-lr"
export type InlineDirectionModel = "ltr" | "rtl"
export type LayoutContextContainerKind = "table" | "flex" | "grid" | "inline" | "block"
export const enum ContextCertainty { Resolved = 0, Conditional = 1, Unknown = 2 }
export type BaselineRelevance = "relevant" | "irrelevant"

export interface LayoutContextEvidence {
  readonly containerKind: LayoutContextContainerKind
  readonly containerKindCertainty: ContextCertainty
  readonly hasTableSemantics: boolean
  readonly hasPositionedOffset: boolean
  readonly positionedOffsetCertainty: ContextCertainty
}

export interface AlignmentContext {
  readonly kind: AlignmentContextKind
  readonly certainty: ContextCertainty
  readonly parentSolidFile: string
  readonly parentElementId: number
  readonly parentElementKey: string
  readonly parentTag: string | null
  readonly axis: LayoutAxisModel
  readonly axisCertainty: ContextCertainty
  readonly inlineDirection: InlineDirectionModel
  readonly inlineDirectionCertainty: ContextCertainty
  readonly parentDisplay: string | null
  readonly parentAlignItems: string | null
  readonly parentPlaceItems: string | null
  readonly hasPositionedOffset: boolean
  readonly crossAxisIsBlockAxis: boolean
  readonly crossAxisIsBlockAxisCertainty: ContextCertainty
  readonly baselineRelevance: BaselineRelevance
  readonly evidence: LayoutContextEvidence
}

export const enum EvidenceValueKind { Exact = 0, Interval = 1, Conditional = 2, Unknown = 3 }
export interface EvidenceWitness<T> { readonly value: T | null; readonly kind: EvidenceValueKind }
export type NumericEvidenceValue = EvidenceWitness<number>

export const enum AlignmentTextContrast { Different = 0, Same = 1, Unknown = 2 }
export const enum SignalConflictValue { Conflict = 0, Aligned = 1, Unknown = 2 }
export interface SignalConflictEvidence { readonly value: SignalConflictValue; readonly kind: EvidenceValueKind }

export interface AlignmentCohortSignals {
  readonly verticalAlign: SignalConflictEvidence
  readonly alignSelf: SignalConflictEvidence
  readonly placeSelf: SignalConflictEvidence
  readonly hasControlOrReplacedPeer: boolean
  readonly textContrastWithPeers: AlignmentTextContrast
}

export const enum CohortSubjectMembership { Dominant = 0, Nondominant = 1, Ambiguous = 2, Insufficient = 3 }
export interface CohortIdentifiability {
  readonly dominantShare: number
  readonly subjectExcludedDominantShare: number
  readonly subjectMembership: CohortSubjectMembership
  readonly ambiguous: boolean
  readonly kind: EvidenceValueKind
}

export const enum ContentCompositionClassification {
  TextOnly = 0, ReplacedOnly = 1, MixedUnmitigated = 2,
  MixedMitigated = 3, BlockSegmented = 4, Unknown = 5,
}
export type InlineReplacedKind = "intrinsic" | "container"

export interface ContentCompositionFingerprint {
  readonly hasTextContent: boolean
  readonly hasInlineReplaced: boolean
  readonly inlineReplacedKind: InlineReplacedKind | null
  readonly hasHeightContributingDescendant: boolean
  readonly wrappingContextMitigates: boolean
  readonly hasVerticalAlignMitigation: boolean
  readonly mixedContentDepth: number
  readonly classification: ContentCompositionClassification
  readonly analyzableChildCount: number
  readonly totalChildCount: number
  readonly hasOnlyBlockChildren: boolean
}

export interface AlignmentElementEvidence {
  readonly solidFile: string
  readonly elementKey: string
  readonly elementId: number
  readonly tag: string | null
  readonly snapshot: SignalSnapshot
}

export interface CohortFactSummary {
  readonly exact: number
  readonly interval: number
  readonly unknown: number
  readonly conditional: number
  readonly total: number
  readonly exactShare: number
  readonly intervalShare: number
  readonly unknownShare: number
  readonly conditionalShare: number
}

export interface EvidenceProvenance {
  readonly reason: string
  readonly guardKey: string
  readonly guards: readonly GuardConditionProvenance[]
}

export interface CohortProfile {
  readonly medianDeclaredOffsetPx: number | null
  readonly declaredOffsetDispersionPx: number | null
  readonly medianEffectiveOffsetPx: number | null
  readonly effectiveOffsetDispersionPx: number | null
  readonly medianLineHeightPx: number | null
  readonly lineHeightDispersionPx: number | null
  readonly dominantClusterSize: number
  readonly dominantClusterShare: number
  readonly unimodal: boolean
}

export interface CohortSubjectStats {
  readonly element: AlignmentElementEvidence
  readonly declaredOffset: NumericEvidenceValue
  readonly effectiveOffset: NumericEvidenceValue
  readonly lineHeight: NumericEvidenceValue
  readonly baselineProfile: CohortProfile
  readonly signals: AlignmentCohortSignals
  readonly identifiability: CohortIdentifiability
  readonly contentComposition: ContentCompositionFingerprint
}

export interface CohortStats {
  readonly profile: CohortProfile
  readonly snapshots: readonly SignalSnapshot[]
  readonly factSummary: CohortFactSummary
  readonly provenance: EvidenceProvenance
  readonly conditionalSignalCount: number
  readonly totalSignalCount: number
  readonly subjectsByElementKey: ReadonlyMap<string, CohortSubjectStats>
  readonly excludedElementKeys: ReadonlySet<string>
}

export interface HotEvidenceWitness<T> extends EvidenceWitness<T> { readonly present: boolean }
export type HotNumericSignalEvidence = HotEvidenceWitness<number>
export type HotNormalizedSignalEvidence = HotEvidenceWitness<string>

export interface SnapshotHotSignals {
  readonly lineHeight: HotNumericSignalEvidence
  readonly verticalAlign: HotNormalizedSignalEvidence
  readonly alignSelf: HotNormalizedSignalEvidence
  readonly placeSelf: HotNormalizedSignalEvidence
  readonly flexDirection: HotNormalizedSignalEvidence
  readonly gridAutoFlow: HotNormalizedSignalEvidence
  readonly writingMode: HotNormalizedSignalEvidence
  readonly direction: HotNormalizedSignalEvidence
  readonly display: HotNormalizedSignalEvidence
  readonly alignItems: HotNormalizedSignalEvidence
  readonly placeItems: HotNormalizedSignalEvidence
  readonly position: HotNormalizedSignalEvidence
  readonly insetBlockStart: HotNumericSignalEvidence
  readonly insetBlockEnd: HotNumericSignalEvidence
  readonly transform: HotNumericSignalEvidence
  readonly translate: HotNumericSignalEvidence
  readonly top: HotNumericSignalEvidence
  readonly bottom: HotNumericSignalEvidence
  readonly marginTop: HotNumericSignalEvidence
  readonly marginBottom: HotNumericSignalEvidence
}


// ══════════════════════════════════════════════════════════════════════════
// Util helpers (from cross-file/layout/util.ts)
// ══════════════════════════════════════════════════════════════════════════

const CONTROL_ELEMENT_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea", "button"])
const INTRINSIC_REPLACED_TAGS: ReadonlySet<string> = new Set(["img", "svg", "video", "canvas", "iframe", "object", "embed"])
const WHITESPACE_RE = /\s+/

function mergeEvidenceKind(left: EvidenceValueKind, right: EvidenceValueKind): EvidenceValueKind {
  return left > right ? left : right
}

function selectKth(values: number[], targetIndex: number): number {
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

// ── Offset baseline (from cross-file/layout/offset-baseline.ts) ──────────

export const layoutOffsetSignals = [
  "top", "bottom", "margin-top", "margin-bottom",
  "inset-block-start", "inset-block-end", "transform", "translate",
] as const satisfies readonly LayoutSignalName[]

export type LayoutOffsetSignal = (typeof layoutOffsetSignals)[number]

export function parseOffsetPx(property: LayoutOffsetSignal, raw: string): number | null {
  if (property === "transform") return extractTransformYPx(raw)
  if (property === "translate") return extractTranslatePropertyYPx(raw)
  return parseSignedPxValue(raw)
}

function toComparableExactValue(value: NumericEvidenceValue): number | null {
  if (value.value !== null) {
    if (value.kind !== EvidenceValueKind.Exact) return null
    return value.value
  }
  if (value.kind === EvidenceValueKind.Exact) return 0
  return null
}


// ══════════════════════════════════════════════════════════════════════════
// Signal access helpers (from cross-file/layout/signal-access.ts)
// ══════════════════════════════════════════════════════════════════════════

function readKnownSignalWithGuard(snapshot: SignalSnapshot, name: LayoutSignalName): KnownSignalValue | null {
  const value = snapshot.signals.get(name)
  if (!value) return null
  if (value.kind !== SignalValueKind.Known) return null
  return value
}

function readKnownSignal(snapshot: SignalSnapshot, name: LayoutSignalName): KnownSignalValue | null {
  const value = readKnownSignalWithGuard(snapshot, name)
  if (!value) return null
  if (value.guard.kind === 1 /* Conditional */) return null
  return value
}

function readKnownNormalized(snapshot: SignalSnapshot, name: LayoutSignalName): string | null {
  const value = readKnownSignal(snapshot, name)
  if (!value) return null
  return value.normalized
}

function toSignalEvidenceKind(value: KnownSignalValue): EvidenceValueKind {
  if (value.guard.kind === 1 /* Conditional */) return EvidenceValueKind.Conditional
  if (value.quality === SignalQuality.Estimated) return EvidenceValueKind.Interval
  return EvidenceValueKind.Exact
}

export function readNumericSignalEvidence(snapshot: SignalSnapshot, name: LayoutSignalName): NumericEvidenceValue {
  const value = snapshot.signals.get(name)
  if (!value) return { value: null, kind: EvidenceValueKind.Unknown }
  if (value.kind !== SignalValueKind.Known) {
    if (value.guard.kind === 1 /* Conditional */) return { value: null, kind: EvidenceValueKind.Conditional }
    return { value: null, kind: EvidenceValueKind.Unknown }
  }
  return { value: value.px, kind: toSignalEvidenceKind(value) }
}

type NormalizedSignalEvidence = EvidenceWitness<string>

function readNormalizedSignalEvidence(snapshot: SignalSnapshot, name: LayoutSignalName): NormalizedSignalEvidence {
  const value = snapshot.signals.get(name)
  if (!value) return { value: null, kind: EvidenceValueKind.Unknown }
  if (value.kind !== SignalValueKind.Known) {
    if (value.guard.kind === 1 /* Conditional */) return { value: null, kind: EvidenceValueKind.Conditional }
    return { value: null, kind: EvidenceValueKind.Unknown }
  }
  return { value: value.normalized, kind: toSignalEvidenceKind(value) }
}

function isLayoutHidden(node: ElementNode, snapshotByElementId: ReadonlyMap<number, SignalSnapshot>): boolean {
  if (node.attributes.has("hidden")) return true
  if (node.classTokenSet.has("hidden")) return true
  const snapshot = snapshotByElementId.get(node.elementId)
  if (snapshot) {
    const display = readKnownNormalized(snapshot, "display")
    if (display === "none") return true
  }
  return false
}


// ══════════════════════════════════════════════════════════════════════════
// Hot signals (from cross-file/layout/build.ts computeHotSignals)
// ══════════════════════════════════════════════════════════════════════════

const ABSENT_NUMERIC: HotNumericSignalEvidence = { present: false, value: null, kind: EvidenceValueKind.Unknown }
const ABSENT_NORMALIZED: HotNormalizedSignalEvidence = { present: false, value: null, kind: EvidenceValueKind.Unknown }

function toHotNumeric(signal: SignalValue): HotNumericSignalEvidence {
  if (signal.kind !== SignalValueKind.Known) {
    return {
      present: true,
      value: null,
      kind: signal.guard.kind === 1 /* Conditional */ ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.px,
    kind: signal.guard.kind === 1 /* Conditional */
      ? EvidenceValueKind.Conditional
      : signal.quality === SignalQuality.Estimated ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

function toHotNormalized(signal: SignalValue): HotNormalizedSignalEvidence {
  if (signal.kind !== SignalValueKind.Known) {
    return {
      present: true,
      value: null,
      kind: signal.guard.kind === 1 /* Conditional */ ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.normalized,
    kind: signal.guard.kind === 1 /* Conditional */
      ? EvidenceValueKind.Conditional
      : signal.quality === SignalQuality.Estimated ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

export function computeHotSignals(snapshot: SignalSnapshot): SnapshotHotSignals {
  let lineHeight: HotNumericSignalEvidence = ABSENT_NUMERIC
  let verticalAlign: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let flexDirection: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let gridAutoFlow: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let writingMode: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let direction: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let display: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let position: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let insetBlockStart: HotNumericSignalEvidence = ABSENT_NUMERIC
  let insetBlockEnd: HotNumericSignalEvidence = ABSENT_NUMERIC
  let transform: HotNumericSignalEvidence = ABSENT_NUMERIC
  let translate: HotNumericSignalEvidence = ABSENT_NUMERIC
  let top: HotNumericSignalEvidence = ABSENT_NUMERIC
  let bottom: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginTop: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginBottom: HotNumericSignalEvidence = ABSENT_NUMERIC

  for (const [name, value] of snapshot.signals) {
    switch (name) {
      case "line-height": lineHeight = toHotNumeric(value); break
      case "vertical-align": verticalAlign = toHotNormalized(value); break
      case "align-self": alignSelf = toHotNormalized(value); break
      case "place-self": placeSelf = toHotNormalized(value); break
      case "flex-direction": flexDirection = toHotNormalized(value); break
      case "grid-auto-flow": gridAutoFlow = toHotNormalized(value); break
      case "writing-mode": writingMode = toHotNormalized(value); break
      case "direction": direction = toHotNormalized(value); break
      case "display": display = toHotNormalized(value); break
      case "align-items": alignItems = toHotNormalized(value); break
      case "place-items": placeItems = toHotNormalized(value); break
      case "position": position = toHotNormalized(value); break
      case "inset-block-start": insetBlockStart = toHotNumeric(value); break
      case "inset-block-end": insetBlockEnd = toHotNumeric(value); break
      case "transform": transform = toHotNumeric(value); break
      case "translate": translate = toHotNumeric(value); break
      case "top": top = toHotNumeric(value); break
      case "bottom": bottom = toHotNumeric(value); break
      case "margin-top": marginTop = toHotNumeric(value); break
      case "margin-bottom": marginBottom = toHotNumeric(value); break
      default: break
    }
  }

  return {
    lineHeight, verticalAlign, alignSelf, placeSelf,
    flexDirection, gridAutoFlow, writingMode, direction,
    display, alignItems, placeItems, position,
    insetBlockStart, insetBlockEnd, transform, translate,
    top, bottom, marginTop, marginBottom,
  }
}


// ══════════════════════════════════════════════════════════════════════════
// Context classification (from cross-file/layout/context-classification.ts)
// ══════════════════════════════════════════════════════════════════════════

const TABLE_SEMANTIC_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"])
const TABLE_DISPLAY_VALUES = new Set(["table", "inline-table", "table-row", "table-cell", "table-row-group", "table-header-group", "table-footer-group", "table-column", "table-column-group", "table-caption"])
const FLEX_DISPLAY_VALUES = new Set(["flex", "inline-flex"])
const GRID_DISPLAY_VALUES = new Set(["grid", "inline-grid"])
const INLINE_DISPLAY_VALUES = new Set(["inline", "inline-block", "inline-list-item"])
const FLEX_ROW_VALUES = new Set(["row", "row-reverse"])
const FLEX_GRID_GEOMETRIC_ALIGN_ITEMS: ReadonlySet<string> = new Set(["center", "flex-start", "flex-end", "start", "end", "stretch", "self-start", "self-end", "normal"])
const TABLE_CELL_GEOMETRIC_VERTICAL_ALIGN: ReadonlySet<string> = new Set(["middle", "top", "bottom"])

export function createAlignmentContextForParent(parent: ElementNode, snapshot: SignalSnapshot): AlignmentContext {
  const axis = resolveAxis(snapshot)
  const inlineDirection = resolveInlineDirection(snapshot)
  const parentDisplaySignal = readKnownSignalWithGuard(snapshot, "display")
  const parentAlignItemsSignal = readKnownSignalWithGuard(snapshot, "align-items")
  const parentPlaceItemsSignal = readKnownSignalWithGuard(snapshot, "place-items")

  const parentDisplay = parentDisplaySignal ? parentDisplaySignal.normalized : null
  const parentAlignItems = parentAlignItemsSignal ? parentAlignItemsSignal.normalized : null
  const parentPlaceItems = parentPlaceItemsSignal ? parentPlaceItemsSignal.normalized : null
  const parentDisplayCertainty = resolveSignalCertainty(parentDisplaySignal)

  const positionedOffset = resolvePositionedOffset(snapshot)
  const evidence = resolveContextEvidence(parent, parentDisplay, parentDisplayCertainty, positionedOffset.hasPositionedOffset, positionedOffset.certainty)
  const classified = classifyKind(evidence)
  const contextCertainty = combineCertainty(classified.certainty, axis.certainty)
  const certainty = combineCertainty(contextCertainty, inlineDirection.certainty)

  const baselineRelevance = computeBaselineRelevance(classified.kind, parentAlignItems, parentPlaceItems)
  const crossAxisInfo = resolveCrossAxisIsBlockAxis(classified.kind, snapshot, axis.value)

  return {
    kind: classified.kind,
    certainty,
    parentSolidFile: parent.solidFile,
    parentElementId: parent.elementId,
    parentElementKey: parent.key,
    parentTag: parent.tag,
    axis: axis.value,
    axisCertainty: axis.certainty,
    inlineDirection: inlineDirection.value,
    inlineDirectionCertainty: inlineDirection.certainty,
    parentDisplay,
    parentAlignItems,
    parentPlaceItems,
    hasPositionedOffset: positionedOffset.hasPositionedOffset,
    crossAxisIsBlockAxis: crossAxisInfo.value,
    crossAxisIsBlockAxisCertainty: crossAxisInfo.certainty,
    baselineRelevance,
    evidence,
  }
}

function classifyKind(evidence: LayoutContextEvidence): { readonly kind: AlignmentContextKind; readonly certainty: ContextCertainty } {
  if (evidence.hasTableSemantics) return { kind: "table-cell", certainty: ContextCertainty.Resolved }
  if (evidence.containerKind === "table") return { kind: "table-cell", certainty: evidence.containerKindCertainty }
  if (evidence.containerKind === "flex") return { kind: "flex-cross-axis", certainty: evidence.containerKindCertainty }
  if (evidence.containerKind === "grid") return { kind: "grid-cross-axis", certainty: evidence.containerKindCertainty }
  if (evidence.containerKind === "inline") return { kind: "inline-formatting", certainty: evidence.containerKindCertainty }
  if (evidence.hasPositionedOffset) return { kind: "positioned-offset", certainty: evidence.positionedOffsetCertainty }
  return { kind: "block-flow", certainty: combineCertainty(evidence.containerKindCertainty, evidence.positionedOffsetCertainty) }
}

function resolveContextEvidence(parent: ElementNode, parentDisplay: string | null, parentDisplayCertainty: ContextCertainty, hasPositionedOffset: boolean, positionedOffsetCertainty: ContextCertainty): LayoutContextEvidence {
  const hasTableSemantics = parent.tagName !== null && TABLE_SEMANTIC_TAGS.has(parent.tagName)
  const container = resolveContainerKind(parentDisplay, parentDisplayCertainty)
  return { containerKind: container.kind, containerKindCertainty: container.certainty, hasTableSemantics, hasPositionedOffset, positionedOffsetCertainty }
}

function resolveContainerKind(parentDisplay: string | null, certainty: ContextCertainty): { readonly kind: LayoutContextContainerKind; readonly certainty: ContextCertainty } {
  if (parentDisplay === null) return { kind: "block", certainty }
  const display = parentDisplay.trim().toLowerCase()
  if (display.length === 0) return { kind: "block", certainty }
  if (TABLE_DISPLAY_VALUES.has(display)) return { kind: "table", certainty }
  if (FLEX_DISPLAY_VALUES.has(display)) return { kind: "flex", certainty }
  if (GRID_DISPLAY_VALUES.has(display)) return { kind: "grid", certainty }
  if (INLINE_DISPLAY_VALUES.has(display)) return { kind: "inline", certainty }

  const tokens = display.split(WHITESPACE_RE)
  if (tokens.length === 2) {
    const inside = tokens[1]
    if (inside === "table") return { kind: "table", certainty }
    if (inside === "flex") return { kind: "flex", certainty }
    if (inside === "grid") return { kind: "grid", certainty }
    if (tokens[0] === "inline") return { kind: "inline", certainty }
  }

  if (tokens.length > 0 && tokens[0] === "inline") return { kind: "inline", certainty }
  return { kind: "block", certainty }
}

function resolveAxis(snapshot: SignalSnapshot): { readonly value: LayoutAxisModel; readonly certainty: ContextCertainty } {
  if (!snapshot.signals.has("writing-mode")) return { value: "horizontal-tb", certainty: ContextCertainty.Resolved }
  const writingMode = readNormalizedSignalEvidence(snapshot, "writing-mode")
  if (writingMode.value === "vertical-rl") return { value: "vertical-rl", certainty: toContextCertainty(writingMode.kind) }
  if (writingMode.value === "vertical-lr") return { value: "vertical-lr", certainty: toContextCertainty(writingMode.kind) }
  return { value: "horizontal-tb", certainty: toContextCertainty(writingMode.kind) }
}

function resolveInlineDirection(snapshot: SignalSnapshot): { readonly value: InlineDirectionModel; readonly certainty: ContextCertainty } {
  if (!snapshot.signals.has("direction")) return { value: "ltr", certainty: ContextCertainty.Resolved }
  const direction = readNormalizedSignalEvidence(snapshot, "direction")
  if (direction.value === "rtl") return { value: "rtl", certainty: toContextCertainty(direction.kind) }
  return { value: "ltr", certainty: toContextCertainty(direction.kind) }
}

function toContextCertainty(kind: EvidenceValueKind): ContextCertainty {
  if (kind === EvidenceValueKind.Exact) return ContextCertainty.Resolved
  if (kind === EvidenceValueKind.Interval || kind === EvidenceValueKind.Conditional) return ContextCertainty.Conditional
  return ContextCertainty.Unknown
}

function resolvePositionedOffset(snapshot: SignalSnapshot): { readonly hasPositionedOffset: boolean; readonly certainty: ContextCertainty } {
  const position = readKnownSignalWithGuard(snapshot, "position")
  if (!position) return { hasPositionedOffset: false, certainty: ContextCertainty.Unknown }
  const certainty = resolveSignalCertainty(position)
  if (position.normalized === "static") return { hasPositionedOffset: false, certainty }
  return { hasPositionedOffset: true, certainty }
}

function resolveCrossAxisIsBlockAxis(kind: AlignmentContextKind, snapshot: SignalSnapshot, _axis: LayoutAxisModel): { readonly value: boolean; readonly certainty: ContextCertainty } {
  if (kind !== "flex-cross-axis" && kind !== "grid-cross-axis") return { value: true, certainty: ContextCertainty.Resolved }
  if (kind === "flex-cross-axis") {
    const signal = readKnownSignalWithGuard(snapshot, "flex-direction")
    if (!signal) return { value: true, certainty: ContextCertainty.Resolved }
    return { value: FLEX_ROW_VALUES.has(signal.normalized), certainty: resolveSignalCertainty(signal) }
  }
  const signal = readKnownSignalWithGuard(snapshot, "grid-auto-flow")
  if (!signal) return { value: true, certainty: ContextCertainty.Resolved }
  return { value: !signal.normalized.startsWith("column"), certainty: resolveSignalCertainty(signal) }
}

function resolveSignalCertainty(value: KnownSignalValue | null): ContextCertainty {
  if (!value) return ContextCertainty.Unknown
  if (value.guard.kind === 1 /* Conditional */) return ContextCertainty.Conditional
  return ContextCertainty.Resolved
}

function combineCertainty(left: ContextCertainty, right: ContextCertainty): ContextCertainty {
  return left > right ? left : right
}

function computeBaselineRelevance(kind: AlignmentContextKind, parentAlignItems: string | null, parentPlaceItems: string | null): BaselineRelevance {
  if (kind === "flex-cross-axis" || kind === "grid-cross-axis") {
    const effective = resolveEffectiveAlignItems(parentAlignItems, parentPlaceItems)
    if (effective === null) return "relevant"
    return FLEX_GRID_GEOMETRIC_ALIGN_ITEMS.has(effective) ? "irrelevant" : "relevant"
  }
  return "relevant"
}

function resolveEffectiveAlignItems(alignItems: string | null, placeItems: string | null): string | null {
  if (alignItems !== null) return alignItems
  if (placeItems === null) return null
  const firstToken = placeItems.split(WHITESPACE_RE)[0]
  return firstToken ?? null
}

export function finalizeTableCellBaselineRelevance(
  contextByParentId: Map<number, AlignmentContext>,
  cohortVerticalAlignConsensus: ReadonlyMap<number, string | null>,
): void {
  for (const [parentId, consensusValue] of cohortVerticalAlignConsensus) {
    const context = contextByParentId.get(parentId)
    if (!context) continue
    if (context.kind !== "table-cell") continue
    if (consensusValue === null) continue
    if (!TABLE_CELL_GEOMETRIC_VERTICAL_ALIGN.has(consensusValue)) continue
    contextByParentId.set(parentId, { ...context, baselineRelevance: "irrelevant" })
  }
}


// ══════════════════════════════════════════════════════════════════════════
// Consistency domain (from cross-file/layout/consistency-domain.ts)
// ══════════════════════════════════════════════════════════════════════════

export function summarizeSignalFacts(snapshots: readonly SignalSnapshot[]): CohortFactSummary {
  let exact = 0
  let interval = 0
  let unknown = 0
  let conditional = 0
  let total = 0

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    if (!snap) continue
    for (const value of snap.signals.values()) {
      if (value.guard.kind === 1 /* Conditional */) { conditional++; total++; continue }
      if (value.kind === SignalValueKind.Unknown) { unknown++; total++; continue }
      if (value.quality === SignalQuality.Estimated && value.px !== null) { interval++; total++; continue }
      exact++; total++
    }
  }

  if (total === 0) return { exact, interval, unknown, conditional, total, exactShare: 0, intervalShare: 0, unknownShare: 0, conditionalShare: 0 }
  return { exact, interval, unknown, conditional, total, exactShare: exact / total, intervalShare: interval / total, unknownShare: unknown / total, conditionalShare: conditional / total }
}


// ══════════════════════════════════════════════════════════════════════════
// Offset estimation (from cross-file/layout/offset.ts)
// ══════════════════════════════════════════════════════════════════════════

interface BlockOffsetEstimate {
  readonly declared: NumericEvidenceValue
  readonly effective: NumericEvidenceValue
}

export function estimateBlockOffsetWithDeclaredFromHotSignals(hot: SnapshotHotSignals, axis: LayoutAxisModel): BlockOffsetEstimate {
  return estimateBlockOffsetWithDeclaredFromSources(axis, hot.position, (name) => {
    switch (name) {
      case "inset-block-start": return hot.insetBlockStart
      case "inset-block-end": return hot.insetBlockEnd
      case "transform": return hot.transform
      case "translate": return hot.translate
      case "top": return hot.top
      case "bottom": return hot.bottom
      case "margin-top": return hot.marginTop
      default: return hot.marginBottom
    }
  })
}

function estimateBlockOffsetWithDeclaredFromSources(
  axis: LayoutAxisModel,
  position: { readonly value: string | null; readonly kind: EvidenceValueKind },
  readNumeric: (name: "inset-block-start" | "inset-block-end" | "transform" | "translate" | "top" | "bottom" | "margin-top" | "margin-bottom") => HotNumericSignalEvidence,
): BlockOffsetEstimate {
  let declaredTotal = 0
  let declaredCount = 0
  let declaredKind: EvidenceValueKind = EvidenceValueKind.Exact
  let declaredMissingKind: EvidenceValueKind = EvidenceValueKind.Exact
  let effectiveTotal = 0
  let effectiveCount = 0
  let effectiveKind: EvidenceValueKind = EvidenceValueKind.Exact
  let effectiveMissingKind: EvidenceValueKind = EvidenceValueKind.Exact
  const positioned = position.value !== null && position.value !== "static"

  const add = (name: "inset-block-start" | "inset-block-end" | "transform" | "translate" | "top" | "bottom" | "margin-top" | "margin-bottom", sign: number, requiresPositioning: boolean): void => {
    const v = readNumeric(name)
    if (!v.present) return
    if (v.value === null) {
      declaredMissingKind = mergeEvidenceKind(declaredMissingKind, v.kind)
      if (requiresPositioning) effectiveMissingKind = mergeEvidenceKind(effectiveMissingKind, mergeEvidenceKind(v.kind, position.kind))
      if (!requiresPositioning) effectiveMissingKind = mergeEvidenceKind(effectiveMissingKind, v.kind)
      return
    }
    const signed = v.value * sign
    declaredTotal += signed
    declaredCount++
    declaredKind = mergeEvidenceKind(declaredKind, v.kind)
    const effectiveContributionKind = requiresPositioning ? mergeEvidenceKind(v.kind, position.kind) : v.kind
    if (requiresPositioning && !positioned) {
      effectiveMissingKind = mergeEvidenceKind(effectiveMissingKind, effectiveContributionKind)
      return
    }
    effectiveTotal += signed
    effectiveCount++
    effectiveKind = mergeEvidenceKind(effectiveKind, effectiveContributionKind)
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
    declared: { value: declaredCount === 0 ? null : declaredTotal, kind: declaredCount === 0 ? declaredMissingKind : declaredKind },
    effective: { value: effectiveCount === 0 ? null : effectiveTotal, kind: effectiveCount === 0 ? effectiveMissingKind : effectiveKind },
  }
}


// ══════════════════════════════════════════════════════════════════════════
// Measurement node (from cross-file/layout/measurement-node.ts)
// ══════════════════════════════════════════════════════════════════════════

interface MeasurementCandidateSet {
  readonly firstControlOrReplacedDescendant: ElementNode | null
  readonly firstTextualDescendant: ElementNode | null
}

const INHERENTLY_INLINE_TAGS = new Set(["a", "abbr", "acronym", "b", "bdo", "big", "br", "cite", "code", "dfn", "em", "i", "kbd", "label", "mark", "output", "q", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "data", "slot"])

export function buildMeasurementNodeIndex(
  elements: readonly ElementNode[],
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
): ReadonlyMap<string, ElementNode> {
  const candidateCache = new Map<number, MeasurementCandidateSet>()
  const measurementByRootKey = new Map<string, ElementNode>()

  for (let i = 0; i < elements.length; i++) {
    const root = elements[i]
    if (!root) continue
    const candidates = resolveMeasurementCandidates(root, childrenByParentId, snapshotByElementId, candidateCache)
    const measurement = resolveMeasurementNode(root, candidates)
    measurementByRootKey.set(root.key, measurement)
  }

  return measurementByRootKey
}

function measurementEstablishesFormattingContext(node: ElementNode, snapshotByElementId: ReadonlyMap<number, SignalSnapshot>): boolean {
  if (node.isReplaced) return true
  const snapshot = snapshotByElementId.get(node.elementId)
  if (snapshot) {
    const displaySignal = snapshot.signals.get("display")
    if (displaySignal && displaySignal.kind === SignalValueKind.Known) {
      const v = displaySignal.normalized.trim().toLowerCase()
      return v !== "inline" && v !== "contents"
    }
    const overflowSignal = snapshot.signals.get("overflow")
    if (overflowSignal && overflowSignal.kind === SignalValueKind.Known) {
      const ov = overflowSignal.normalized
      if (ov !== "visible" && ov !== "clip") return true
    }
    const overflowYSignal = snapshot.signals.get("overflow-y")
    if (overflowYSignal && overflowYSignal.kind === SignalValueKind.Known) {
      const ov = overflowYSignal.normalized
      if (ov !== "visible" && ov !== "clip") return true
    }
  }
  if (node.tagName === null) return true
  return !INHERENTLY_INLINE_TAGS.has(node.tagName)
}

function resolveMeasurementCandidates(
  root: ElementNode,
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
  cache: Map<number, MeasurementCandidateSet>,
): MeasurementCandidateSet {
  const existing = cache.get(root.elementId)
  if (existing) return existing
  const children = childrenByParentId.get(root.elementId) ?? []
  let firstControlOrReplacedDescendant: ElementNode | null = null
  let firstTextualDescendant: ElementNode | null = null

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (isLayoutHidden(child, snapshotByElementId)) continue
    if (firstControlOrReplacedDescendant === null && (child.isControl || child.isReplaced)) firstControlOrReplacedDescendant = child
    if (firstTextualDescendant === null && child.textualContent === TextualContentState.Yes) firstTextualDescendant = child
    if (firstControlOrReplacedDescendant !== null && firstTextualDescendant !== null) break
  }

  const firstChild = children.length === 1 ? children[0] : undefined
  if (firstChild && !measurementEstablishesFormattingContext(firstChild, snapshotByElementId)) {
    const childCandidates = resolveMeasurementCandidates(firstChild, childrenByParentId, snapshotByElementId, cache)
    if (firstControlOrReplacedDescendant === null) firstControlOrReplacedDescendant = childCandidates.firstControlOrReplacedDescendant
    if (firstTextualDescendant === null) firstTextualDescendant = childCandidates.firstTextualDescendant
  }

  const out: MeasurementCandidateSet = { firstControlOrReplacedDescendant, firstTextualDescendant }
  cache.set(root.elementId, out)
  return out
}

function resolveMeasurementNode(root: ElementNode, candidates: MeasurementCandidateSet): ElementNode {
  if (candidates.firstControlOrReplacedDescendant !== null) return candidates.firstControlOrReplacedDescendant
  if (root.isControl || root.isReplaced) return root
  if (candidates.firstTextualDescendant !== null) return candidates.firstTextualDescendant
  if (root.textualContent === TextualContentState.Yes) return root
  return root
}


// ══════════════════════════════════════════════════════════════════════════
// Content composition (from cross-file/layout/content-composition.ts)
// ══════════════════════════════════════════════════════════════════════════

const BLOCK_FORMATTING_CONTEXT_DISPLAYS: ReadonlySet<string> = new Set(["block", "flex", "grid", "table", "flow-root", "list-item"])
const INLINE_REPLACED_DISPLAYS: ReadonlySet<string> = new Set(["inline-flex", "inline-block", "inline-table", "inline-grid"])
const INLINE_CONTINUATION_DISPLAYS: ReadonlySet<string> = new Set(["inline", "contents"])
const HEIGHT_CONTRIBUTING_SIGNALS: readonly LayoutSignalName[] = ["height", "min-height", "padding-top", "padding-bottom", "border-top-width", "border-bottom-width"]
const VERTICAL_ALIGN_MITIGATIONS: ReadonlySet<string> = new Set(["middle", "top", "bottom", "text-top", "text-bottom"])

export const alignmentStrengthCalibration = {
  compositionMixedUnmitigatedOutlierStrength: 0.85,
  compositionMixedOutlierAmongReplacedStrength: 0.6,
  compositionTextOutlierAmongMixedStrength: 0.55,
  compositionUnknownPenalty: 0.4,
}

interface FingerprintWalkState {
  hasTextContent: boolean
  hasInlineReplaced: boolean
  inlineReplacedKind: InlineReplacedKind | null
  hasHeightContributingDescendant: boolean
  wrappingContextMitigates: boolean
  hasVerticalAlignMitigation: boolean
  mixedContentDepth: number
  analyzableChildCount: number
  totalChildCount: number
  blockChildCount: number
  inlineChildCount: number
}

export function computeContentCompositionFingerprint(
  elementNode: ElementNode,
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
  hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>,
): ContentCompositionFingerprint {
  const state: FingerprintWalkState = {
    hasTextContent: false, hasInlineReplaced: false, inlineReplacedKind: null,
    hasHeightContributingDescendant: false, wrappingContextMitigates: false,
    hasVerticalAlignMitigation: false, mixedContentDepth: 0,
    analyzableChildCount: 0, totalChildCount: 0, blockChildCount: 0, inlineChildCount: 0,
  }

  if (elementNode.textualContent === TextualContentState.Yes || elementNode.textualContent === TextualContentState.DynamicText) {
    state.hasTextContent = true
  }

  const elementHotSignals = hotSignalsByElementId.get(elementNode.elementId)
  const elementDisplay = elementHotSignals?.display.value ?? null

  if (elementDisplay !== null && !INLINE_CONTINUATION_DISPLAYS.has(elementDisplay)) {
    return {
      hasTextContent: state.hasTextContent, hasInlineReplaced: false, inlineReplacedKind: null,
      hasHeightContributingDescendant: false, wrappingContextMitigates: false, hasVerticalAlignMitigation: false,
      mixedContentDepth: 0, classification: ContentCompositionClassification.BlockSegmented,
      analyzableChildCount: 0, totalChildCount: 0, hasOnlyBlockChildren: false,
    }
  }

  walkInlineDescendants(elementNode, childrenByParentId, snapshotByElementId, hotSignalsByElementId, state, 0)

  const hasOnlyBlockChildren = state.analyzableChildCount > 0 && state.blockChildCount > 0 && state.inlineChildCount === 0
  const classification = classifyContentCompositionFromState(state, elementNode, hasOnlyBlockChildren)

  return {
    hasTextContent: state.hasTextContent, hasInlineReplaced: state.hasInlineReplaced,
    inlineReplacedKind: state.inlineReplacedKind, hasHeightContributingDescendant: state.hasHeightContributingDescendant,
    wrappingContextMitigates: state.wrappingContextMitigates, hasVerticalAlignMitigation: state.hasVerticalAlignMitigation,
    mixedContentDepth: state.mixedContentDepth, classification,
    analyzableChildCount: state.analyzableChildCount, totalChildCount: state.totalChildCount, hasOnlyBlockChildren,
  }
}

function walkInlineDescendants(
  node: ElementNode,
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
  hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>,
  state: FingerprintWalkState,
  depth: number,
): void {
  const children = childrenByParentId.get(node.elementId)
  if (!children) return

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (depth === 0) state.totalChildCount++
    const snapshot = snapshotByElementId.get(child.elementId)
    if (!snapshot) continue
    if (depth === 0) state.analyzableChildCount++

    const childTag = child.tagName?.toLowerCase() ?? null
    const hotSignals = hotSignalsByElementId.get(child.elementId)
    const childDisplay = hotSignals?.display.value ?? null

    if (childTag !== null && (INTRINSIC_REPLACED_TAGS.has(childTag) || CONTROL_ELEMENT_TAGS.has(childTag))) {
      state.hasInlineReplaced = true
      if (state.inlineReplacedKind === null) state.inlineReplacedKind = "intrinsic"
      else if (state.inlineReplacedKind !== "intrinsic") state.inlineReplacedKind = "intrinsic"
      checkHeightContributions(snapshot, state)
      checkVerticalAlignMitigation(snapshot, state)
      if (state.mixedContentDepth === 0 || depth + 1 < state.mixedContentDepth) state.mixedContentDepth = depth + 1
      if (depth === 0) state.inlineChildCount++

      const parentHotSignals = hotSignalsByElementId.get(node.elementId)
      const parentDisplay = parentHotSignals?.display.value ?? null
      if (parentDisplay !== null && isAlignmentContextWithNonBaselineAlignment(parentDisplay, parentHotSignals)) {
        state.wrappingContextMitigates = true
      } else if (childDisplay !== null && isAlignmentContextWithNonBaselineAlignment(childDisplay, hotSignals)
        && containsMixedContent(child, childrenByParentId, snapshotByElementId, hotSignalsByElementId)) {
        state.wrappingContextMitigates = true
      }
      continue
    }

    if (childDisplay !== null && BLOCK_FORMATTING_CONTEXT_DISPLAYS.has(childDisplay)) {
      if (depth === 0) state.blockChildCount++
      continue
    }

    if (childDisplay !== null && INLINE_REPLACED_DISPLAYS.has(childDisplay)) {
      state.hasInlineReplaced = true
      if (state.inlineReplacedKind === null) state.inlineReplacedKind = "container"
      checkHeightContributions(snapshot, state)
      checkVerticalAlignMitigation(snapshot, state)
      if (state.mixedContentDepth === 0 || depth + 1 < state.mixedContentDepth) state.mixedContentDepth = depth + 1
      if (depth === 0) state.inlineChildCount++

      const parentHotSignals = hotSignalsByElementId.get(node.elementId)
      const parentDisplay = parentHotSignals?.display.value ?? null
      if (parentDisplay !== null && isAlignmentContextWithNonBaselineAlignment(parentDisplay, parentHotSignals)) {
        state.wrappingContextMitigates = true
      } else if (isAlignmentContextWithNonBaselineAlignment(childDisplay, hotSignals)
        && containsMixedContent(child, childrenByParentId, snapshotByElementId, hotSignalsByElementId)) {
        state.wrappingContextMitigates = true
      }
      continue
    }

    if (child.textualContent === TextualContentState.Yes || child.textualContent === TextualContentState.DynamicText) {
      state.hasTextContent = true
    }
    checkHeightContributions(snapshot, state)
    if (depth === 0) state.inlineChildCount++

    if (childDisplay === null || INLINE_CONTINUATION_DISPLAYS.has(childDisplay)) {
      walkInlineDescendants(child, childrenByParentId, snapshotByElementId, hotSignalsByElementId, state, depth + 1)
    }
  }
}

function checkHeightContributions(snapshot: SignalSnapshot, state: FingerprintWalkState): void {
  for (let i = 0; i < HEIGHT_CONTRIBUTING_SIGNALS.length; i++) {
    const signalName = HEIGHT_CONTRIBUTING_SIGNALS[i]
    if (!signalName) continue
    const signal = snapshot.signals.get(signalName)
    if (!signal) continue
    if (signal.kind !== SignalValueKind.Known) continue
    if (signal.px !== null && signal.px > 0) { state.hasHeightContributingDescendant = true; return }
  }
}

function checkVerticalAlignMitigation(snapshot: SignalSnapshot, state: FingerprintWalkState): void {
  const verticalAlign = snapshot.signals.get("vertical-align")
  if (!verticalAlign) return
  if (verticalAlign.kind !== SignalValueKind.Known) return
  if (VERTICAL_ALIGN_MITIGATIONS.has(verticalAlign.normalized)) state.hasVerticalAlignMitigation = true
}

function isAlignmentContextWithNonBaselineAlignment(display: string, hotSignals: SnapshotHotSignals | undefined): boolean {
  if (display !== "flex" && display !== "inline-flex" && display !== "grid" && display !== "inline-grid") return false
  if (!hotSignals) return false
  const alignItems = hotSignals.alignItems.value
  if (alignItems === null) return false
  return alignItems !== "baseline"
}

function containsMixedContent(
  node: ElementNode,
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
  hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>,
): boolean {
  const hasText = node.textualContent === TextualContentState.Yes || node.textualContent === TextualContentState.DynamicText
  return scanMixedContent(node, childrenByParentId, snapshotByElementId, hotSignalsByElementId, { hasText, hasReplaced: false })
}

function scanMixedContent(
  node: ElementNode,
  childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>,
  snapshotByElementId: ReadonlyMap<number, SignalSnapshot>,
  hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>,
  found: { hasText: boolean; hasReplaced: boolean },
): boolean {
  const children = childrenByParentId.get(node.elementId)
  if (!children) return false
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    const childTag = child.tagName?.toLowerCase() ?? null
    const hotSignals = hotSignalsByElementId.get(child.elementId)
    const childDisplay = hotSignals?.display.value ?? null
    if (childTag !== null && (INTRINSIC_REPLACED_TAGS.has(childTag) || CONTROL_ELEMENT_TAGS.has(childTag))) {
      found.hasReplaced = true
      if (found.hasText) return true
      continue
    }
    if (childDisplay !== null && BLOCK_FORMATTING_CONTEXT_DISPLAYS.has(childDisplay)) continue
    if (childDisplay !== null && INLINE_REPLACED_DISPLAYS.has(childDisplay)) {
      found.hasReplaced = true
      if (found.hasText) return true
      continue
    }
    if (child.textualContent === TextualContentState.Yes || child.textualContent === TextualContentState.DynamicText) {
      found.hasText = true
      if (found.hasReplaced) return true
    }
    if (childDisplay === null || INLINE_CONTINUATION_DISPLAYS.has(childDisplay)) {
      if (scanMixedContent(child, childrenByParentId, snapshotByElementId, hotSignalsByElementId, found)) return true
    }
  }
  return false
}

function classifyContentCompositionFromState(state: FingerprintWalkState, elementNode: ElementNode, hasOnlyBlockChildren: boolean): ContentCompositionClassification {
  if (hasOnlyBlockChildren) return ContentCompositionClassification.BlockSegmented
  if (state.totalChildCount === 0 && !state.hasTextContent) {
    if (elementNode.textualContent === TextualContentState.Unknown) return ContentCompositionClassification.Unknown
    if (elementNode.textualContent === TextualContentState.Yes || elementNode.textualContent === TextualContentState.DynamicText) return ContentCompositionClassification.TextOnly
    return ContentCompositionClassification.Unknown
  }
  if (state.analyzableChildCount === 0 && state.totalChildCount > 0) return ContentCompositionClassification.Unknown
  if (state.hasTextContent && state.hasInlineReplaced) {
    if (state.wrappingContextMitigates) return ContentCompositionClassification.MixedMitigated
    if (state.hasVerticalAlignMitigation) return ContentCompositionClassification.MixedMitigated
    return ContentCompositionClassification.MixedUnmitigated
  }
  if (!state.hasTextContent && state.hasInlineReplaced) return ContentCompositionClassification.ReplacedOnly
  if (state.hasTextContent && !state.hasInlineReplaced) return ContentCompositionClassification.TextOnly
  return ContentCompositionClassification.Unknown
}


// ══════════════════════════════════════════════════════════════════════════
// Cohort index (from cross-file/layout/cohort-index.ts)
// ══════════════════════════════════════════════════════════════════════════

interface CohortMetrics {
  readonly key: string
  readonly element: AlignmentElementEvidence
  readonly measurementNode: ElementNode
  readonly rootNode: ElementNode
  readonly hotSignals: SnapshotHotSignals
  readonly declaredOffset: NumericEvidenceValue
  readonly effectiveOffset: NumericEvidenceValue
  readonly lineHeight: NumericEvidenceValue
}

interface CohortProfileBuffers {
  readonly declaredOffsets: number[]
  readonly effectiveOffsets: number[]
  readonly lineHeights: number[]
  readonly deviationScratch: number[]
  readonly baselineDeclaredValues: (number | null)[]
  readonly baselineEffectiveValues: (number | null)[]
  readonly baselineLineHeightValues: (number | null)[]
  readonly baselineDeclaredSorted: number[]
  readonly baselineEffectiveSorted: number[]
  readonly baselineLineHeightSorted: number[]
}

interface ComparableClusterSummary {
  readonly comparableCount: number
  readonly clusterCount: number
  readonly dominantClusterSize: number
  readonly dominantClusterCount: number
  readonly clusterSizeByKey: ReadonlyMap<string, number>
}

interface CohortSignalAggregate {
  readonly mergedKind: EvidenceValueKind
  readonly comparableCount: number
  readonly countsByValue: ReadonlyMap<string, number>
}

interface CohortSignalsByElement {
  readonly verticalAlign: SnapshotHotSignals["verticalAlign"]
  readonly alignSelf: SnapshotHotSignals["alignSelf"]
  readonly placeSelf: SnapshotHotSignals["placeSelf"]
  readonly textualContent: TextualContentState
  readonly isControlOrReplaced: boolean
}

interface CohortSignalIndex {
  readonly byKey: ReadonlyMap<string, CohortSignalsByElement>
  readonly verticalAlign: CohortSignalAggregate
  readonly alignSelf: CohortSignalAggregate
  readonly placeSelf: CohortSignalAggregate
  readonly controlOrReplacedCount: number
  readonly textYesCount: number
  readonly textNoCount: number
  readonly textUnknownCount: number
}

export interface CohortIndex {
  readonly statsByParentId: ReadonlyMap<number, CohortStats>
  readonly verticalAlignConsensusByParentId: ReadonlyMap<number, string | null>
  readonly conditionalSignals: number
  readonly totalSignals: number
  readonly unimodalFalseCount: number
}

export function buildCohortIndex(input: {
  readonly childrenByParentId: ReadonlyMap<number, readonly ElementNode[]>
  readonly contextByParentId: ReadonlyMap<number, AlignmentContext>
  readonly measurementNodeByRootKey: ReadonlyMap<string, ElementNode>
  readonly snapshotByElementId: ReadonlyMap<number, SignalSnapshot>
  readonly hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>
}): CohortIndex {
  const statsByParentId = new Map<number, CohortStats>()
  const verticalAlignConsensusByParentId = new Map<number, string | null>()
  const profileBuffers = createCohortProfileBuffers()

  let conditionalSignals = 0
  let totalSignals = 0
  let unimodalFalseCount = 0

  for (const [parentId, children] of input.childrenByParentId) {
    if (children.length < 2) continue
    const context = input.contextByParentId.get(parentId)
    if (!context) continue

    const cohortMetricsResult = collectCohortMetrics({
      children,
      axis: context.axis,
      axisCertainty: context.axisCertainty,
      measurementNodeByRootKey: input.measurementNodeByRootKey,
      snapshotByElementId: input.snapshotByElementId,
      hotSignalsByElementId: input.hotSignalsByElementId,
    })

    const metrics = cohortMetricsResult.metrics
    if (metrics.length < 2) continue

    const clusterSummary = summarizeComparableClusters(metrics)
    const profile = buildCohortProfile(metrics, profileBuffers, clusterSummary)
    const baselineProfiles = buildSubjectBaselineProfiles(metrics, profile, clusterSummary, profileBuffers)
    const signalIndex = buildCohortSignalIndex(metrics)
    const cohortEvidenceKind = resolveCohortEvidenceKind(metrics)
    const snapshots = collectCohortSnapshots(metrics)
    const factSummary = summarizeSignalFacts(snapshots)
    const provenance = collectCohortProvenanceFromSnapshots(snapshots)
    const counts = collectConditionalSignalCounts(snapshots)
    const subjectsByElementKey = new Map<string, CohortSubjectStats>()

    for (let i = 0; i < metrics.length; i++) {
      const subjectMetrics = metrics[i]
      if (!subjectMetrics) continue
      const signals = collectSubjectCohortSignals(signalIndex, subjectMetrics, context)
      const baselineProfile = baselineProfiles[i]
      if (!baselineProfile) continue
      const identifiability = resolveSubjectIdentifiability(subjectMetrics, profile, baselineProfile, clusterSummary, signalIndex, cohortEvidenceKind, metrics.length)
      const contentComposition = computeContentCompositionFingerprint(subjectMetrics.rootNode, input.childrenByParentId, input.snapshotByElementId, input.hotSignalsByElementId)

      subjectsByElementKey.set(subjectMetrics.key, {
        element: subjectMetrics.element,
        declaredOffset: subjectMetrics.declaredOffset,
        effectiveOffset: subjectMetrics.effectiveOffset,
        lineHeight: subjectMetrics.lineHeight,
        baselineProfile,
        signals,
        identifiability,
        contentComposition,
      })
    }

    statsByParentId.set(parentId, {
      profile, snapshots, factSummary, provenance,
      conditionalSignalCount: counts.conditional,
      totalSignalCount: counts.total,
      subjectsByElementKey,
      excludedElementKeys: cohortMetricsResult.excludedElementKeys,
    })

    verticalAlignConsensusByParentId.set(parentId, resolveVerticalAlignConsensus(signalIndex.verticalAlign))
    conditionalSignals += counts.conditional
    totalSignals += counts.total
    if (!profile.unimodal) unimodalFalseCount++
  }

  return { statsByParentId, verticalAlignConsensusByParentId, conditionalSignals, totalSignals, unimodalFalseCount }
}

function isUnconditionallyOutOfFlow(snapshot: SignalSnapshot): boolean {
  const position = readKnownNormalized(snapshot, "position")
  return position === "absolute" || position === "fixed"
}

function collectCohortMetrics(input: {
  readonly children: readonly ElementNode[]
  readonly axis: LayoutAxisModel
  readonly axisCertainty: ContextCertainty
  readonly measurementNodeByRootKey: ReadonlyMap<string, ElementNode>
  readonly snapshotByElementId: ReadonlyMap<number, SignalSnapshot>
  readonly hotSignalsByElementId: ReadonlyMap<number, SnapshotHotSignals>
}): { readonly metrics: readonly CohortMetrics[]; readonly excludedElementKeys: ReadonlySet<string> } {
  const out: CohortMetrics[] = []
  const excluded = new Set<string>()
  const axisKind = toContextCertaintyEvidenceKind(input.axisCertainty)

  for (let i = 0; i < input.children.length; i++) {
    const node = input.children[i]
    if (!node) continue
    if (isLayoutHidden(node, input.snapshotByElementId)) { excluded.add(node.key); continue }
    const childSnapshot = input.snapshotByElementId.get(node.elementId)
    if (childSnapshot && isUnconditionallyOutOfFlow(childSnapshot)) { excluded.add(node.key); continue }

    const measurementNode = input.measurementNodeByRootKey.get(node.key)
    if (!measurementNode) continue
    const snapshot = input.snapshotByElementId.get(measurementNode.elementId)
    if (!snapshot) continue
    const hotSignals = input.hotSignalsByElementId.get(measurementNode.elementId)
    if (!hotSignals) continue

    const element: AlignmentElementEvidence = {
      solidFile: measurementNode.solidFile, elementKey: measurementNode.key,
      elementId: measurementNode.elementId, tag: measurementNode.tag, snapshot,
    }

    const offset = estimateBlockOffsetWithDeclaredFromHotSignals(hotSignals, input.axis)
    out.push({
      key: element.elementKey, element, measurementNode, rootNode: node, hotSignals,
      declaredOffset: { value: offset.declared.value, kind: mergeEvidenceKind(offset.declared.kind, axisKind) },
      effectiveOffset: { value: offset.effective.value, kind: mergeEvidenceKind(offset.effective.kind, axisKind) },
      lineHeight: hotSignals.lineHeight,
    })
  }
  return { metrics: out, excludedElementKeys: excluded }
}

function toContextCertaintyEvidenceKind(certainty: ContextCertainty): EvidenceValueKind {
  if (certainty === ContextCertainty.Resolved) return EvidenceValueKind.Exact
  if (certainty === ContextCertainty.Conditional) return EvidenceValueKind.Conditional
  return EvidenceValueKind.Unknown
}

function createCohortProfileBuffers(): CohortProfileBuffers {
  return {
    declaredOffsets: [], effectiveOffsets: [], lineHeights: [], deviationScratch: [],
    baselineDeclaredValues: [], baselineEffectiveValues: [], baselineLineHeightValues: [],
    baselineDeclaredSorted: [], baselineEffectiveSorted: [], baselineLineHeightSorted: [],
  }
}

function summarizeComparableClusters(metrics: readonly CohortMetrics[]): ComparableClusterSummary {
  const clusterSizeByKey = new Map<string, number>()
  let comparableCount = 0
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i]
    if (!metric) continue
    const key = toComparableClusterKey(metric)
    if (key === null) continue
    comparableCount++
    clusterSizeByKey.set(key, (clusterSizeByKey.get(key) ?? 0) + 1)
  }
  let dominantClusterSize = 0
  let dominantClusterCount = 0
  for (const size of clusterSizeByKey.values()) {
    if (size > dominantClusterSize) { dominantClusterSize = size; dominantClusterCount = 1; continue }
    if (size === dominantClusterSize) dominantClusterCount++
  }
  return { comparableCount, clusterCount: clusterSizeByKey.size, dominantClusterSize, dominantClusterCount, clusterSizeByKey }
}

function toComparableClusterKey(metric: CohortMetrics): string | null {
  const effectiveOffset = toComparableExactValue(metric.effectiveOffset)
  const lineHeight = toComparableExactValue(metric.lineHeight)
  if (effectiveOffset === null || lineHeight === null) return null
  return `${effectiveOffset}|${lineHeight}`
}

function buildCohortProfile(metrics: readonly CohortMetrics[], buffers: CohortProfileBuffers, clusterSummary: ComparableClusterSummary): CohortProfile {
  buffers.declaredOffsets.length = 0; buffers.effectiveOffsets.length = 0; buffers.lineHeights.length = 0
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i]; if (!m) continue
    const d = toComparableExactValue(m.declaredOffset); const e = toComparableExactValue(m.effectiveOffset); const l = toComparableExactValue(m.lineHeight)
    if (d !== null) buffers.declaredOffsets.push(d); if (e !== null) buffers.effectiveOffsets.push(e); if (l !== null) buffers.lineHeights.push(l)
  }
  const medianDeclaredOffsetPx = computeMedian(buffers.declaredOffsets)
  const declaredOffsetDispersionPx = computeMAD(buffers.declaredOffsets, medianDeclaredOffsetPx, buffers.deviationScratch)
  const medianEffectiveOffsetPx = computeMedian(buffers.effectiveOffsets)
  const effectiveOffsetDispersionPx = computeMAD(buffers.effectiveOffsets, medianEffectiveOffsetPx, buffers.deviationScratch)
  const medianLineHeightPx = computeMedian(buffers.lineHeights)
  const lineHeightDispersionPx = computeMAD(buffers.lineHeights, medianLineHeightPx, buffers.deviationScratch)
  const dominantClusterShare = clusterSummary.comparableCount === 0 ? 0 : clusterSummary.dominantClusterSize / clusterSummary.comparableCount
  return { medianDeclaredOffsetPx, declaredOffsetDispersionPx, medianEffectiveOffsetPx, effectiveOffsetDispersionPx, medianLineHeightPx, lineHeightDispersionPx, dominantClusterSize: clusterSummary.dominantClusterSize, dominantClusterShare, unimodal: clusterSummary.clusterCount <= 1 }
}

function buildSubjectBaselineProfiles(metrics: readonly CohortMetrics[], profile: CohortProfile, clusterSummary: ComparableClusterSummary, buffers: CohortProfileBuffers): readonly CohortProfile[] {
  collectComparableValuesInto(metrics, "declared", buffers.baselineDeclaredValues)
  collectComparableValuesInto(metrics, "effective", buffers.baselineEffectiveValues)
  collectComparableValuesInto(metrics, "line-height", buffers.baselineLineHeightValues)
  const declaredSorted = toSortedComparableValuesInto(buffers.baselineDeclaredValues, buffers.baselineDeclaredSorted)
  const effectiveSorted = toSortedComparableValuesInto(buffers.baselineEffectiveValues, buffers.baselineEffectiveSorted)
  const lineHeightSorted = toSortedComparableValuesInto(buffers.baselineLineHeightValues, buffers.baselineLineHeightSorted)
  const topClusters = resolveTopClusterSizes(clusterSummary)
  const out: CohortProfile[] = []
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i]; if (!m) continue
    const clusterKey = toComparableClusterKey(m)
    const cluster = resolveClusterSummaryExcluding(clusterSummary, topClusters, clusterKey)
    out.push({
      medianDeclaredOffsetPx: resolveMedianExcluding(declaredSorted, buffers.baselineDeclaredValues[i] ?? null),
      declaredOffsetDispersionPx: profile.declaredOffsetDispersionPx,
      medianEffectiveOffsetPx: resolveMedianExcluding(effectiveSorted, buffers.baselineEffectiveValues[i] ?? null),
      effectiveOffsetDispersionPx: profile.effectiveOffsetDispersionPx,
      medianLineHeightPx: resolveMedianExcluding(lineHeightSorted, buffers.baselineLineHeightValues[i] ?? null),
      lineHeightDispersionPx: profile.lineHeightDispersionPx,
      dominantClusterSize: cluster.dominantClusterSize,
      dominantClusterShare: cluster.dominantClusterShare,
      unimodal: cluster.unimodal,
    })
  }
  return out
}

type ComparableValueKind = "declared" | "effective" | "line-height"
function collectComparableValuesInto(metrics: readonly CohortMetrics[], kind: ComparableValueKind, out: (number | null)[]): void {
  out.length = 0
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i]; if (!m) continue
    if (kind === "declared") { out.push(toComparableExactValue(m.declaredOffset)); continue }
    if (kind === "effective") { out.push(toComparableExactValue(m.effectiveOffset)); continue }
    out.push(toComparableExactValue(m.lineHeight))
  }
}
function toSortedComparableValuesInto(values: readonly (number | null)[], out: number[]): readonly number[] {
  out.length = 0
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v !== null && v !== undefined) out.push(v) }
  out.sort((a, b) => a - b)
  return out
}
function resolveMedianExcluding(sorted: readonly number[], excluded: number | null): number | null {
  if (excluded === null) return medianOfSorted(sorted)
  if (sorted.length <= 1) return null
  const size = sorted.length - 1; const middle = Math.floor((size - 1) / 2)
  const lower = resolveValueAtIndexExcluding(sorted, middle, excluded)
  if (size % 2 === 1) return lower
  return (lower + resolveValueAtIndexExcluding(sorted, middle + 1, excluded)) / 2
}
function medianOfSorted(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor((sorted.length - 1) / 2)
  const v = sorted[mid]; if (v === undefined) return null
  if (sorted.length % 2 === 1) return v
  const next = sorted[mid + 1]; if (next === undefined) return null
  return (v + next) / 2
}
function resolveValueAtIndexExcluding(sorted: readonly number[], index: number, excluded: number): number {
  const removedIndex = lowerBound(sorted, excluded)
  const effectiveIndex = index < removedIndex ? index : index + 1
  return sorted[effectiveIndex] ?? 0
}
function lowerBound(sorted: readonly number[], target: number): number {
  let low = 0; let high = sorted.length
  while (low < high) { const mid = Math.floor((low + high) / 2); const v = sorted[mid]; if (v !== undefined && v < target) { low = mid + 1; continue } high = mid }
  return low
}
interface TopClusterSizes { readonly largest: number; readonly largestCount: number; readonly secondLargest: number }
function resolveTopClusterSizes(summary: ComparableClusterSummary): TopClusterSizes {
  let largest = 0; let largestCount = 0; let secondLargest = 0
  for (const size of summary.clusterSizeByKey.values()) {
    if (size > largest) { secondLargest = largest; largest = size; largestCount = 1; continue }
    if (size === largest) { largestCount++; continue }
    if (size > secondLargest) secondLargest = size
  }
  return { largest, largestCount, secondLargest }
}
function resolveClusterSummaryExcluding(summary: ComparableClusterSummary, top: TopClusterSizes, excludedClusterKey: string | null): { readonly dominantClusterSize: number; readonly dominantClusterShare: number; readonly unimodal: boolean } {
  if (excludedClusterKey === null) return { dominantClusterSize: summary.dominantClusterSize, dominantClusterShare: summary.comparableCount === 0 ? 0 : summary.dominantClusterSize / summary.comparableCount, unimodal: summary.clusterCount <= 1 }
  const excludedSize = summary.clusterSizeByKey.get(excludedClusterKey)
  if (excludedSize === undefined || excludedSize <= 0) return { dominantClusterSize: summary.dominantClusterSize, dominantClusterShare: summary.comparableCount === 0 ? 0 : summary.dominantClusterSize / summary.comparableCount, unimodal: summary.clusterCount <= 1 }
  const comparableCount = summary.comparableCount - 1
  if (comparableCount <= 0) return { dominantClusterSize: 0, dominantClusterShare: 0, unimodal: true }
  const clusterCount = excludedSize === 1 ? summary.clusterCount - 1 : summary.clusterCount
  const reducedSize = excludedSize - 1
  if (excludedSize < top.largest) return { dominantClusterSize: top.largest, dominantClusterShare: top.largest / comparableCount, unimodal: clusterCount <= 1 }
  if (excludedSize > top.largest) return { dominantClusterSize: reducedSize, dominantClusterShare: reducedSize / comparableCount, unimodal: clusterCount <= 1 }
  if (top.largestCount > 1) return { dominantClusterSize: top.largest, dominantClusterShare: top.largest / comparableCount, unimodal: clusterCount <= 1 }
  const dominant = top.secondLargest > reducedSize ? top.secondLargest : reducedSize
  return { dominantClusterSize: dominant, dominantClusterShare: dominant / comparableCount, unimodal: clusterCount <= 1 }
}
function buildCohortSignalIndex(metrics: readonly CohortMetrics[]): CohortSignalIndex {
  const byKey = new Map<string, CohortSignalsByElement>()
  const verticalAlignCounts = new Map<string, number>(); const alignSelfCounts = new Map<string, number>(); const placeSelfCounts = new Map<string, number>()
  let verticalAlignMergedKind: EvidenceValueKind = EvidenceValueKind.Exact; let alignSelfMergedKind: EvidenceValueKind = EvidenceValueKind.Exact; let placeSelfMergedKind: EvidenceValueKind = EvidenceValueKind.Exact
  let verticalAlignComparableCount = 0; let alignSelfComparableCount = 0; let placeSelfComparableCount = 0; let controlOrReplacedCount = 0; let textYesCount = 0; let textNoCount = 0; let textUnknownCount = 0
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i]; if (!m) continue
    const rootNode = m.rootNode; const isControlOrReplaced = rootNode.isControl || rootNode.isReplaced
    const verticalAlign = resolveComparableVerticalAlign(m.hotSignals.verticalAlign, isControlOrReplaced)
    if (isControlOrReplaced) controlOrReplacedCount++
    if (rootNode.textualContent === TextualContentState.Yes || rootNode.textualContent === TextualContentState.DynamicText) textYesCount++
    if (rootNode.textualContent === TextualContentState.No) textNoCount++
    if (rootNode.textualContent === TextualContentState.Unknown) textUnknownCount++
    if (verticalAlign.value !== null) { verticalAlignMergedKind = mergeEvidenceKind(verticalAlignMergedKind, verticalAlign.kind); verticalAlignComparableCount++; incrementCount(verticalAlignCounts, verticalAlign.value) }
    if (m.hotSignals.alignSelf.value !== null) { alignSelfMergedKind = mergeEvidenceKind(alignSelfMergedKind, m.hotSignals.alignSelf.kind); alignSelfComparableCount++; incrementCount(alignSelfCounts, m.hotSignals.alignSelf.value) }
    if (m.hotSignals.placeSelf.value !== null) { placeSelfMergedKind = mergeEvidenceKind(placeSelfMergedKind, m.hotSignals.placeSelf.kind); placeSelfComparableCount++; incrementCount(placeSelfCounts, m.hotSignals.placeSelf.value) }
    byKey.set(m.key, { verticalAlign, alignSelf: m.hotSignals.alignSelf, placeSelf: m.hotSignals.placeSelf, textualContent: rootNode.textualContent, isControlOrReplaced })
  }
  return {
    byKey,
    verticalAlign: { mergedKind: verticalAlignComparableCount === 0 ? EvidenceValueKind.Unknown : verticalAlignMergedKind, comparableCount: verticalAlignComparableCount, countsByValue: verticalAlignCounts },
    alignSelf: { mergedKind: alignSelfComparableCount === 0 ? EvidenceValueKind.Unknown : alignSelfMergedKind, comparableCount: alignSelfComparableCount, countsByValue: alignSelfCounts },
    placeSelf: { mergedKind: placeSelfComparableCount === 0 ? EvidenceValueKind.Unknown : placeSelfMergedKind, comparableCount: placeSelfComparableCount, countsByValue: placeSelfCounts },
    controlOrReplacedCount, textYesCount, textNoCount, textUnknownCount,
  }
}
function resolveComparableVerticalAlign(va: SnapshotHotSignals["verticalAlign"], isControlOrReplaced: boolean): SnapshotHotSignals["verticalAlign"] {
  if (va.value !== null) return va
  if (!isControlOrReplaced) return va
  return { present: va.present, value: "baseline", kind: EvidenceValueKind.Exact }
}
function collectSubjectCohortSignals(index: CohortSignalIndex, subjectMetrics: CohortMetrics, context: AlignmentContext): AlignmentCohortSignals {
  const subject = index.byKey.get(subjectMetrics.key)
  if (!subject) throw new Error(`missing cohort signal entry for ${subjectMetrics.key}`)
  const verticalAlignKind = subject.verticalAlign.value !== null ? index.verticalAlign.mergedKind : subject.verticalAlign.kind
  const alignSelfKind = subject.alignSelf.value !== null ? index.alignSelf.mergedKind : subject.alignSelf.kind
  const placeSelfKind = subject.placeSelf.value !== null ? index.placeSelf.mergedKind : subject.placeSelf.kind
  const hasControlOrReplacedPeer = index.controlOrReplacedCount - (subject.isControlOrReplaced ? 1 : 0) > 0
  const verticalAlign = finalizeConflictEvidence(subject.verticalAlign.value, verticalAlignKind, hasComparablePeer(index.verticalAlign, subject.verticalAlign.value), hasConflictPeer(index.verticalAlign, subject.verticalAlign.value))
  const tableCellControlFallback = context.kind === "table-cell" && subject.isControlOrReplaced && verticalAlign.value === SignalConflictValue.Unknown && index.byKey.size > index.controlOrReplacedCount
  const normalizedVerticalAlign: SignalConflictEvidence = tableCellControlFallback ? { value: SignalConflictValue.Conflict, kind: verticalAlignKind } : verticalAlign
  const textContrastWithPeers = resolveIndexedTextContrastWithPeers(index, subject.textualContent, subject.isControlOrReplaced, tableCellControlFallback)
  return {
    verticalAlign: normalizedVerticalAlign,
    alignSelf: finalizeConflictEvidence(subject.alignSelf.value, alignSelfKind, hasComparablePeer(index.alignSelf, subject.alignSelf.value), hasConflictPeer(index.alignSelf, subject.alignSelf.value)),
    placeSelf: finalizeConflictEvidence(subject.placeSelf.value, placeSelfKind, hasComparablePeer(index.placeSelf, subject.placeSelf.value), hasConflictPeer(index.placeSelf, subject.placeSelf.value)),
    hasControlOrReplacedPeer,
    textContrastWithPeers,
  }
}
function hasComparablePeer(agg: CohortSignalAggregate, subjectValue: string | null): boolean { return subjectValue !== null && agg.comparableCount - 1 > 0 }
function hasConflictPeer(agg: CohortSignalAggregate, subjectValue: string | null): boolean { if (subjectValue === null) return false; const peers = agg.comparableCount - 1; if (peers <= 0) return false; return peers > ((agg.countsByValue.get(subjectValue) ?? 0) - 1) }
function finalizeConflictEvidence(subjectValue: string | null, kind: EvidenceValueKind, sawPeer: boolean, sawConflict: boolean): SignalConflictEvidence {
  if (subjectValue === null || !sawPeer) return { value: SignalConflictValue.Unknown, kind }
  return { value: sawConflict ? SignalConflictValue.Conflict : SignalConflictValue.Aligned, kind }
}
function resolveIndexedTextContrastWithPeers(index: CohortSignalIndex, textualContent: TextualContentState, isControlOrReplaced: boolean, tableCellControlFallback: boolean): AlignmentTextContrast {
  if (textualContent === TextualContentState.Unknown) return AlignmentTextContrast.Unknown
  if (textualContent === TextualContentState.Yes || textualContent === TextualContentState.DynamicText) {
    if (index.textNoCount > 0) return AlignmentTextContrast.Different
    if (index.textUnknownCount > 0) return AlignmentTextContrast.Unknown
    return AlignmentTextContrast.Same
  }
  if (index.textYesCount > 0) return AlignmentTextContrast.Different
  if (tableCellControlFallback) return AlignmentTextContrast.Different
  if (isControlOrReplaced && index.controlOrReplacedCount === 1 && index.byKey.size >= 3 && index.textUnknownCount > 0) return AlignmentTextContrast.Different
  if (index.textUnknownCount > 0) return AlignmentTextContrast.Unknown
  return AlignmentTextContrast.Same
}
function resolveSubjectIdentifiability(subjectMetrics: CohortMetrics, profile: CohortProfile, subjectBaselineProfile: CohortProfile, clusterSummary: ComparableClusterSummary, signalIndex: CohortSignalIndex, cohortKind: EvidenceValueKind, cohortSize: number): CohortIdentifiability {
  const subjectClusterKey = toComparableClusterKey(subjectMetrics)
  if (subjectClusterKey === null) {
    const roleFallback = resolveControlRoleIdentifiability(subjectMetrics, signalIndex, cohortKind, cohortSize)
    if (roleFallback !== null) return roleFallback
    return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Insufficient, ambiguous: true, kind: cohortKind }
  }
  if (cohortSize <= 2) return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Dominant, ambiguous: false, kind: cohortKind }
  if (clusterSummary.comparableCount < 2 || clusterSummary.clusterCount === 0) return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Insufficient, ambiguous: true, kind: cohortKind }
  const subjectClusterSize = clusterSummary.clusterSizeByKey.get(subjectClusterKey)
  if (subjectClusterSize === undefined || subjectClusterSize <= 0) return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Insufficient, ambiguous: true, kind: cohortKind }
  const ambiguous = clusterSummary.dominantClusterCount > 1 && subjectClusterSize === clusterSummary.dominantClusterSize
  if (ambiguous) return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Ambiguous, ambiguous: true, kind: cohortKind }
  if (subjectClusterSize >= clusterSummary.dominantClusterSize) return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Dominant, ambiguous: false, kind: cohortKind }
  return { dominantShare: profile.dominantClusterShare, subjectExcludedDominantShare: subjectBaselineProfile.dominantClusterShare, subjectMembership: CohortSubjectMembership.Nondominant, ambiguous: false, kind: cohortKind }
}
function resolveControlRoleIdentifiability(subjectMetrics: CohortMetrics, signalIndex: CohortSignalIndex, kind: EvidenceValueKind, cohortSize: number): CohortIdentifiability | null {
  const isCtrl = subjectMetrics.rootNode.isControl || subjectMetrics.rootNode.isReplaced
  const ctrlCount = signalIndex.controlOrReplacedCount; const nonCtrlCount = cohortSize - ctrlCount
  if (ctrlCount <= 0 || nonCtrlCount <= 0) return null
  const dominantShare = Math.max(ctrlCount, nonCtrlCount) / cohortSize
  const ctrlAfter = ctrlCount - (isCtrl ? 1 : 0); const nonCtrlAfter = nonCtrlCount - (isCtrl ? 0 : 1); const totalAfter = ctrlAfter + nonCtrlAfter
  const excludedDominantShare = totalAfter <= 0 ? 0 : Math.max(ctrlAfter, nonCtrlAfter) / totalAfter
  const membership = ctrlCount === nonCtrlCount ? CohortSubjectMembership.Ambiguous : (ctrlCount > nonCtrlCount) === isCtrl ? CohortSubjectMembership.Dominant : CohortSubjectMembership.Nondominant
  if (cohortSize <= 2) return { dominantShare, subjectExcludedDominantShare: excludedDominantShare, subjectMembership: membership === CohortSubjectMembership.Ambiguous ? CohortSubjectMembership.Dominant : membership, ambiguous: false, kind }
  if (membership === CohortSubjectMembership.Ambiguous) return { dominantShare, subjectExcludedDominantShare: excludedDominantShare, subjectMembership: membership, ambiguous: true, kind }
  return { dominantShare, subjectExcludedDominantShare: excludedDominantShare, subjectMembership: membership, ambiguous: false, kind }
}
function collectConditionalSignalCounts(snapshots: readonly SignalSnapshot[]): { readonly conditional: number; readonly total: number } {
  let conditional = 0; let total = 0
  for (let i = 0; i < snapshots.length; i++) { const s = snapshots[i]; if (!s) continue; conditional += s.conditionalSignalCount; total += s.knownSignalCount + s.unknownSignalCount + s.conditionalSignalCount }
  return { conditional, total }
}
function collectCohortSnapshots(metrics: readonly CohortMetrics[]): readonly SignalSnapshot[] {
  const out: SignalSnapshot[] = []
  for (let i = 0; i < metrics.length; i++) { const m = metrics[i]; if (!m) continue; out.push(m.element.snapshot) }
  return out
}
function collectCohortProvenanceFromSnapshots(snapshots: readonly SignalSnapshot[]): EvidenceProvenance {
  const byKey = new Map<string, GuardConditionProvenance>()
  for (let i = 0; i < snapshots.length; i++) { const s = snapshots[i]; if (!s) continue; for (const signal of s.signals.values()) { for (let j = 0; j < signal.guard.conditions.length; j++) { const g = signal.guard.conditions[j]; if (!g) continue; if (!byKey.has(g.key)) byKey.set(g.key, g) } } }
  const guards = [...byKey.values()]; guards.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const guardKey = guards.length === 0 ? "always" : guards.map(g => g.key).join("&")
  return { reason: "cohort-derived alignment evidence", guardKey, guards }
}
function resolveCohortEvidenceKind(metrics: readonly CohortMetrics[]): EvidenceValueKind {
  let kind: EvidenceValueKind = EvidenceValueKind.Exact
  for (let i = 0; i < metrics.length; i++) { const m = metrics[i]; if (!m) continue; kind = mergeEvidenceKind(kind, mergeEvidenceKind(m.effectiveOffset.kind, m.lineHeight.kind)) }
  return kind
}
function incrementCount(counts: Map<string, number>, key: string): void { counts.set(key, (counts.get(key) ?? 0) + 1) }
function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const mid = Math.floor((values.length - 1) / 2)
  const lower = selectKth(values, mid)
  if (values.length % 2 === 1) return lower
  return (lower + selectKth(values, mid + 1)) / 2
}
function computeMAD(values: readonly number[], median: number | null, scratch: number[]): number | null {
  if (median === null || values.length === 0) return null
  scratch.length = 0
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v === undefined) continue; scratch.push(Math.abs(v - median)) }
  return computeMedian(scratch)
}
function resolveVerticalAlignConsensus(aggregate: CohortSignalAggregate): string | null {
  if (aggregate.comparableCount === 0) return null
  if (aggregate.countsByValue.size !== 1) return null
  const firstEntry = aggregate.countsByValue.entries().next()
  if (firstEntry.done) return null
  return firstEntry.value[0]
}


// ══════════════════════════════════════════════════════════════════════════
// Rule kit (from cross-file/layout/rule-kit.ts)
// ══════════════════════════════════════════════════════════════════════════

export type AlignmentFactorId =
  | "offset-delta"
  | "declared-offset-delta"
  | "baseline-conflict"
  | "context-conflict"
  | "replaced-control-risk"
  | "content-composition-conflict"
  | "context-certainty"

export interface LayoutEvidence {
  readonly severity: number
  readonly confidence: number
  readonly causes: readonly string[]
  readonly primaryFix: string
  readonly contextKind: AlignmentContextKind
  readonly contextCertainty: ContextCertainty
  readonly estimatedOffsetPx: number | null
  readonly decisionReason: "accepted-lower-bound"
  readonly posteriorLower: number
  readonly posteriorUpper: number
  readonly evidenceMass: number
  readonly topFactors: readonly AlignmentFactorId[]
}

export type LayoutEvaluationResult =
  | {
    readonly kind: "accept"
    readonly evidence: LayoutEvidence
  }
  | {
    readonly kind: "reject"
    readonly reason: "low-evidence" | "threshold" | "undecidable"
    readonly detail?: "evidence-mass" | "posterior" | "interval" | "identifiability"
    readonly posteriorLower: number
    readonly posteriorUpper: number
    readonly evidenceMass: number
  }

export interface LayoutDetection<TCase> {
  readonly caseData: TCase
  readonly evidence: LayoutEvidence
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function collectAlignmentCases<TCase>(
  collect: () => readonly TCase[],
): readonly TCase[] {
  return collect()
}

export function evaluateAlignmentCase<TCase>(
  caseData: TCase,
  evaluate: (input: TCase) => LayoutEvaluationResult,
): LayoutDetection<TCase> | null {
  const result = evaluate(caseData)
  if (result.kind === "accept") {
    return { caseData, evidence: result.evidence }
  }
  return null
}

export function runAlignmentDetector<TCase>(
  cases: readonly TCase[],
  evaluate: (input: TCase) => LayoutEvaluationResult,
): readonly LayoutDetection<TCase>[] {
  const out: LayoutDetection<TCase>[] = []

  for (let i = 0; i < cases.length; i++) {
    const current = cases[i]
    if (!current) continue
    const result = evaluate(current)
    if (result.kind === "accept") {
      out.push({ caseData: current, evidence: result.evidence })
    }
  }

  return out
}

export function computeBayesianPosterior(
  priorLogOdds: number,
  evidenceLogOdds: number,
): { readonly posteriorLower: number; readonly posteriorUpper: number; readonly evidenceMass: number } {
  const posteriorLogOdds = priorLogOdds + evidenceLogOdds
  const posteriorProbability = 1 / (1 + Math.exp(-posteriorLogOdds))
  const clamped = clamp(posteriorProbability, 0, 1)
  const evidenceMass = clamp(Math.abs(evidenceLogOdds) / 5, 0, 1)

  return {
    posteriorLower: clamped,
    posteriorUpper: clamp(clamped + (1 - evidenceMass) * 0.1, 0, 1),
    evidenceMass,
  }
}
