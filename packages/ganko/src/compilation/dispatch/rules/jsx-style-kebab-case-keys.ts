import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { isKebabCase, toKebabCase } from "@drskillissue/ganko-shared"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  kebabStyleKey: "Style key `{{name}}` should be `{{kebab}}` in Solid style objects.",
} as const

export const jsxStyleKebabCaseKeys = defineAnalysisRule({
  id: "jsx-style-kebab-case-keys",
  severity: "error",
  messages,
  meta: {
    description: "Require kebab-case keys in JSX style object literals.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      const properties = solidTree.styleProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        if (!ts.isPropertyAssignment(p)) continue
        if (ts.isComputedPropertyName(p.name)) continue
        const n = getPropertyKeyName(p.name)
        if (!n) continue
        const kebab = n.includes("-") ? n.toLowerCase() : toKebabCase(n)
        if (n === kebab && isKebabCase(n)) continue

        emit(createDiagnostic(solidTree.filePath, p.name, solidTree.sourceFile, jsxStyleKebabCaseKeys.id, "kebabStyleKey", resolveMessage(messages.kebabStyleKey, { name: n, kebab }), "error"))
      }
    })
  },
})
