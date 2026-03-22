import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { isBlank } from "@drskillissue/ganko-shared"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unresolvedCustomProperty: "Custom property reference `{{name}}` is unresolved in `{{property}}`. Define it or provide a fallback value.",
} as const

export const cssNoUnresolvedCustomProperties = defineAnalysisRule({
  id: "no-unresolved-custom-properties",
  severity: "error",
  messages,
  meta: { description: "Disallow unresolved custom property references.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.unresolvedRefs.length; i++) {
        const ref = tree.unresolvedRefs[i]
        if (!ref) continue
        if (ref.fallback && !isBlank(ref.fallback)) continue
        emit(createCSSDiagnostic(
          ref.file.path, ref.declaration.startLine, ref.declaration.startColumn,
          cssNoUnresolvedCustomProperties.id, "unresolvedCustomProperty",
          resolveMessage(messages.unresolvedCustomProperty, { name: ref.name, property: ref.declaration.property }), "error",
        ))
      }
    })
  },
})
