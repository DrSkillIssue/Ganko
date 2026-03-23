import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { isBooleanish, isDefinitelyNonBoolean } from "../../../solid/util/static-value"
import { isBooleanType, isDefinitelyNonBooleanType } from "../../../solid/util/type-flags"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  nonBooleanValue: "classList value for `{{name}}` must be boolean.",
} as const

export const jsxClasslistBooleanValues = defineAnalysisRule({
  id: "jsx-classlist-boolean-values",
  severity: "error",
  messages,
  meta: {
    description: "Require classList values to be boolean-like expressions.",
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
        if (isBooleanish(p.initializer)) continue
        if (isDefinitelyNonBoolean(p.initializer)) {
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
          return
        }
        if (isBooleanType(solidTree, p.initializer)) continue
        if (!isDefinitelyNonBooleanType(solidTree, p.initializer)) continue
        emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
      }
    })
  },
})
