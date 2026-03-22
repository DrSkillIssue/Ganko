import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { parseContainerQueryName, parseContainerNames, parseContainerNamesFromShorthand } from "../../../css/parser/value-util"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unknownContainer: "Unknown container name `{{name}}` in @container query.",
} as const

export const cssNoUnknownContainerName = defineAnalysisRule({
  id: "css-no-unknown-container-name",
  severity: "error",
  messages,
  meta: { description: "Disallow unknown named containers in @container queries.", fixable: false, category: "css-structure" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      const declaredNames = new Set<string>()
      for (const [, tree] of compilation.cssTrees) {
        for (let i = 0; i < tree.declarations.length; i++) {
          const d = tree.declarations[i]
          if (!d) continue
          const p = d.property.toLowerCase()
          let names: readonly string[] | null = null
          if (p === "container-name") names = parseContainerNames(d.value)
          else if (p === "container") names = parseContainerNamesFromShorthand(d.value)
          if (!names) continue
          for (let j = 0; j < names.length; j++) { const n = names[j]; if (n) declaredNames.add(n) }
        }
      }
      for (const [, tree] of compilation.cssTrees) {
        const containers = tree.atRulesByKind.get("container")
        if (!containers) continue
        for (let i = 0; i < containers.length; i++) {
          const at = containers[i]
          if (!at) continue
          const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params)
          if (!name || declaredNames.has(name)) continue
          emit(createDiagnosticFromLoc(at.file.path, { start: { line: at.startLine, column: 1 }, end: { line: at.startLine, column: 2 } }, cssNoUnknownContainerName.id, "unknownContainer", resolveMessage(messages.unknownContainer, { name }), "error"))
        }
      }
    })
  },
})
