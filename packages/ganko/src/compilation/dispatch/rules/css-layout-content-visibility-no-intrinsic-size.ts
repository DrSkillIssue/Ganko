import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ElementNode } from "../../binding/element-builder"
import { TextualContentState } from "../../binding/signal-builder"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  missingIntrinsicSize:
    "`content-visibility: auto` on '{{tag}}' lacks intrinsic size reservation (`contain-intrinsic-size`/min-height/height/aspect-ratio), which can cause CLS.",
} as const

const SECTIONING_CONTAINER_TAGS = new Set(["section", "article", "main"])

export const cssLayoutContentVisibilityNoIntrinsicSize = defineAnalysisRule({
  id: "css-layout-content-visibility-no-intrinsic-size",
  severity: "warn",
  messages,
  meta: {
    description: "Require intrinsic size reservation when using content-visibility auto to avoid late layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    let cvAutoElementIds: Set<number> | null = null

    registry.registerFactAction("reservedSpace", (element, reservedSpaceFact, semanticModel, emit) => {
      if (cvAutoElementIds === null) {
        cvAutoElementIds = new Set()
        const candidates = semanticModel.getElementsByKnownSignalValue("content-visibility", "auto")
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i]
          if (c) cvAutoElementIds.add(c.elementId)
        }
      }
      if (!cvAutoElementIds.has(element.elementId)) return
      if (!isDeferredContainerLike(element)) return
      if (reservedSpaceFact.hasReservedSpace) return

      const tag = element.tagName ?? "element"
      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutContentVisibilityNoIntrinsicSize.id,
          "missingIntrinsicSize",
          resolveMessage(messages.missingIntrinsicSize, { tag }),
          "warn",
        ),
      )
    })
  },
})

function isDeferredContainerLike(element: ElementNode): boolean {
  if (element.siblingCount >= 2) return true
  if (element.textualContent === TextualContentState.Unknown) return true
  if (element.tagName !== null && SECTIONING_CONTAINER_TAGS.has(element.tagName)) return true
  return false
}
