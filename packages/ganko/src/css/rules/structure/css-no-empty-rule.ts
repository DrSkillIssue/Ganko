import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  emptyRule: "Empty rule `{{selector}}` should be removed.",
} as const

export const cssNoEmptyRule = defineCSSRule({
  id: "css-no-empty-rule",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow empty CSS rules.",
    fixable: false,
    category: "css-structure",
  },
  options: {},
  check(graph, emit) {
    for (let i = 0; i < graph.emptyRules.length; i++) {
      const rule = graph.emptyRules[i]
      if (!rule) continue
      emitCSSDiagnostic(
        emit,
        rule.file.path,
        rule.startLine,
        rule.startColumn,
        cssNoEmptyRule,
        "emptyRule",
        resolveMessage(messages.emptyRule, { selector: rule.selectorText }),
      )
    }
  },
})
