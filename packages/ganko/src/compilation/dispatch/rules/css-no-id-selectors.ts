import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { hasFlag, SEL_HAS_ID } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  avoidId: "Avoid ID selector in `{{selector}}`. IDs raise specificity and make component-level styling harder to maintain.",
} as const

export const cssNoIdSelectors = defineAnalysisRule({
  id: "no-id-selectors",
  severity: "warn",
  messages,
  meta: { description: "Disallow ID selectors.", fixable: false, category: "css-selector" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.selectors.length; i++) {
        const selector = tree.selectors[i]
        if (!selector) continue
        if (!hasFlag(selector.complexity._flags, SEL_HAS_ID)) continue
        emit(createDiagnosticFromLoc(selector.rule.file.path, { start: { line: selector.rule.startLine, column: selector.rule.startColumn }, end: { line: selector.rule.startLine, column: selector.rule.startColumn + 1 } }, cssNoIdSelectors.id, "avoidId", resolveMessage(messages.avoidId, { selector: selector.raw }), "warn"))
      }
    })
  },
})
