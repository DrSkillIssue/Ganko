import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import { SignalValueKind } from "../../binding/signal-builder"
import type { ConditionalSignalDelta } from "../../analysis/cascade-analyzer"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  overflowModeToggle:
    "Conditional overflow mode changes scrolling ('{{overflow}}') on '{{tag}}' without `scrollbar-gutter: stable`, which can trigger CLS.",
} as const

const VIEWPORT_CONTAINER_TAGS = new Set(["html", "body", "main", "section", "article", "div"])

export const cssLayoutOverflowModeToggleInstability = defineAnalysisRule({
  id: "css-layout-overflow-mode-toggle-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional overflow mode switches that can introduce scrollbar-induced layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.FullCascade },
  register(registry) {
    registry.registerConditionalDeltaAction((element, delta, semanticModel, emit) => {
      const overflowDelta = delta.get("overflow") ?? null
      const overflowYDelta = delta.get("overflow-y") ?? null

      if (!hasRelevantScrollModeDelta(overflowDelta, overflowYDelta)) return

      const flowFact = semanticModel.getLayoutFact(element.elementId, "flowParticipation")
      if (!flowFact.inFlow) return
      if (!isLikelyViewportAffectingContainer(element)) return

      const scrollFact = semanticModel.getLayoutFact(element.elementId, "scrollContainer")
      if (!scrollFact.isScrollContainer && !hasAnyScrollValue(overflowDelta) && !hasAnyScrollValue(overflowYDelta)) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)

      const scrollbarWidthSignal = snapshot.signals.get("scrollbar-width")
      if (scrollbarWidthSignal && scrollbarWidthSignal.kind === SignalValueKind.Known && scrollbarWidthSignal.normalized === "none") return

      const gutterSignal = snapshot.signals.get("scrollbar-gutter")
      if (gutterSignal && gutterSignal.kind === SignalValueKind.Known && gutterSignal.normalized.startsWith("stable")) return

      const overflowValue = scrollFact.overflowY ?? scrollFact.overflow ?? "auto"
      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutOverflowModeToggleInstability.id,
          "overflowModeToggle",
          resolveMessage(messages.overflowModeToggle, { tag, overflow: overflowValue }),
          "warn",
        ),
      )
    })
  },
})

function isLikelyViewportAffectingContainer(element: ElementNode): boolean {
  if (element.siblingCount >= 2) return true
  if (element.parentElementNode === null) return true
  if (element.tagName !== null && VIEWPORT_CONTAINER_TAGS.has(element.tagName)) return true
  return false
}

function hasRelevantScrollModeDelta(
  overflowDelta: ConditionalSignalDelta | null,
  overflowYDelta: ConditionalSignalDelta | null,
): boolean {
  return hasScrollModeDelta(overflowDelta) || hasScrollModeDelta(overflowYDelta)
}

function hasScrollModeDelta(delta: ConditionalSignalDelta | null): boolean {
  if (!delta || !delta.hasConditional || !delta.hasDelta) return false

  if (delta.hasConditionalScrollValue && delta.hasUnconditionalNonScrollValue) return true
  if (delta.hasUnconditionalScrollValue && delta.hasConditionalNonScrollValue) return true
  if (delta.hasConditionalScrollValue && delta.unconditionalValues.length === 0) return true
  if (delta.hasUnconditionalScrollValue && delta.conditionalValues.length === 0) return true
  return false
}

function hasAnyScrollValue(delta: ConditionalSignalDelta | null): boolean {
  if (!delta) return false
  return delta.hasConditionalScrollValue || delta.hasUnconditionalScrollValue
}
