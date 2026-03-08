import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  unknownAnimationName:
    "Animation name `{{name}}` in `{{property}}` does not match any declared @keyframes.",
} as const

export const noUnknownAnimationName = defineCSSRule({
  id: "no-unknown-animation-name",
  severity: "error",
  messages,
  meta: {
    description: "Disallow animation names that do not match declared keyframes.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    for (let i = 0; i < graph.unresolvedAnimationRefs.length; i++) {
      const ref = graph.unresolvedAnimationRefs[i]
      if (!ref) continue
      emitCSSDiagnostic(
        emit,
        ref.declaration.file.path,
        ref.declaration.startLine,
        ref.declaration.startColumn,
        noUnknownAnimationName,
        "unknownAnimationName",
        resolveMessage(messages.unknownAnimationName, {
          name: ref.name,
          property: ref.declaration.property,
        }),
      )
    }
  },
})
