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
      if (p.type !== "Property") return
      const n = objectKeyName(p.key)
      if (!n) return
      if (isBooleanish(p.value)) return
      if (isDefinitelyNonBoolean(p.value)) {
        emit(createDiagnostic(solid.file, p.value, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
        return
      }
      if (isBooleanType(solid, p.value)) return
      if (!isDefinitelyNonBooleanType(solid, p.value)) return
      emit(createDiagnostic(solid.file, p.value, jsxClasslistBooleanValues.id, "nonBooleanValue", resolveMessage(messages.nonBooleanValue, { name: n }), "error"))
    })
  },
})
