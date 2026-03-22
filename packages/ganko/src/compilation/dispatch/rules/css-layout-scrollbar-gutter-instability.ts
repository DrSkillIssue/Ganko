import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { SignalValueKind } from "../../binding/signal-builder"
import { ScrollAxis } from "../../analysis/layout-fact"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  missingScrollbarGutter:
    "Scrollable container '{{tag}}' uses overflow auto/scroll without `scrollbar-gutter: stable`, which can trigger CLS when scrollbars appear.",
} as const

export const cssLayoutScrollbarGutterInstability = defineAnalysisRule({
  id: "css-layout-scrollbar-gutter-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable scrollbar gutters for scrollable containers to reduce layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    let scrollElementIds: Set<number> | null = null

    registry.registerFactAction("scrollContainer", (element, scrollFact, semanticModel, emit) => {
      if (scrollElementIds === null) {
        scrollElementIds = new Set()
        const candidates = semanticModel.getScrollContainerElements()
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i]
          if (c) scrollElementIds.add(c.elementId)
        }
      }
      if (!scrollElementIds.has(element.elementId)) return
      if (!scrollFact.isScrollContainer) return
      if (scrollFact.axis !== ScrollAxis.Y && scrollFact.axis !== ScrollAxis.Both) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)

      const scrollbarWidthSignal = snapshot.signals.get("scrollbar-width")
      if (scrollbarWidthSignal && scrollbarWidthSignal.kind === SignalValueKind.Known && scrollbarWidthSignal.normalized === "none") return

      const gutterSignal = snapshot.signals.get("scrollbar-gutter")
      if (gutterSignal && gutterSignal.kind === SignalValueKind.Known && gutterSignal.normalized.startsWith("stable")) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutScrollbarGutterInstability.id,
          "missingScrollbarGutter",
          resolveMessage(messages.missingScrollbarGutter, { tag }),
          "warn",
        ),
      )
    })
  },
})
