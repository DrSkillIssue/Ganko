import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  emptyKeyframes: "@keyframes `{{name}}` has no effective keyframes.",
} as const

export const cssNoEmptyKeyframes = defineCSSRule({
  id: "css-no-empty-keyframes",
  severity: "error",
  messages,
  meta: {
    description: "Disallow empty @keyframes rules.",
    fixable: false,
    category: "css-animation",
  },
  options: {},
  check(graph, emit) {
    for (let i = 0; i < graph.emptyKeyframes.length; i++) {
      const kf = graph.emptyKeyframes[i]
      if (!kf) continue
      const name = kf.parsedParams.animationName
      if (!name) continue
      emitCSSDiagnostic(
        emit,
        kf.file.path,
        kf.startLine,
        1,
        cssNoEmptyKeyframes,
        "emptyKeyframes",
        resolveMessage(messages.emptyKeyframes, { name }),
      )
    }
  },
})
