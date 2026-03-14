import type { CrossRuleContext } from "../rule"
import {
  ContextCertainty,
  type AlignmentContext,
  type AlignmentContextKind,
  type BaselineRelevance,
  type InlineDirectionModel,
  type LayoutAxisModel,
  type LayoutContextEvidence,
} from "./context-model"
import type { LayoutElementNode, LayoutElementRef } from "./graph"
import { EvidenceValueKind, LayoutSignalGuard, type LayoutSignalSnapshot } from "./signal-model"
import { readKnownSignalWithGuard, readNormalizedSignalEvidence } from "./signal-access"
import { WHITESPACE_RE } from "./util"


const TABLE_SEMANTIC_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"])
const TABLE_DISPLAY_VALUES = new Set([
  "table",
  "inline-table",
  "table-row",
  "table-cell",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-column",
  "table-column-group",
  "table-caption",
])
const FLEX_DISPLAY_VALUES = new Set(["flex", "inline-flex"])
const GRID_DISPLAY_VALUES = new Set(["grid", "inline-grid"])
const INLINE_DISPLAY_VALUES = new Set(["inline", "inline-block", "inline-list-item"])


export function classifyAlignmentContext(
  context: CrossRuleContext,
  parent: LayoutElementNode,
): AlignmentContext {
  const existing = context.layout.contextByParentNode.get(parent)
  if (existing) return existing

  throw new Error(`missing precomputed alignment context for ${parent.key}`)
}

