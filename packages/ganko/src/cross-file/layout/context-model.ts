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

export type ContextCertainty = "resolved" | "conditional" | "unknown"

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
  readonly evidence: LayoutContextEvidence
}
