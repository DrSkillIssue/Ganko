import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  overriddenWithinRule: "Declaration `{{property}}` is overridden later in the same rule. Keep one final declaration per property.",
} as const

export const cssDeclarationNoOverriddenWithinRule = defineAnalysisRule({
  id: "declaration-no-overridden-within-rule",
  severity: "warn",
  messages,
  meta: { description: "Disallow duplicate declarations of the same property within a single rule block.", fixable: false, category: "css-cascade" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.rules.length; i++) {
        const rule = tree.rules[i]
        if (!rule || rule.declarations.length < 2) continue
        for (const [property, decls] of rule.declarationIndex) {
          if (decls.length < 2) continue
          for (let j = 0; j < decls.length - 1; j++) {
            const overridden = decls[j]
            if (!overridden) continue
            emit(createCSSDiagnostic(
              overridden.file.path, overridden.startLine, overridden.startColumn,
              cssDeclarationNoOverriddenWithinRule.id, "overriddenWithinRule",
              resolveMessage(messages.overriddenWithinRule, { property }), "warn",
            ))
          }
        }
      }
    })
  },
})
