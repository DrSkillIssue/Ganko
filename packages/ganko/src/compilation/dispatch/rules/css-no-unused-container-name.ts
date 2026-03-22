import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { parseContainerQueryName, parseContainerNames, parseContainerNamesFromShorthand } from "../../../css/parser/value-util"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unusedContainer: "Container name `{{name}}` is declared but never queried.",
} as const

export const cssNoUnusedContainerName = defineAnalysisRule({
  id: "css-no-unused-container-name",
  severity: "warn",
  messages,
  meta: { description: "Disallow unused named containers.", fixable: false, category: "css-structure" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      const queriedNames = new Set<string>()
      for (const [, tree] of compilation.cssTrees) {
        const containers = tree.atRulesByKind.get("container")
        if (!containers) continue
        for (let i = 0; i < containers.length; i++) {
          const at = containers[i]
          if (!at) continue
          const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params)
          if (name) queriedNames.add(name)
        }
      }
      for (const [, tree] of compilation.cssTrees) {
        for (let i = 0; i < tree.declarations.length; i++) {
          const d = tree.declarations[i]
          if (!d) continue
          const p = d.property.toLowerCase()
          let names: readonly string[] | null = null
          if (p === "container-name") names = parseContainerNames(d.value)
          else if (p === "container") names = parseContainerNamesFromShorthand(d.value)
          if (!names) continue
          for (let j = 0; j < names.length; j++) {
            const name = names[j]
            if (!name || queriedNames.has(name)) continue
            emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssNoUnusedContainerName.id, "unusedContainer", resolveMessage(messages.unusedContainer, { name }), "warn"))
          }
        }
      }
    })
  },
})
