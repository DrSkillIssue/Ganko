/**
 * Layout fact types + computation from signal snapshots.
 *
 * Moved from cross-file/layout/build.ts steps 6-7.
 */
import type { ElementNode } from "../binding/element-builder"
import type { SignalSnapshot } from "../binding/signal-builder"
import { SignalValueKind } from "../binding/signal-builder"

export type LayoutFactKind = "reservedSpace" | "scrollContainer" | "flowParticipation" | "containingBlock"

export interface LayoutFactMap {
  reservedSpace: ReservedSpaceFact
  scrollContainer: ScrollContainerFact
  flowParticipation: FlowParticipationFact
  containingBlock: ContainingBlockFact
}

export interface ReservedSpaceFact {
  readonly hasReservedSpace: boolean
  readonly reasons: readonly string[]
  readonly hasContainIntrinsicSize: boolean
  readonly hasUsableAspectRatio: boolean
  readonly hasDeclaredInlineDimension: boolean
  readonly hasDeclaredBlockDimension: boolean
}

export const enum ScrollAxis { None = 0, X = 1, Y = 2, Both = 3 }

export interface ScrollContainerFact {
  readonly isScrollContainer: boolean
  readonly axis: number
  readonly overflow: string | null
  readonly overflowY: string | null
  readonly hasConditionalScroll: boolean
  readonly hasUnconditionalScroll: boolean
}

export interface FlowParticipationFact {
  readonly inFlow: boolean
  readonly position: string | null
  readonly hasConditionalOutOfFlow: boolean
  readonly hasUnconditionalOutOfFlow: boolean
}

export interface ContainingBlockFact {
  readonly nearestPositionedAncestorKey: string | null
  readonly nearestPositionedAncestorHasReservedSpace: boolean
}


// ── Constants ────────────────────────────────────────────────────────────

const SCROLLABLE_VALUES: ReadonlySet<string> = new Set(["auto", "scroll"])
const NON_RESERVING_DIMENSION_KEYWORDS = new Set(["auto", "none", "fit-content", "min-content", "max-content", "stretch", "inherit", "initial", "unset", "revert", "revert-layer"])
const BLOCK_LEVEL_DISPLAY_VALUES = new Set(["block", "flex", "grid", "table", "list-item", "flow-root", "table-row", "table-cell", "table-caption", "table-row-group", "table-header-group", "table-footer-group", "table-column", "table-column-group"])


// ── computeReservedSpaceFact ─────────────────────────────────────────────

export function computeReservedSpaceFact(snapshot: SignalSnapshot): ReservedSpaceFact {
  const reasons: string[] = []

  const hasHeight = hasDeclaredDimension(snapshot, "height")
  if (hasHeight) reasons.push("height")

  const hasBlockSize = hasDeclaredDimension(snapshot, "block-size")
  if (hasBlockSize) reasons.push("block-size")

  const hasMinHeight = hasDeclaredDimension(snapshot, "min-height")
  if (hasMinHeight) reasons.push("min-height")

  const hasMinBlockSize = hasDeclaredDimension(snapshot, "min-block-size")
  if (hasMinBlockSize) reasons.push("min-block-size")

  const hasContainIntrinsic = hasDeclaredDimension(snapshot, "contain-intrinsic-size")
  if (hasContainIntrinsic) reasons.push("contain-intrinsic-size")

  const hasAspectRatio = hasUsableAspectRatio(snapshot)
  if (hasAspectRatio) {
    if (hasDeclaredDimension(snapshot, "width")) reasons.push("aspect-ratio+width")
    if (hasDeclaredDimension(snapshot, "inline-size")) reasons.push("aspect-ratio+inline-size")
    if (hasDeclaredDimension(snapshot, "min-width")) reasons.push("aspect-ratio+min-width")
    if (hasMinBlockSize) reasons.push("aspect-ratio+min-block-size")
    if (hasMinHeight) reasons.push("aspect-ratio+min-height")
  }

  return {
    hasReservedSpace: reasons.length > 0,
    reasons,
    hasContainIntrinsicSize: hasContainIntrinsic,
    hasUsableAspectRatio: hasAspectRatio,
    hasDeclaredBlockDimension: hasHeight || hasBlockSize || hasMinHeight || hasMinBlockSize,
    hasDeclaredInlineDimension: hasDeclaredDimension(snapshot, "width")
      || hasDeclaredDimension(snapshot, "inline-size")
      || hasDeclaredDimension(snapshot, "min-width")
      || hasDeclaredDimension(snapshot, "flex-basis")
      || isBlockLevelDisplay(snapshot),
  }
}

type DimensionSignalName = "width" | "inline-size" | "min-width" | "height" | "block-size" | "min-height" | "min-block-size" | "flex-basis" | "contain-intrinsic-size"

function hasDeclaredDimension(snapshot: SignalSnapshot, property: DimensionSignalName): boolean {
  const signal = snapshot.signals.get(property)
  if (!signal) return false
  if (signal.kind === SignalValueKind.Known) {
    if (signal.px !== null) return signal.px > 0
    if (signal.normalized.length === 0) return false
    return !isNonReservingDimension(signal.normalized)
  }
  if (signal.kind === SignalValueKind.Unknown) {
    return signal.source !== null
  }
  return false
}

