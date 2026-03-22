import { HEADING_ELEMENTS } from "@drskillissue/ganko-shared"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import { SignalValueKind } from "../../binding/signal-builder"
import type { FileSemanticModel } from "../../binding/semantic-model"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  dynamicSlotNoReservedSpace:
    "Dynamic content container '{{tag}}' does not reserve block space (min-height/height/aspect-ratio/contain-intrinsic-size), which can cause CLS.",
} as const

const INLINE_DISPLAYS = new Set(["inline", "contents"])

export const cssLayoutDynamicSlotNoReservedSpace = defineAnalysisRule({
  id: "css-layout-dynamic-slot-no-reserved-space",
  severity: "warn",
  messages,
  meta: {
    description: "Require reserved block space for dynamic content containers to avoid layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    let candidateElementIds: Set<number> | null = null

    registry.registerFactAction("reservedSpace", (element, reservedSpaceFact, semanticModel, emit) => {
      if (candidateElementIds === null) {
        candidateElementIds = new Set()
        const candidates = semanticModel.getDynamicSlotCandidates()
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i]
          if (c) candidateElementIds.add(c.elementId)
        }
      }
      if (!candidateElementIds.has(element.elementId)) return

      if (element.isControl) return
      if (element.tagName === null) return
      if (HEADING_ELEMENTS.has(element.tagName)) return

      const flowFact = semanticModel.getLayoutFact(element.elementId, "flowParticipation")
      if (!flowFact.inFlow) return
      if (hasOutOfFlowAncestor(element, semanticModel)) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const displaySignal = snapshot.signals.get("display")
      if (displaySignal && displaySignal.kind === SignalValueKind.Known && INLINE_DISPLAYS.has(displaySignal.normalized)) return

      if (reservedSpaceFact.hasReservedSpace) return
      if (hasBlockAxisPadding(snapshot)) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutDynamicSlotNoReservedSpace.id,
          "dynamicSlotNoReservedSpace",
          resolveMessage(messages.dynamicSlotNoReservedSpace, { tag }),
          "warn",
        ),
      )
    })
  },
})

function hasBlockAxisPadding(snapshot: import("../../binding/signal-builder").SignalSnapshot): boolean {
  const top = readKnownPx(snapshot, "padding-top")
  const bottom = readKnownPx(snapshot, "padding-bottom")
  if (top !== null && top > 0 && bottom !== null && bottom > 0) return true
  return false
}

function readKnownPx(snapshot: import("../../binding/signal-builder").SignalSnapshot, name: import("../../binding/signal-builder").LayoutSignalName): number | null {
  const sig = snapshot.signals.get(name)
  if (!sig || sig.kind !== SignalValueKind.Known) return null
  return sig.px
}

function hasOutOfFlowAncestor(element: ElementNode, semanticModel: FileSemanticModel): boolean {
  let current = element.parentElementNode
  while (current !== null) {
    const flow = semanticModel.getLayoutFact(current.elementId, "flowParticipation")
    if (!flow.inFlow) return true
    current = current.parentElementNode
  }
  return false
}
