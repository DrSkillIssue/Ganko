import { HEADING_ELEMENTS } from "@drskillissue/ganko-shared"
import { defineCrossRule } from "../rule"
import type { LayoutSignalSnapshot } from "../layout"
import {
  collectSignalSnapshot,
  readDynamicSlotCandidateElements,
  readFlowParticipationFact,
  readKnownNormalized,
  readKnownPx,
  readReservedSpaceFact,
} from "../layout"
import type { LayoutElementNode, LayoutGraph } from "../layout/graph"
import { emitLayoutDiagnostic } from "./rule-runtime"

const messages = {
  dynamicSlotNoReservedSpace:
    "Dynamic content container '{{tag}}' does not reserve block space (min-height/height/aspect-ratio/contain-intrinsic-size), which can cause CLS.",
} as const

const INLINE_DISPLAYS = new Set(["inline", "contents"])

function hasBlockAxisPadding(snapshot: LayoutSignalSnapshot): boolean {
  const top = readKnownPx(snapshot, "padding-top")
  const bottom = readKnownPx(snapshot, "padding-bottom")
  if (top !== null && top > 0 && bottom !== null && bottom > 0) return true
  return false
}

/**
 * Check if any ancestor of the given element is out of normal flow
 * (position: fixed or absolute). Elements inside out-of-flow containers
 * cannot cause CLS to the main document because they don't participate
 * in normal document layout.
 */
function hasOutOfFlowAncestor(
  layout: LayoutGraph,
  node: LayoutElementNode,
): boolean {
  let current = node.parentElementNode
  while (current !== null) {
    const flow = readFlowParticipationFact(layout, current)
    if (!flow.inFlow) return true
    current = current.parentElementNode
  }
  return false
}

export const cssLayoutDynamicSlotNoReservedSpace = defineCrossRule({
  id: "css-layout-dynamic-slot-no-reserved-space",
  severity: "warn",
  messages,
  meta: {
    description: "Require reserved block space for dynamic content containers to avoid layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readDynamicSlotCandidateElements(context.layout)
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue

      if (node.isControl) continue
      /* When the host resolver cannot determine what DOM element a component
         renders as, tagName is null.  No CSS selectors can reliably match it,
         so the cascade has zero signal data — claiming "no reserved space"
         would be a false positive.  Skip unresolved components entirely. */
      if (node.tagName === null) continue
      if (HEADING_ELEMENTS.has(node.tagName)) continue

      const snapshot = collectSignalSnapshot(context, node)
      const flow = readFlowParticipationFact(context.layout, node)
      if (!flow.inFlow) continue
      // Elements inside out-of-flow ancestors (position: fixed/absolute) don't
      // participate in the main document's layout, so their CLS impact is zero.
      if (hasOutOfFlowAncestor(context.layout, node)) continue
      const display = readKnownNormalized(snapshot, "display")
      if (display && INLINE_DISPLAYS.has(display)) continue
      const reservedSpace = readReservedSpaceFact(context.layout, node)
      if (reservedSpace.hasReservedSpace) continue
      if (hasBlockAxisPadding(snapshot)) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutDynamicSlotNoReservedSpace.id, "dynamicSlotNoReservedSpace", messages.dynamicSlotNoReservedSpace, cssLayoutDynamicSlotNoReservedSpace.severity)) continue
    }
  },
})
