import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  maxSpecificity: "Selector `{{selector}}` specificity {{specificity}} exceeds max {{max}}. Reduce selector weight to keep the cascade predictable.",
} as const

const MAX_SPECIFICITY_SCORE = 800

export const cssSelectorMaxSpecificity = defineAnalysisRule({
  id: "selector-max-specificity",
  severity: "warn",
  messages,
  meta: { description: "Disallow selectors that exceed a specificity threshold.", fixable: false, category: "css-selector" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.selectors.length; i++) {
        const selector = tree.selectors[i]
        if (!selector) continue
        if (selector.specificityScore <= MAX_SPECIFICITY_SCORE) continue
        emit(createCSSDiagnostic(
          selector.rule.file.path, selector.rule.startLine, selector.rule.startColumn,
          cssSelectorMaxSpecificity.id, "maxSpecificity",
          resolveMessage(messages.maxSpecificity, { selector: selector.raw, specificity: `(${selector.specificity.join(",")})`, max: String(MAX_SPECIFICITY_SCORE) }), "warn",
        ))
      }
    })
  },
})
