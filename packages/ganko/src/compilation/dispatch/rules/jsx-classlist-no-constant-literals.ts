import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  constantEntry: "classList entry `{{name}}: {{value}}` is constant; move it to static class.",
} as const

export const jsxClasslistNoConstantLiterals = defineAnalysisRule({
  id: "jsx-classlist-no-constant-literals",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow classList entries with constant true/false values.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      const properties = solidTree.classListProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        if (!ts.isPropertyAssignment(p)) continue
        const n = getPropertyKeyName(p.name)
        if (!n) continue
        const val = p.initializer
        if (val.kind !== ts.SyntaxKind.TrueKeyword && val.kind !== ts.SyntaxKind.FalseKeyword) continue
        emit(createDiagnostic(solidTree.filePath, val, solidTree.sourceFile, jsxClasslistNoConstantLiterals.id, "constantEntry", resolveMessage(messages.constantEntry, { name: n, value: val.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false" }), "warn"))
      }
    })
  },
})
