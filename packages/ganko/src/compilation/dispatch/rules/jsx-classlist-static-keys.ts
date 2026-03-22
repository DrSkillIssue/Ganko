import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  nonStaticKey: "classList key must be statically known for reliable class mapping.",
} as const

export const jsxClasslistStaticKeys = defineAnalysisRule({
  id: "jsx-classlist-static-keys",
  severity: "error",
  messages,
  meta: {
    description: "Require classList keys to be static and non-computed.",
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
        if (ts.isSpreadAssignment(p)) continue
        if (!ts.isPropertyAssignment(p)) {
          emit(createDiagnostic(solidTree.filePath, p, solidTree.sourceFile, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
          continue
        }
        if (ts.isComputedPropertyName(p.name)) continue
        if (ts.isIdentifier(p.name)) continue
        if (ts.isStringLiteral(p.name)) continue
        emit(createDiagnostic(solidTree.filePath, p.name, solidTree.sourceFile, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
      }
    })
  },
})
