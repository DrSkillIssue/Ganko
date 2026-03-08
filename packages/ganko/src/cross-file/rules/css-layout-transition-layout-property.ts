import { createDiagnosticFromLoc, resolveMessage } from "../../diagnostic"
import { findPropertyInList, findTransitionProperty } from "../../css/parser/value-util"
import { LAYOUT_TRANSITION_PROPERTIES } from "../../css/layout-taxonomy"
import { isLayoutAnimationExempt } from "../../css/rules/animation/layout-animation-exempt"
import { defineCrossRule } from "../rule"

const messages = {
  transitionLayoutProperty:
    "Transition '{{property}}' in '{{declaration}}' animates layout-affecting geometry. Prefer transform/opacity to avoid CLS.",
} as const

export const cssLayoutTransitionLayoutProperty = defineCrossRule({
  id: "css-layout-transition-layout-property",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow transitions that animate layout-affecting geometry properties.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const declarations = context.css.declarationsForProperties("transition", "transition-property")
    for (let i = 0; i < declarations.length; i++) {
      const declaration = declarations[i]
      if (!declaration) continue
      const property = declaration.property.toLowerCase()

      const target = property === "transition"
        ? findLayoutTransitionTarget(declaration.value)
        : findPropertyInList(declaration.value, LAYOUT_TRANSITION_PROPERTIES)
      if (!target) continue
      if (isLayoutAnimationExempt(declaration, target)) continue

      emit(
        createDiagnosticFromLoc(
          declaration.file.path,
          {
            start: { line: declaration.startLine, column: declaration.startColumn },
            end: { line: declaration.startLine, column: declaration.startColumn + declaration.property.length },
          },
          cssLayoutTransitionLayoutProperty.id,
          "transitionLayoutProperty",
          resolveMessage(messages.transitionLayoutProperty, {
            property: target,
            declaration: declaration.property,
          }),
          "warn",
        ),
      )
    }
  },
})

function findLayoutTransitionTarget(raw: string): string | null {
  return findTransitionProperty(raw, LAYOUT_TRANSITION_PROPERTIES)
}
