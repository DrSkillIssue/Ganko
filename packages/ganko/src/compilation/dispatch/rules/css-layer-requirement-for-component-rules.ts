import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = { missingLayer: "Rule `{{selector}}` is not inside any @layer block while this file uses @layer. Place component rules inside an explicit layer." } as const

export const cssLayerRequirementForComponentRules = defineAnalysisRule({
  id: "layer-requirement-for-component-rules",
  severity: "warn",
  messages,
  meta: { description: "Require style rules to be inside @layer when the file defines layers.", fixable: false, category: "css-structure" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const layers = tree.atRulesByKind.get("layer")
      if (!layers || layers.length === 0) return
      for (let i = 0; i < tree.rules.length; i++) {
        const rule = tree.rules[i]; if (!rule || rule.containingLayer) continue
        emit(createCSSDiagnostic(
          rule.file.path, rule.startLine, rule.startColumn,
          cssLayerRequirementForComponentRules.id, "missingLayer",
          resolveMessage(messages.missingLayer, { selector: rule.selectorText }), "warn",
        ))
      }
    })
  },
})
