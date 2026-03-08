import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  unusedKeyframes: "@keyframes `{{name}}` is never referenced by animation declarations.",
} as const

export const noUnusedKeyframes = defineCSSRule({
  id: "no-unused-keyframes",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow unused @keyframes declarations.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    for (const keyframes of graph.unusedKeyframes) {
      const name = keyframes.parsedParams.animationName
      if (!name) continue

      emitCSSDiagnostic(
        emit,
        keyframes.file.path,
        keyframes.startLine,
        1,
        noUnusedKeyframes,
        "unusedKeyframes",
        resolveMessage(messages.unusedKeyframes, { name }),
      )
    }
  },
})
