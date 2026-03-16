import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { forEachClassListPropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"
import { isBooleanish, isDefinitelyNonBoolean } from "../../solid/util/static-value"
import { isBooleanType, isDefinitelyNonBooleanType } from "../../solid/util/type-flags"

const messages = {
  nonBooleanValue: "classList value for `{{name}}` must be boolean.",
} as const

export const jsxClasslistBooleanValues = defineCrossRule({
  id: "jsx-classlist-boolean-values",
  severity: "error",
  messages,
  meta: {
    description: "Require classList values to be boolean-like expressions.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachClassListPropertyAcross(solids, (solid, p) => {
      if (!ts.isPropertyAssignment(p)) return
      const n = objectKeyName(p.name)
      if (!n) return
      if (isBooleanish(p.initializer)) return
      if (isDefinitelyNonBoolean(p.initializer)) {
        emit(createDiagnostic(solid.file, p.initializer, solid.sourceFile, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
        return
      }
      if (isBooleanType(solid, p.initializer)) return
      if (!isDefinitelyNonBooleanType(solid, p.initializer)) return
      emit(createDiagnostic(solid.file, p.initializer, solid.sourceFile, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
    })
  },
})
