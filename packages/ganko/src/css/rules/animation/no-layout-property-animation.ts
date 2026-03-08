import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { findTransitionProperty, findPropertyInList } from "../../parser/value-util"
import { isLayoutAnimationExempt } from "./layout-animation-exempt"

const layoutProperties = new Set([
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "flex-basis",
])

const messages = {
  avoidLayoutAnimation:
    "Avoid animating layout property `{{property}}`. Prefer transform or opacity to reduce layout thrashing.",
} as const

export const noLayoutPropertyAnimation = defineCSSRule({
  id: "no-layout-property-animation",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow animating layout-affecting properties.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    const transitionDecls = graph.declarationsForProperties("transition", "transition-property")
    for (let i = 0; i < transitionDecls.length; i++) {
      const declaration = transitionDecls[i]
      if (!declaration) continue
      const property = declaration.property.toLowerCase()
      const layoutProperty = property === "transition"
        ? findTransitionProperty(declaration.value, layoutProperties)
        : findPropertyInList(declaration.value, layoutProperties)
      if (!layoutProperty) continue
      if (isLayoutAnimationExempt(declaration, layoutProperty)) continue

      emitCSSDiagnostic(
        emit,
        declaration.file.path,
        declaration.startLine,
        declaration.startColumn,
        noLayoutPropertyAnimation,
        "avoidLayoutAnimation",
        resolveMessage(messages.avoidLayoutAnimation, { property: layoutProperty }),
      )
    }

    for (let i = 0; i < graph.keyframeDeclarations.length; i++) {
      const declaration = graph.keyframeDeclarations[i]
      if (!declaration) continue
      const property = declaration.property.toLowerCase()
      if (!layoutProperties.has(property)) continue

      emitCSSDiagnostic(
        emit,
        declaration.file.path,
        declaration.startLine,
        declaration.startColumn,
        noLayoutPropertyAnimation,
        "avoidLayoutAnimation",
        resolveMessage(messages.avoidLayoutAnimation, { property }),
      )
    }
  },
})
