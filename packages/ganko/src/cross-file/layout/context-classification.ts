import type { CrossRuleContext } from "../rule"
import type {
  AlignmentContext,
  AlignmentContextKind,
  ContextCertainty,
  InlineDirectionModel,
  LayoutAxisModel,
  LayoutContextEvidence,
} from "./context-model"
import type { LayoutElementNode, LayoutElementRef } from "./graph"
import type { LayoutSignalSnapshot } from "./signal-model"
import { readKnownSignalWithGuard, readNormalizedSignalEvidence } from "./signal-access"

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
const DISPLAY_TOKEN_SPLIT_RE = /\s+/

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
      certainty: "resolved",
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

  const tokens = display.split(DISPLAY_TOKEN_SPLIT_RE)
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
      certainty: "resolved",
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
      certainty: "resolved",
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
  if (kind === "exact") return "resolved"
  if (kind === "interval" || kind === "conditional") return "conditional"
  return "unknown"
}

function resolvePositionedOffset(snapshot: LayoutSignalSnapshot): {
  readonly hasPositionedOffset: boolean
  readonly certainty: ContextCertainty
} {
  const position = readKnownSignalWithGuard(snapshot, "position")
  if (!position) {
    return {
      hasPositionedOffset: false,
      certainty: "unknown",
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

function resolveSignalCertainty(
  value: ReturnType<typeof readKnownSignalWithGuard>,
): ContextCertainty {
  if (!value) return "unknown"
  if (value.guard === "conditional") return "conditional"
  return "resolved"
}

function combineCertainty(left: ContextCertainty, right: ContextCertainty): ContextCertainty {
  if (left === "unknown" || right === "unknown") return "unknown"
  if (left === "conditional" || right === "conditional") return "conditional"
  return "resolved"
}

export function getContextElementRef(
  context: CrossRuleContext,
  alignmentContext: AlignmentContext,
): LayoutElementRef | null {
  const refsInFile = context.layout.elementRefsBySolidFileAndId.get(alignmentContext.parentSolidFile)
  if (!refsInFile) return null
  return refsInFile.get(alignmentContext.parentElementId) ?? null
}
