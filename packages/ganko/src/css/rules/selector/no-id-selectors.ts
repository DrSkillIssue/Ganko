import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  avoidId:
    "Avoid ID selector in `{{selector}}`. IDs raise specificity and make component-level styling harder to maintain.",
} as const

export const noIdSelectors = defineCSSRule({
  id: "no-id-selectors",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow ID selectors.",
    fixable: false,
    category: "css-selector",
  },
  options: {},
  check(graph, emit) {
    const selectors = graph.idSelectors
    for (let i = 0, len = selectors.length; i < len; i++) {
      const selector = selectors[i]
      if (!selector) continue
      emitCSSDiagnostic(
        emit,
        selector.rule.file.path,
        selector.rule.startLine,
        selector.rule.startColumn,
        noIdSelectors,
        "avoidId",
        resolveMessage(messages.avoidId, { selector: selector.raw }),
      )
    }
  },
})
