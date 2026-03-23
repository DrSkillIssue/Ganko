import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { SignalValueKind } from "../../binding/signal-builder"
import type { LayoutSignalName, SignalSnapshot } from "../../binding/signal-builder"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  boxSizingToggleWithChrome:
    "Conditional `box-sizing` toggle on '{{tag}}' combines with non-zero padding/border, which can shift layout and trigger CLS.",
} as const

const BOX_SIZING_VALUES = new Set(["content-box", "border-box"])
const CHROME_PROPERTIES: readonly LayoutSignalName[] = [
  "padding-top", "padding-left", "padding-right", "padding-bottom",
  "border-top-width", "border-left-width", "border-right-width", "border-bottom-width",
]

export const cssLayoutBoxSizingToggleWithChrome = defineAnalysisRule({
  id: "css-layout-box-sizing-toggle-with-chrome",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional box-sizing mode toggles when box chrome contributes to geometry shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.FullCascade },
  register(registry) {
    registry.registerConditionalDeltaAction((element, delta, semanticModel, emit) => {
      const boxSizingDelta = delta.get("box-sizing")
      if (!boxSizingDelta || !boxSizingDelta.hasConditional || !boxSizingDelta.hasDelta) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const boxSizingSignal = snapshot.signals.get("box-sizing")
      if (!boxSizingSignal || boxSizingSignal.kind !== SignalValueKind.Known) return
      if (!BOX_SIZING_VALUES.has(boxSizingSignal.normalized)) return

      if (!hasNonZeroChrome(snapshot)) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutBoxSizingToggleWithChrome.id,
          "boxSizingToggleWithChrome",
          resolveMessage(messages.boxSizingToggleWithChrome, { tag }),
          "warn",
        ),
      )
    })
  },
})

function hasNonZeroChrome(snapshot: SignalSnapshot): boolean {
  for (let i = 0; i < CHROME_PROPERTIES.length; i++) {
    const prop = CHROME_PROPERTIES[i]
    if (!prop) continue
    const sig = snapshot.signals.get(prop)
    if (!sig || sig.kind !== SignalValueKind.Known) continue
    if (sig.px !== null && sig.px > 0) return true
  }
  return false
}
