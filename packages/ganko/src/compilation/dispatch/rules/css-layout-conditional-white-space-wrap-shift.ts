import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import { TextualContentState, SignalValueKind } from "../../binding/signal-builder"
import type { LayoutSignalName, SignalSnapshot } from "../../binding/signal-builder"
import { SignalGuardKind } from "../../binding/cascade-binder"
import type { ConditionalSignalDelta } from "../../analysis/cascade-analyzer"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  conditionalWhiteSpaceShift:
    "Conditional white-space '{{whiteSpace}}' on '{{tag}}' can reflow text and shift siblings; keep wrapping behavior stable or reserve geometry.",
} as const

const WRAP_SHIFT_VALUES = new Set(["nowrap", "pre"])
const INLINE_SIZE_PROPERTIES: readonly LayoutSignalName[] = ["width", "min-width"]
const BLOCK_SIZE_PROPERTIES: readonly LayoutSignalName[] = ["height", "min-height"]

export const cssLayoutConditionalWhiteSpaceWrapShift = defineAnalysisRule({
  id: "css-layout-conditional-white-space-wrap-shift",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional white-space wrapping mode toggles that can trigger CLS.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.FullCascade },
  register(registry) {
    registry.registerConditionalDeltaAction((element, delta, semanticModel, emit) => {
      const whiteSpaceDelta = delta.get("white-space")
      if (!whiteSpaceDelta || !whiteSpaceDelta.hasConditional || !whiteSpaceDelta.hasDelta) return
      if (!hasWrapShiftDelta(whiteSpaceDelta)) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const whiteSpaceSignal = snapshot.signals.get("white-space")
      if (!whiteSpaceSignal || whiteSpaceSignal.kind !== SignalValueKind.Known) return
      if (whiteSpaceSignal.guard.kind !== SignalGuardKind.Conditional) return

      const flowFact = semanticModel.getLayoutFact(element.elementId, "flowParticipation")
      if (!flowFact.inFlow) return
      if (!isFlowRelevantBySiblingsOrText(element)) return
      if (hasStableTextShell(snapshot)) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutConditionalWhiteSpaceWrapShift.id,
          "conditionalWhiteSpaceShift",
          resolveMessage(messages.conditionalWhiteSpaceShift, { tag, whiteSpace: whiteSpaceSignal.normalized }),
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

function hasStableTextShell(snapshot: SignalSnapshot): boolean {
  return hasAnyPositiveKnownPx(snapshot, INLINE_SIZE_PROPERTIES)
    && hasAnyPositiveKnownPx(snapshot, BLOCK_SIZE_PROPERTIES)
}

function hasAnyPositiveKnownPx(snapshot: SignalSnapshot, properties: readonly LayoutSignalName[]): boolean {
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    if (!prop) continue
    const sig = snapshot.signals.get(prop)
    if (!sig || sig.kind !== SignalValueKind.Known) continue
    if (sig.px !== null && sig.px > 0) return true
  }
  return false
}

function hasWrapShiftDelta(delta: ConditionalSignalDelta): boolean {
  for (let i = 0; i < delta.conditionalValues.length; i++) {
    const val = delta.conditionalValues[i]
    if (val && WRAP_SHIFT_VALUES.has(val)) return true
  }
  for (let i = 0; i < delta.unconditionalValues.length; i++) {
    const val = delta.unconditionalValues[i]
    if (val && WRAP_SHIFT_VALUES.has(val)) return true
  }
  return false
}
