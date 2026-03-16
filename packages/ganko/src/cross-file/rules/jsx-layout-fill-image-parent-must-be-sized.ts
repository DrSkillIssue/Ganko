import { createDiagnostic, resolveMessage } from "../../diagnostic"
import {
  findEnclosingDOMElement,
  getFillImageElements,
} from "../../solid/queries"
import {
  collectSignalSnapshot,
  hasEffectivePosition,
  readContainingBlockFact,
  readReservedSpaceFact,
} from "../layout"
import { defineCrossRule } from "../rule"

const messages = {
  unsizedFillParent:
    "Fill-image component '{{component}}' is inside a parent without stable size/position; add parent sizing (height/min-height/aspect-ratio) and non-static position to avoid CLS.",
} as const

export const jsxLayoutFillImageParentMustBeSized = defineCrossRule({
  id: "jsx-layout-fill-image-parent-must-be-sized",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable parent size and positioning for fill-image component usage.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    for (let i = 0; i < context.solids.length; i++) {
      const solid = context.solids[i]
      if (!solid) continue
      const elements = getFillImageElements(solid)

      for (let j = 0; j < elements.length; j++) {
        const element = elements[j]
        if (!element) continue

        const parent = findEnclosingDOMElement(solid, element)
        if (!parent) continue

        const parentNode = context.layout.elementBySolidFileAndId.get(solid.file)?.get(parent.id)
        if (!parentNode) continue
        const snapshot = collectSignalSnapshot(context, parentNode)
        const reservedSpace = readReservedSpaceFact(context.layout, parentNode)
        const containing = readContainingBlockFact(context.layout, parentNode)

        if (hasEffectivePosition(snapshot) && reservedSpace.hasReservedSpace) continue
        if (containing.nearestPositionedAncestorKey !== null && containing.nearestPositionedAncestorHasReservedSpace) continue

        emit(
          createDiagnostic(
            solid.file,
            element.node,
            solid.sourceFile,
            jsxLayoutFillImageParentMustBeSized.id,
            "unsizedFillParent",
            resolveMessage(messages.unsizedFillParent, {
              component: element.tag ?? "Image",
            }),
            "warn",
          ),
        )
      }
    }
  },
})
