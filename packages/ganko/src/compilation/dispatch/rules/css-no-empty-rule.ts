import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  emptyRule: "Empty rule `{{selector}}` should be removed.",
} as const

export const cssNoEmptyRule = defineAnalysisRule({
  id: "css-no-empty-rule",
  severity: "warn",
  messages,
  meta: { description: "Disallow empty CSS rules.", fixable: false, category: "css-structure" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.rules.length; i++) {
        const rule = tree.rules[i]
        if (!rule) continue
        if (rule.declarations.length > 0 || rule.nestedRules.length > 0 || rule.nestedAtRules.length > 0) continue
        emit(createDiagnosticFromLoc(rule.file.path, { start: { line: rule.startLine, column: rule.startColumn }, end: { line: rule.startLine, column: rule.startColumn + 1 } }, cssNoEmptyRule.id, "emptyRule", resolveMessage(messages.emptyRule, { selector: rule.selectorText }), "warn"))
      }
    })
  },
})
