import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { TextualContentState } from "../../binding/signal-builder"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unstableOverflowAnchor:
    "Element '{{tag}}' sets `overflow-anchor: none` on a {{context}} container; disabling scroll anchoring can amplify visible layout shifts.",
} as const

export const cssLayoutOverflowAnchorInstability = defineAnalysisRule({
  id: "css-layout-overflow-anchor-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow overflow-anchor none on dynamic or scrollable containers prone to visible layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    let anchorNoneElementIds: Set<number> | null = null

    registry.registerFactAction("flowParticipation", (element, flowFact, semanticModel, emit) => {
      if (anchorNoneElementIds === null) {
        anchorNoneElementIds = new Set()
        const candidates = semanticModel.getElementsByKnownSignalValue("overflow-anchor", "none")
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i]
          if (c) anchorNoneElementIds.add(c.elementId)
        }
      }
      if (!anchorNoneElementIds.has(element.elementId)) return
      if (!flowFact.inFlow) return

      const scrollFact = semanticModel.getLayoutFact(element.elementId, "scrollContainer")
      const isScrollable = scrollFact.isScrollContainer
      const isDynamicContainer = element.textualContent === TextualContentState.Unknown && element.siblingCount >= 2
      if (!isScrollable && !isDynamicContainer) return

      const containerContext = isScrollable ? "scrollable" : "dynamic"
      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutOverflowAnchorInstability.id,
          "unstableOverflowAnchor",
          resolveMessage(messages.unstableOverflowAnchor, { tag, context: containerContext }),
          "warn",
        ),
      )
    })
  },
})
