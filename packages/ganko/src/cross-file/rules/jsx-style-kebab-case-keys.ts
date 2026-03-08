import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { isKebabCase } from "@ganko/shared"
import { forEachStylePropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"
import { normalizeStylePropertyKey } from "./rule-runtime"

const messages = {
  kebabStyleKey: "Style key `{{name}}` should be `{{kebab}}` in Solid style objects.",
} as const

export const jsxStyleKebabCaseKeys = defineCrossRule({
  id: "jsx-style-kebab-case-keys",
  severity: "error",
  messages,
  meta: {
    description: "Require kebab-case keys in JSX style object literals.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachStylePropertyAcross(solids, (solid, p) => {
      if (p.type !== "Property") return
      if (p.computed) return
      const n = objectKeyName(p.key)
      if (!n) return
      const kebab = normalizeStylePropertyKey(n)
      if (n === kebab && isKebabCase(n)) return

      emit(createDiagnostic(
        solid.file,
        p.key,
        jsxStyleKebabCaseKeys.id,
        "kebabStyleKey",
        resolveMessage(messages.kebabStyleKey, { name: n, kebab }),
        "error",
      ))
    })
  },
})
