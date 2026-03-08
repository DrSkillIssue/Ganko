import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  duplicateSelector:
    "Selector `{{selector}}` is duplicated {{count}} times. Merge declarations to avoid cascade ambiguity.",
} as const

export const noDuplicateSelectors = defineCSSRule({
  id: "no-duplicate-selectors",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow duplicate selector blocks.",
    fixable: false,
    category: "css-selector",
  },
  options: {},
  check(graph, emit) {
    for (const [, entry] of graph.duplicateSelectors) {
      const count = String(entry.rules.length)
      const msg = resolveMessage(messages.duplicateSelector, { selector: entry.selector, count })

      for (const rule of entry.rules) {
        emitCSSDiagnostic(
          emit,
          rule.file.path,
          rule.startLine,
          rule.startColumn,
          noDuplicateSelectors,
          "duplicateSelector",
          msg,
        )
      }
    }
  },
})
