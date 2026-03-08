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
      if (p.type !== "Property") return
      const n = objectKeyName(p.key)
      if (!n) return
      const v = p.value
      if (v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression") {
        emit(createDiagnostic(solid.file, v, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
        return
      }
      if (v.type === "Identifier" && solid.typeResolver.isCallableType(v)) {
        emit(createDiagnostic(solid.file, v, jsxStyleNoFunctionValues.id, "functionStyleValue", resolveMessage(messages.functionStyleValue, { name: n }), "error"))
      }
    })
  },
})
