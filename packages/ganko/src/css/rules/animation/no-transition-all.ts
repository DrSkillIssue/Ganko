import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  avoidTransitionAll:
    "Avoid `transition: all`. Transition specific properties to reduce unnecessary style and paint work.",
} as const

const WORD_ALL = /\ball\b/

function hasAllKeyword(value: string): boolean {
  return WORD_ALL.test(value)
}

export const noTransitionAll = defineCSSRule({
  id: "no-transition-all",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow transition: all and transition-property: all.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    const decls = graph.declarationsForProperties("transition", "transition-property")
    for (let i = 0; i < decls.length; i++) {
      const declaration = decls[i]
      if (!declaration) continue
      if (!hasAllKeyword(declaration.value)) continue

      emitCSSDiagnostic(
        emit,
        declaration.file.path,
        declaration.startLine,
        declaration.startColumn,
        noTransitionAll,
        "avoidTransitionAll",
        resolveMessage(messages.avoidTransitionAll),
      )
    }
  },
})
