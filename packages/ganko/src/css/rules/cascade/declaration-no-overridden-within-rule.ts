import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  overriddenWithinRule:
    "Declaration `{{property}}` is overridden later in the same rule. Keep one final declaration per property.",
} as const

export const declarationNoOverriddenWithinRule = defineCSSRule({
  id: "declaration-no-overridden-within-rule",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow duplicate declarations of the same property within a single rule block.",
    fixable: false,
    category: "css-cascade",
  },
  options: {},
  check(graph, emit) {
    for (const rule of graph.rules) {
      if (rule.declarations.length < 2) continue

      for (const [property, decls] of rule.declarationIndex) {
        if (decls.length < 2) continue
        for (let i = 0; i < decls.length - 1; i++) {
          const overridden = decls[i]
          if (!overridden) continue
          emitCSSDiagnostic(
            emit,
            overridden.file.path,
            overridden.startLine,
            overridden.startColumn,
            declarationNoOverriddenWithinRule,
            "overriddenWithinRule",
            resolveMessage(messages.overriddenWithinRule, { property }),
          )
        }
      }
    }
  },
})
