import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { findTransitionProperty, findPropertyInList } from "../../parser/value-util"

const discrete = new Set([
  "display",
  "position",
  "overflow",
  "overflow-x",
  "overflow-y",
  "visibility",
  "float",
  "clear",
])

const messages = {
  discreteTransition: "Property `{{property}}` is discrete and should not be transitioned.",
} as const

export const cssNoDiscreteTransition = defineCSSRule({
  id: "css-no-discrete-transition",
  severity: "error",
  messages,
  meta: {
    description: "Disallow transitions on discrete CSS properties.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    const decls = graph.declarationsForProperties("transition", "transition-property")
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (!d) continue
      const p = d.property.toLowerCase()
      const bad = p === "transition"
        ? findTransitionProperty(d.value, discrete)
        : findPropertyInList(d.value, discrete)
      if (!bad) continue

      emitCSSDiagnostic(
        emit,
        d.file.path,
        d.startLine,
        d.startColumn,
        cssNoDiscreteTransition,
        "discreteTransition",
        resolveMessage(messages.discreteTransition, { property: bad }),
      )
    }
  },
})
