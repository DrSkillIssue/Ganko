import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { forEachClassListPropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"

const messages = {
  constantEntry: "classList entry `{{name}}: {{value}}` is constant; move it to static class.",
} as const

export const jsxClasslistNoConstantLiterals = defineCrossRule({
  id: "jsx-classlist-no-constant-literals",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow classList entries with constant true/false values.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachClassListPropertyAcross(solids, (solid, p) => {
      if (p.type !== "Property") return
      const n = objectKeyName(p.key)
      if (!n) return
      if (p.value.type !== "Literal") return
      if (typeof p.value.value !== "boolean") return

      emit(createDiagnostic(
        solid.file,
        p.value,
        jsxClasslistNoConstantLiterals.id,
        "constantEntry",
        resolveMessage(messages.constantEntry, { name: n, value: String(p.value.value) }),
        "warn",
      ))
    })
  },
})
