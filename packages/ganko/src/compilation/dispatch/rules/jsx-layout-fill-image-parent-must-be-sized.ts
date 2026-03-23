import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getFillImageElements, findEnclosingDOMElement } from "../../../solid/queries"
import type { SolidSyntaxTree } from "../../core/solid-syntax-tree"
import type { FileSemanticModel } from "../../binding/semantic-model"
import type { SignalSnapshot } from "../../binding/signal-builder"
import { SignalValueKind } from "../../binding/signal-builder"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unsizedFillParent:
    "Fill-image component '{{component}}' is inside a parent without stable size/position; add parent sizing (height/min-height/aspect-ratio) and non-static position to avoid CLS.",
} as const

export const jsxLayoutFillImageParentMustBeSized = defineAnalysisRule({
  id: "jsx-layout-fill-image-parent-must-be-sized",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable parent size and positioning for fill-image component usage.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    let fillImageParentElementIds: Set<number> | null = null
    let fillImageComponentByParentId: Map<number, { node: import("typescript").Node; tag: string }> | null = null

    function ensureIndex(solidTree: SolidSyntaxTree, semanticModel: FileSemanticModel): void {
      if (fillImageParentElementIds !== null) return
      fillImageParentElementIds = new Set()
      fillImageComponentByParentId = new Map()

      const fillImages = getFillImageElements(solidTree)
      for (let i = 0; i < fillImages.length; i++) {
        const element = fillImages[i]
        if (!element) continue
        const parent = findEnclosingDOMElement(solidTree, element)
        if (!parent) continue
        const parentNode = semanticModel.getElementNode(parent.id)
        if (!parentNode) continue
        fillImageParentElementIds.add(parentNode.elementId)
        fillImageComponentByParentId!.set(parentNode.elementId, {
          node: element.node,
          tag: element.tag ?? "Image",
        })
      }
    }

    registry.registerFactAction("reservedSpace", (element, reservedSpaceFact, semanticModel, emit) => {
      ensureIndex(semanticModel.solidTree, semanticModel)
      if (!fillImageParentElementIds!.has(element.elementId)) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const containingBlock = semanticModel.getLayoutFact(element.elementId, "containingBlock")

      if (hasEffectivePosition(snapshot) && reservedSpaceFact.hasReservedSpace) return
      if (containingBlock.nearestPositionedAncestorKey !== null && containingBlock.nearestPositionedAncestorHasReservedSpace) return

      const component = fillImageComponentByParentId!.get(element.elementId)
      if (!component) return

      emit(
        createDiagnostic(
          element.solidFile,
          component.node,
          semanticModel.solidTree.sourceFile,
          jsxLayoutFillImageParentMustBeSized.id,
          "unsizedFillParent",
          resolveMessage(messages.unsizedFillParent, {
            component: component.tag,
          }),
          "warn",
        ),
      )
    })
  },
})

function hasEffectivePosition(snapshot: SignalSnapshot): boolean {
  const signal = snapshot.signals.get("position")
  if (!signal || signal.kind !== SignalValueKind.Known) return false
  return signal.normalized !== "static"
}
