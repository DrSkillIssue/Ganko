export type LayoutAxisModel = "horizontal-tb" | "vertical-rl" | "vertical-lr"

export type InlineDirectionModel = "ltr" | "rtl"

export type AlignmentContextKind =
  | "inline-formatting"
  | "table-cell"
  | "flex-cross-axis"
  | "grid-cross-axis"
  | "block-flow"
  | "positioned-offset"

export type LayoutContextContainerKind = "table" | "flex" | "grid" | "inline" | "block"

export const enum ContextCertainty { Resolved = 0, Conditional = 1, Unknown = 2 }

/**
 * Whether the CSS formatting context consults baselines for vertical positioning.
 *
 * - `"relevant"`: Baselines participate in alignment (e.g. flex `align-items: baseline`,
 *   table-cell `vertical-align: baseline`, inline formatting context).
 * - `"irrelevant"`: The alignment model is purely geometric; baselines are never
 *   consulted (e.g. flex `align-items: center`, table-cell `vertical-align: middle`
 *   with uniform cohort agreement).
 *
 * Computed once at context construction for flex/grid (parent-level data suffices).
 * For table-cell contexts, finalized after cohort aggregation when the cohort's
 * vertical-align consensus is known.
 *
 * CSS spec references:
 * - Flex: CSS Flexbox §8.3, §9.6 — `center` aligns by margin box center, not baselines.
 * - Grid: CSS Grid §10.6 — analogous to flex.
 * - Table: CSS2 §17.5.3 — `middle` centers cell content geometrically.
 */
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
  /**
   * Whether the layout container's cross axis aligns with the document's
   * block axis. When `true`, vertical sibling offset differences represent
   * genuine alignment issues. When `false`, the block axis is the container's
   * main axis — vertical positioning is controlled by the layout algorithm
   * (gap, justify-content), and offset evidence should be suppressed.
   *
   * For non-flex/grid contexts (block flow, inline formatting, table-cell),
   * this is always `true`.
   */
  readonly crossAxisIsBlockAxis: boolean
  readonly crossAxisIsBlockAxisCertainty: ContextCertainty
  readonly baselineRelevance: BaselineRelevance
  readonly evidence: LayoutContextEvidence
}
