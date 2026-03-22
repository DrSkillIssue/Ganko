import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { hasFlag, VAR_IS_SCSS, VAR_IS_USED } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unusedCustomProperty: "Custom property `{{name}}` is never referenced within the project CSS.",
} as const

export const cssNoUnusedCustomProperties = defineAnalysisRule({
  id: "no-unused-custom-properties",
  severity: "warn",
  messages,
  meta: { description: "Disallow unused CSS custom properties.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      for (const [, tree] of compilation.cssTrees) {
        for (let i = 0; i < tree.variables.length; i++) {
          const variable = tree.variables[i]
          if (!variable) continue
          if (hasFlag(variable._flags, VAR_IS_USED)) continue
          if (hasFlag(variable._flags, VAR_IS_SCSS)) continue
          if (variable.scope.type === "global") continue
          emit(createCSSDiagnostic(
            variable.file.path, variable.declaration.startLine, variable.declaration.startColumn,
            cssNoUnusedCustomProperties.id, "unusedCustomProperty",
            resolveMessage(messages.unusedCustomProperty, { name: variable.name }), "warn",
          ))
        }
      }
    })
  },
})
