import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const PHYSICAL_TO_LOGICAL = new Map([
  ["margin-left", "margin-inline-start"],
  ["margin-right", "margin-inline-end"],
  ["padding-left", "padding-inline-start"],
  ["padding-right", "padding-inline-end"],
  ["left", "inset-inline-start"],
  ["right", "inset-inline-end"],
])

const messages = {
  preferLogical: "Use logical property `{{logical}}` instead of `{{physical}}`.",
} as const

export const cssPreferLogicalProperties = defineAnalysisRule({
  id: "css-prefer-logical-properties",
  severity: "warn",
  messages,
  meta: { description: "Prefer logical properties over physical left/right properties.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (const [physical, logical] of PHYSICAL_TO_LOGICAL) {
        const decls = tree.declarationsByProperty.get(physical)
        if (!decls) continue
        for (let i = 0; i < decls.length; i++) {
          const d = decls[i]
          if (!d) continue
          emit(createCSSDiagnostic(
            d.file.path, d.startLine, d.startColumn,
            cssPreferLogicalProperties.id, "preferLogical",
            resolveMessage(messages.preferLogical, { logical, physical }), "warn",
          ))
        }
      }
    })
  },
})
