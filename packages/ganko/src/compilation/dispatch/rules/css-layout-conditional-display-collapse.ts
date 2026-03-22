import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import { TextualContentState, SignalValueKind } from "../../binding/signal-builder"
import { SignalGuardKind } from "../../binding/cascade-binder"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  conditionalDisplayCollapse:
    "Conditional display sets '{{display}}' on '{{tag}}' without stable reserved space, which can collapse/expand layout and cause CLS.",
} as const

const COLLAPSING_DISPLAYS = new Set(["none", "contents"])

export const cssLayoutConditionalDisplayCollapse = defineAnalysisRule({
  id: "css-layout-conditional-display-collapse",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional display collapse in flow without reserved geometry.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.FullCascade },
  register(registry) {
    registry.registerConditionalDeltaAction((element, delta, semanticModel, emit) => {
      const displayDelta = delta.get("display")
      if (!displayDelta || !displayDelta.hasConditional || !displayDelta.hasDelta) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const displaySignal = snapshot.signals.get("display")
      if (!displaySignal || displaySignal.kind !== SignalValueKind.Known) return
      if (!COLLAPSING_DISPLAYS.has(displaySignal.normalized)) return
      if (displaySignal.guard.kind !== SignalGuardKind.Conditional) return

      const flowFact = semanticModel.getLayoutFact(element.elementId, "flowParticipation")
      if (!flowFact.inFlow) return
      if (!isFlowRelevantBySiblingsOrText(element)) return

      const reservedSpace = semanticModel.getLayoutFact(element.elementId, "reservedSpace")
      if (reservedSpace.hasReservedSpace) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutConditionalDisplayCollapse.id,
          "conditionalDisplayCollapse",
          resolveMessage(messages.conditionalDisplayCollapse, { tag, display: displaySignal.normalized }),
          "warn",
        ),
      )
    })
  },
})

function isFlowRelevantBySiblingsOrText(element: ElementNode): boolean {
  if (element.siblingCount >= 2) return true
  return element.textualContent === TextualContentState.Yes
    || element.textualContent === TextualContentState.Unknown
    || element.textualContent === TextualContentState.DynamicText
}
