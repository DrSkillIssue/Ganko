import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  functionStyleValue: "Style value for `{{name}}` is a function; pass computed value instead.",
} as const

export const jsxStyleNoFunctionValues = defineAnalysisRule({
  id: "jsx-style-no-function-values",
  severity: "error",
  messages,
  meta: {
    description: "Disallow function values in JSX style objects.",
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
        const n = getPropertyKeyName(p.name)
        if (!n) continue
        const v = p.initializer
        if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) {
          emit(createDiagnostic(solidTree.filePath, v, solidTree.sourceFile, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
          continue
        }
        if (ts.isIdentifier(v) && solidTree.typeResolver.isCallableType(v)) {
          emit(createDiagnostic(solidTree.filePath, v, solidTree.sourceFile, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
        }
      }
    })
  },
})
