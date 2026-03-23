import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { hasFlag, SEL_HAS_ATTRIBUTE, SEL_HAS_UNIVERSAL } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  tooManyAttributes: "Selector `{{selector}}` uses attribute selector(s). Maximum allowed is 0.",
  tooManyUniversals: "Selector `{{selector}}` uses universal selector(s). Maximum allowed is 0.",
} as const

export const cssSelectorMaxAttributeAndUniversal = defineAnalysisRule({
  id: "selector-max-attribute-and-universal",
  severity: "off",
  messages,
  meta: { description: "Disallow selectors with attribute or universal selectors.", fixable: false, category: "css-selector" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.selectors.length; i++) {
        const selector = tree.selectors[i]
        if (!selector) continue
        const flags = selector.complexity._flags
        if (hasFlag(flags, SEL_HAS_ATTRIBUTE)) {
          emit(createCSSDiagnostic(
            selector.rule.file.path, selector.rule.startLine, selector.rule.startColumn,
            cssSelectorMaxAttributeAndUniversal.id, "tooManyAttributes",
            resolveMessage(messages.tooManyAttributes, { selector: selector.raw }), "warn",
          ))
        }
        if (hasFlag(flags, SEL_HAS_UNIVERSAL)) {
          emit(createCSSDiagnostic(
            selector.rule.file.path, selector.rule.startLine, selector.rule.startColumn,
            cssSelectorMaxAttributeAndUniversal.id, "tooManyUniversals",
            resolveMessage(messages.tooManyUniversals, { selector: selector.raw }), "warn",
          ))
        }
      }
    })
  },
})
