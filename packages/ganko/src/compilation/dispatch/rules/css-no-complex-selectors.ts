import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  selectorTooDeep: "Selector `{{selector}}` has depth {{depth}}. Deep selectors increase style recalculation cost and are fragile across component rerenders.",
} as const

const MAX_DEPTH = 3

export const cssNoComplexSelectors = defineAnalysisRule({
  id: "no-complex-selectors",
  severity: "warn",
  messages,
  meta: { description: "Disallow deep selectors that are expensive to match.", fixable: false, category: "css-selector" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.selectors.length; i++) {
        const selector = tree.selectors[i]
        if (!selector) continue
        if (selector.complexity.depth <= MAX_DEPTH) continue
        emit(createCSSDiagnostic(
          selector.rule.file.path, selector.rule.startLine, selector.rule.startColumn,
          cssNoComplexSelectors.id, "selectorTooDeep",
          resolveMessage(messages.selectorTooDeep, { selector: selector.raw, depth: String(selector.complexity.depth) }), "warn",
        ))
      }
    })
  },
})
