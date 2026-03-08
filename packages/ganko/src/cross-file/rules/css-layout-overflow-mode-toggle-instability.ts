import {
  collectSignalSnapshot,
  readConditionalSignalDeltaFact,
  readElementsWithConditionalOverflowDelta,
  readFlowParticipationFact,
  readKnownNormalizedWithGuard,
  readScrollContainerFact,
} from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, isLikelyViewportAffectingContainer } from "./rule-runtime"

const messages = {
  overflowModeToggle:
    "Conditional overflow mode changes scrolling ('{{overflow}}') on '{{tag}}' without `scrollbar-gutter: stable`, which can trigger CLS.",
} as const

export const cssLayoutOverflowModeToggleInstability = defineCrossRule({
  id: "css-layout-overflow-mode-toggle-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional overflow mode switches that can introduce scrollbar-induced layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsWithConditionalOverflowDelta(context.layout)

    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const flow = readFlowParticipationFact(context.layout, node)
      if (!flow.inFlow) continue
      if (!isLikelyViewportAffectingContainer(node)) continue

      const overflowDelta = readConditionalSignalDeltaFact(context.layout, node, "overflow")
      const overflowYDelta = readConditionalSignalDeltaFact(context.layout, node, "overflow-y")

      if (!hasRelevantScrollModeDelta(overflowDelta, overflowYDelta)) continue

      const scrollFact = readScrollContainerFact(context.layout, node)
      if (!scrollFact.isScrollContainer && !hasAnyScrollValue(overflowDelta) && !hasAnyScrollValue(overflowYDelta)) continue

      const snapshot = collectSignalSnapshot(context, node)

      // scrollbar-width: none means no scrollbar is rendered, so no CLS from scrollbar appearance
      const scrollbarWidth = readKnownNormalizedWithGuard(snapshot, "scrollbar-width")
      if (scrollbarWidth === "none") continue

      const gutter = readKnownNormalizedWithGuard(snapshot, "scrollbar-gutter")
      if (gutter !== null && gutter.startsWith("stable")) continue

      const overflowValue = scrollFact.overflowY ?? scrollFact.overflow ?? "auto"
      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutOverflowModeToggleInstability.id, "overflowModeToggle", messages.overflowModeToggle, cssLayoutOverflowModeToggleInstability.severity, { overflow: overflowValue })) continue
    }
  },
})

function hasRelevantScrollModeDelta(
  overflowDelta: ReturnType<typeof readConditionalSignalDeltaFact>,
  overflowYDelta: ReturnType<typeof readConditionalSignalDeltaFact>,
): boolean {
  return hasScrollModeDelta(overflowDelta) || hasScrollModeDelta(overflowYDelta)
}

function hasScrollModeDelta(delta: ReturnType<typeof readConditionalSignalDeltaFact>): boolean {
  if (!delta.hasConditional || !delta.hasDelta) return false

  if (delta.hasConditionalScrollValue && delta.hasUnconditionalNonScrollValue) return true
  if (delta.hasUnconditionalScrollValue && delta.hasConditionalNonScrollValue) return true
  if (delta.hasConditionalScrollValue && delta.unconditionalValues.length === 0) return true
  if (delta.hasUnconditionalScrollValue && delta.conditionalValues.length === 0) return true
  return false
}

function hasAnyScrollValue(delta: ReturnType<typeof readConditionalSignalDeltaFact>): boolean {
  return delta.hasConditionalScrollValue || delta.hasUnconditionalScrollValue
}
