import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { forEachStylePropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"

const messages = {
  functionStyleValue: "Style value for `{{name}}` is a function; pass computed value instead.",
} as const

export const jsxStyleNoFunctionValues = defineCrossRule({
  id: "jsx-style-no-function-values",
  severity: "error",
  messages,
  meta: {
    description: "Disallow function values in JSX style objects.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachStylePropertyAcross(solids, (solid, p) => {
      if (!ts.isPropertyAssignment(p)) return
      const n = objectKeyName(p.name)
      if (!n) return
      const v = p.initializer
      if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) {
        emit(createDiagnostic(solid.file, v, solid.sourceFile, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
        return
      }
      if (ts.isIdentifier(v) && solid.typeResolver.isCallableType(v)) {
        emit(createDiagnostic(solid.file, v, solid.sourceFile, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
      }
    })
  },
})
