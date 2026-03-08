import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const maxDepth = 3

const messages = {
  selectorTooDeep:
    "Selector `{{selector}}` has depth {{depth}}. Deep selectors increase style recalculation cost and are fragile across component rerenders.",
} as const

export const noComplexSelectors = defineCSSRule({
  id: "no-complex-selectors",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow deep selectors that are expensive to match.",
    fixable: false,
    category: "css-selector",
  },
  options: { maxDepth },
  check(graph, emit) {
    for (const selector of graph.selectors) {
      if (selector.complexity.depth <= maxDepth) continue

      emitCSSDiagnostic(
        emit,
        selector.rule.file.path,
        selector.rule.startLine,
        selector.rule.startColumn,
        noComplexSelectors,
        "selectorTooDeep",
        resolveMessage(messages.selectorTooDeep, {
          selector: selector.raw,
          depth: String(selector.complexity.depth),
        }),
      )
    }
  },
})