export function createAlignmentContextForParent(
  parent: LayoutElementNode,
  snapshot: LayoutSignalSnapshot,
): AlignmentContext {

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
  const evidence = resolveContextEvidence(
    parent,
    parentDisplay,
    parentDisplayCertainty,
    positionedOffset.hasPositionedOffset,
    positionedOffset.certainty,
  )
  const classified = classifyKind(evidence)
  const contextCertainty = combineCertainty(classified.certainty, axis.certainty)
  const certainty = combineCertainty(contextCertainty, inlineDirection.certainty)

  const baselineRelevance = computeBaselineRelevance(classified.kind, parentAlignItems, parentPlaceItems)
  const crossAxisInfo = resolveCrossAxisIsBlockAxis(classified.kind, snapshot, axis.value)

  const out: AlignmentContext = {
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

  return out
}

function classifyKind(
  evidence: LayoutContextEvidence,
): {
  readonly kind: AlignmentContextKind
  readonly certainty: ContextCertainty
} {
  if (evidence.hasTableSemantics) {
    return {
      kind: "table-cell",
      certainty: ContextCertainty.Resolved,
    }
  }

  if (evidence.containerKind === "table") {
    return {
      kind: "table-cell",
      certainty: evidence.containerKindCertainty,
    }
  }

  if (evidence.containerKind === "flex") {
    return {
      kind: "flex-cross-axis",
      certainty: evidence.containerKindCertainty,
    }
  }

  if (evidence.containerKind === "grid") {
    return {
      kind: "grid-cross-axis",
      certainty: evidence.containerKindCertainty,
    }
  }

  if (evidence.containerKind === "inline") {
    return {
      kind: "inline-formatting",
      certainty: evidence.containerKindCertainty,
    }
  }

  if (evidence.hasPositionedOffset) {
    return {
      kind: "positioned-offset",
      certainty: evidence.positionedOffsetCertainty,
    }
  }

  return {
    kind: "block-flow",
    certainty: combineCertainty(evidence.containerKindCertainty, evidence.positionedOffsetCertainty),
  }
}

function resolveContextEvidence(
  parent: LayoutElementNode,
  parentDisplay: string | null,
  parentDisplayCertainty: ContextCertainty,
  hasPositionedOffset: boolean,
  positionedOffsetCertainty: ContextCertainty,
): LayoutContextEvidence {
  const hasTableSemantics = parent.tagName !== null && TABLE_SEMANTIC_TAGS.has(parent.tagName)
  const container = resolveContainerKind(parentDisplay, parentDisplayCertainty)

  return {
    containerKind: container.kind,
    containerKindCertainty: container.certainty,
    hasTableSemantics,
    hasPositionedOffset,
    positionedOffsetCertainty,
  }
}

function resolveContainerKind(
  parentDisplay: string | null,
  certainty: ContextCertainty,
): {
  readonly kind: LayoutContextEvidence["containerKind"]
  readonly certainty: ContextCertainty
} {
  if (parentDisplay === null) {
    return {
      kind: "block",
      certainty,
    }
  }

  const display = parentDisplay.trim().toLowerCase()
  if (display.length === 0) {
    return {
      kind: "block",
      certainty,
    }
  }

  if (TABLE_DISPLAY_VALUES.has(display)) {
    return {
      kind: "table",
      certainty,
    }
  }
  if (FLEX_DISPLAY_VALUES.has(display)) {
    return {
      kind: "flex",
      certainty,
    }
  }
  if (GRID_DISPLAY_VALUES.has(display)) {
    return {
      kind: "grid",
      certainty,
    }
  }
  if (INLINE_DISPLAY_VALUES.has(display)) {
    return {
      kind: "inline",
      certainty,
    }
  }

  const tokens = display.split(WHITESPACE_RE)
  if (tokens.length === 2) {
    const outside = tokens[0]
    const inside = tokens[1]
    if (outside === "inline" && inside === "table") {
      return {
        kind: "table",
        certainty,
      }
    }
    if (inside === "table") {
      return {
        kind: "table",
        certainty,
      }
    }
    if (inside === "flex") {
      return {
        kind: "flex",
        certainty,
      }
    }
    if (inside === "grid") {
      return {
        kind: "grid",
        certainty,
      }
    }
    if (outside === "inline") {
      return {
        kind: "inline",
        certainty,
      }
    }
  }

  if (tokens.length > 0 && tokens[0] === "inline") {
    return {
      kind: "inline",
      certainty,
    }
  }

  return {
    kind: "block",
    certainty,
  }
}

function resolveAxis(snapshot: LayoutSignalSnapshot): {
  readonly value: LayoutAxisModel
  readonly certainty: ContextCertainty
} {
  if (!snapshot.signals.has("writing-mode")) {
    return {
      value: "horizontal-tb",
      certainty: ContextCertainty.Resolved,
    }
  }

  const writingMode = readNormalizedSignalEvidence(snapshot, "writing-mode")
  if (writingMode.value === "vertical-rl") {
    return {
      value: "vertical-rl",
      certainty: toContextCertainty(writingMode.kind),
    }
  }
  if (writingMode.value === "vertical-lr") {
    return {
      value: "vertical-lr",
      certainty: toContextCertainty(writingMode.kind),
    }
  }

  return {
    value: "horizontal-tb",
    certainty: toContextCertainty(writingMode.kind),
  }
}

function resolveInlineDirection(snapshot: LayoutSignalSnapshot): {
  readonly value: InlineDirectionModel
  readonly certainty: ContextCertainty
} {
  if (!snapshot.signals.has("direction")) {
    return {
      value: "ltr",
      certainty: ContextCertainty.Resolved,
    }
  }

  const direction = readNormalizedSignalEvidence(snapshot, "direction")
  if (direction.value === "rtl") {
    return {
      value: "rtl",
      certainty: toContextCertainty(direction.kind),
    }
  }

  return {
    value: "ltr",
    certainty: toContextCertainty(direction.kind),
  }
}

function toContextCertainty(kind: ReturnType<typeof readNormalizedSignalEvidence>["kind"]): ContextCertainty {
  if (kind === EvidenceValueKind.Exact) return ContextCertainty.Resolved
  if (kind === EvidenceValueKind.Interval || kind === EvidenceValueKind.Conditional) return ContextCertainty.Conditional
  return ContextCertainty.Unknown
}

function resolvePositionedOffset(snapshot: LayoutSignalSnapshot): {
  readonly hasPositionedOffset: boolean
  readonly certainty: ContextCertainty
} {
  const position = readKnownSignalWithGuard(snapshot, "position")
  if (!position) {
    return {
      hasPositionedOffset: false,
      certainty: ContextCertainty.Unknown,
    }
  }

  const certainty = resolveSignalCertainty(position)
  if (position.normalized === "static") {
    return {
      hasPositionedOffset: false,
      certainty,
    }
  }

  return {
    hasPositionedOffset: true,
    certainty,
  }
}

const FLEX_ROW_VALUES = new Set(["row", "row-reverse"])

/**
 * Determines whether the container's cross axis aligns with the document's
 * block axis. `flex-direction` and `grid-auto-flow` values are already
 * writing-mode-relative (`row` = inline axis, `column` = block axis), so
 * no additional writing-mode branching is needed.
 *
 * - `flex-direction: row|row-reverse` → main = inline, cross = block → `true`
 * - `flex-direction: column|column-reverse` → main = block, cross = inline → `false`
 * - `grid-auto-flow: row` → row-major, block-axis alignment relevant → `true`
 * - `grid-auto-flow: column` → column-major, block-axis is stacking direction → `false`
 */
function resolveCrossAxisIsBlockAxis(
  kind: AlignmentContextKind,
  snapshot: LayoutSignalSnapshot,
  _axis: LayoutAxisModel,
): { readonly value: boolean; readonly certainty: ContextCertainty } {
  if (kind !== "flex-cross-axis" && kind !== "grid-cross-axis") {
    return { value: true, certainty: ContextCertainty.Resolved }
  }

  if (kind === "flex-cross-axis") {
    const signal = readKnownSignalWithGuard(snapshot, "flex-direction")
    if (!signal) {
      return { value: true, certainty: ContextCertainty.Resolved }
    }
    const certainty = resolveSignalCertainty(signal)
    return { value: FLEX_ROW_VALUES.has(signal.normalized), certainty }
  }

  const signal = readKnownSignalWithGuard(snapshot, "grid-auto-flow")
  if (!signal) {
    return { value: true, certainty: ContextCertainty.Resolved }
  }
  const certainty = resolveSignalCertainty(signal)
  return { value: !signal.normalized.startsWith("column"), certainty }
}

function resolveSignalCertainty(
  value: ReturnType<typeof readKnownSignalWithGuard>,
): ContextCertainty {
  if (!value) return ContextCertainty.Unknown
  if (value.guard === LayoutSignalGuard.Conditional) return ContextCertainty.Conditional
  return ContextCertainty.Resolved
}

function combineCertainty(left: ContextCertainty, right: ContextCertainty): ContextCertainty {
  return left > right ? left : right
}

export function getContextElementRef(
  context: CrossRuleContext,
  alignmentContext: AlignmentContext,
): LayoutElementRef | null {
  const refsInFile = context.layout.elementRefsBySolidFileAndId.get(alignmentContext.parentSolidFile)
  if (!refsInFile) return null
  return refsInFile.get(alignmentContext.parentElementId) ?? null
}

/**
 * Non-baseline alignment values for flex/grid `align-items`.
 * When the parent uses one of these, flex/grid items are positioned by
 * margin box geometry (CSS Flexbox §8.3, CSS Grid §10.6), not baselines.
 */
const FLEX_GRID_GEOMETRIC_ALIGN_ITEMS: ReadonlySet<string> = new Set([
  "center", "flex-start", "flex-end", "start", "end", "stretch",
  "self-start", "self-end", "normal",
])

/**
 * Computes baseline relevance at context construction time.
 *
 * For flex/grid, the parent's `align-items` fully determines whether baselines
 * are consulted. For table cells, baseline relevance depends on the cohort's
 * per-element `vertical-align` consensus, which isn't available until after
 * cohort aggregation. Table cells default to `"relevant"` (conservative) and
 * are finalized via {@link finalizeTableCellBaselineRelevance}.
 */
function computeBaselineRelevance(
  kind: AlignmentContextKind,
  parentAlignItems: string | null,
  parentPlaceItems: string | null,
): BaselineRelevance {
  if (kind === "flex-cross-axis" || kind === "grid-cross-axis") {
    const effective = resolveEffectiveAlignItems(parentAlignItems, parentPlaceItems)
    // Null means we can't confirm non-baseline alignment — conservatively
    // assume baselines may participate.
    if (effective === null) return "relevant"
    return FLEX_GRID_GEOMETRIC_ALIGN_ITEMS.has(effective) ? "irrelevant" : "relevant"
  }

  // Table cells: deferred to post-cohort finalization.
  // Inline formatting, block flow, positioned: baselines always relevant.
  return "relevant"
}

/**
 * Resolves the effective `align-items` value from `align-items` and `place-items`.
 * `place-items` is a shorthand: `<align-items> <justify-items>`. The block-axis
 * (align) component is the first token.
 */
function resolveEffectiveAlignItems(
  alignItems: string | null,
  placeItems: string | null,
): string | null {
  if (alignItems !== null) return alignItems
  if (placeItems === null) return null
  const firstToken = placeItems.split(WHITESPACE_RE)[0]
  return firstToken ?? null
}

/**
 * Non-baseline `vertical-align` values for table cells (CSS2 §17.5.3).
 * When ALL cells in a row use one of these values, content is positioned
 * geometrically and baselines are never consulted.
 */
const TABLE_CELL_GEOMETRIC_VERTICAL_ALIGN: ReadonlySet<string> = new Set([
  "middle", "top", "bottom",
])

/**
 * Finalizes `baselineRelevance` for table-cell contexts after cohort aggregation.
 *
 * Table-cell baseline relevance requires cohort-level data (the per-element
 * `vertical-align` consensus) that isn't available at initial context construction.
 * This function is called after `buildCohortIndex` completes.
 *
 * Per CSS2 §17.5.3, baseline alignment only occurs when at least one cell
 * uses `vertical-align: baseline`. When the entire cohort agrees on a
 * geometric value (`middle`, `top`, `bottom`), baselines are irrelevant.
 *
 * @param contextByParentNode - Mutable context map to update in-place
 * @param cohortVerticalAlignConsensus - Per-parent resolved consensus value
 *   (null if conflicted, unknown, or no comparable data)
 */
export function finalizeTableCellBaselineRelevance(
  contextByParentNode: Map<LayoutElementNode, AlignmentContext>,
  cohortVerticalAlignConsensus: ReadonlyMap<LayoutElementNode, string | null>,
): void {
  for (const [parent, consensusValue] of cohortVerticalAlignConsensus) {
    const context = contextByParentNode.get(parent)
    if (!context) continue
    if (context.kind !== "table-cell") continue
    if (consensusValue === null) continue
    if (!TABLE_CELL_GEOMETRIC_VERTICAL_ALIGN.has(consensusValue)) continue

    // Replace with finalized context — all fields identical except baselineRelevance.
    contextByParentNode.set(parent, {
      kind: context.kind,
      certainty: context.certainty,
      parentSolidFile: context.parentSolidFile,
      parentElementId: context.parentElementId,
      parentElementKey: context.parentElementKey,
      parentTag: context.parentTag,
      axis: context.axis,
      axisCertainty: context.axisCertainty,
      inlineDirection: context.inlineDirection,
      inlineDirectionCertainty: context.inlineDirectionCertainty,
      parentDisplay: context.parentDisplay,
      parentAlignItems: context.parentAlignItems,
      parentPlaceItems: context.parentPlaceItems,
      hasPositionedOffset: context.hasPositionedOffset,
      crossAxisIsBlockAxis: context.crossAxisIsBlockAxis,
      crossAxisIsBlockAxisCertainty: context.crossAxisIsBlockAxisCertainty,
      baselineRelevance: "irrelevant",
      evidence: context.evidence,
    })
  }
}