function isBlockLevelDisplay(snapshot: SignalSnapshot): boolean {
  const signal = snapshot.signals.get("display")
  if (!signal || signal.kind !== SignalValueKind.Known) return false
  return BLOCK_LEVEL_DISPLAY_VALUES.has(signal.normalized)
}

function hasUsableAspectRatio(snapshot: SignalSnapshot): boolean {
  const signal = snapshot.signals.get("aspect-ratio")
  if (!signal) return false
  if (signal.guard.kind === 1 /* Conditional */) return false
  if (signal.kind === SignalValueKind.Unknown) return false
  if (signal.kind !== SignalValueKind.Known) return false
  if (signal.normalized.length === 0) return false
  return signal.normalized !== "auto"
}

function isNonReservingDimension(value: string): boolean {
  if (NON_RESERVING_DIMENSION_KEYWORDS.has(value)) return true
  if (value.startsWith("fit-content(")) return true
  return false
}


// ── computeScrollContainerFact ───────────────────────────────────────────

export function computeScrollContainerFact(snapshot: SignalSnapshot): ScrollContainerFact {
  const overflowSignal = snapshot.signals.get("overflow")
  const overflowYSignal = snapshot.signals.get("overflow-y")

  const overflow = overflowSignal && overflowSignal.kind === SignalValueKind.Known
    ? overflowSignal.normalized
    : null
  const overflowY = overflowYSignal && overflowYSignal.kind === SignalValueKind.Known
    ? overflowYSignal.normalized
    : null

  const shorthandAxis = parseOverflowShorthandAxis(overflow)
  const yFromLonghand = parseSingleAxisScroll(overflowY)

  const xScroll = shorthandAxis.x
  const yScroll = yFromLonghand === null ? shorthandAxis.y : yFromLonghand

  const hasConditionalScroll = (overflowSignal?.guard.kind === 1 /* Conditional */ && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard.kind === 1 /* Conditional */ && yFromLonghand === true)
  const hasUnconditionalScroll = (overflowSignal?.guard.kind === 0 /* Unconditional */ && (shorthandAxis.x || shorthandAxis.y))
    || (overflowYSignal?.guard.kind === 0 /* Unconditional */ && yFromLonghand === true)

  return {
    isScrollContainer: xScroll || yScroll,
    axis: toScrollAxis(xScroll, yScroll),
    overflow,
    overflowY,
    hasConditionalScroll,
    hasUnconditionalScroll,
  }
}

const NO_SCROLL = Object.freeze({ x: false, y: false })
const BOTH_SCROLL = Object.freeze({ x: true, y: true })

function parseOverflowShorthandAxis(value: string | null): { x: boolean; y: boolean } {
  if (value === null) return NO_SCROLL
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) {
    const scroll = SCROLLABLE_VALUES.has(trimmed)
    return scroll ? BOTH_SCROLL : NO_SCROLL
  }
  const first = trimmed.slice(0, spaceIdx)
  const second = trimmed.slice(spaceIdx + 1).trimStart()
  return {
    x: SCROLLABLE_VALUES.has(first),
    y: SCROLLABLE_VALUES.has(second),
  }
}

function parseSingleAxisScroll(value: string | null): boolean | null {
  if (value === null) return null
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  return SCROLLABLE_VALUES.has(first)
}

function toScrollAxis(x: boolean, y: boolean): number {
  if (x && y) return ScrollAxis.Both
  if (x) return ScrollAxis.X
  if (y) return ScrollAxis.Y
  return ScrollAxis.None
}


// ── computeFlowParticipationFact ─────────────────────────────────────────

export function computeFlowParticipationFact(snapshot: SignalSnapshot): FlowParticipationFact {
  const signal = snapshot.signals.get("position")
  if (!signal || signal.kind !== SignalValueKind.Known) {
    return { inFlow: true, position: null, hasConditionalOutOfFlow: false, hasUnconditionalOutOfFlow: false }
  }

  const position = signal.normalized
  const outOfFlow = position === "absolute" || position === "fixed"

  return {
    inFlow: !outOfFlow,
    position,
    hasConditionalOutOfFlow: signal.guard.kind === 1 /* Conditional */ && outOfFlow,
    hasUnconditionalOutOfFlow: signal.guard.kind === 0 /* Unconditional */ && outOfFlow,
  }
}


// ── computeContainingBlockFact ───────────────────────────────────────────

export function computeContainingBlockFact(
  node: ElementNode,
  positionedAncestorByKey: ReadonlyMap<string, { readonly key: string; readonly hasReservedSpace: boolean }>,
): ContainingBlockFact {
  let ancestor = node.parentElementNode
  while (ancestor !== null) {
    const positioned = positionedAncestorByKey.get(ancestor.key)
    if (positioned) {
      return {
        nearestPositionedAncestorKey: positioned.key,
        nearestPositionedAncestorHasReservedSpace: positioned.hasReservedSpace,
      }
    }
    ancestor = ancestor.parentElementNode
  }

  return { nearestPositionedAncestorKey: null, nearestPositionedAncestorHasReservedSpace: false }
}
