import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const maxSpecificityScore = 800

const messages = {
  maxSpecificity:
    "Selector `{{selector}}` specificity {{specificity}} exceeds max {{max}}. Reduce selector weight to keep the cascade predictable.",
} as const

function formatSpecificityTuple(s: readonly number[]): string {
  return `(${s.join(",")})`
}

export const selectorMaxSpecificity = defineCSSRule({
  id: "selector-max-specificity",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow selectors that exceed a specificity threshold.",
    fixable: false,
    category: "css-selector",
  },
  options: { maxSpecificityScore },
  check(graph, emit) {
    for (const selector of graph.selectors) {
      if (selector.specificityScore <= maxSpecificityScore) continue

      emitCSSDiagnostic(
        emit,
        selector.rule.file.path,
        selector.rule.startLine,
        selector.rule.startColumn,
        selectorMaxSpecificity,
        "maxSpecificity",
        resolveMessage(messages.maxSpecificity, {
          selector: selector.raw,
          specificity: formatSpecificityTuple(selector.specificity),
          max: String(maxSpecificityScore),
        }),
      )
    }
  },
})
