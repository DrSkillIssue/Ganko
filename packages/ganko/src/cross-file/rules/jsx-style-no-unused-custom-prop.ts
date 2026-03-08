import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { getJSXAttributesByKind } from "../../solid/queries/jsx"
import { hasOnlyStaticClassLiterals, objectKeyName } from "../../solid/queries/jsx-derived"

const messages = {
  unusedInlineVar: "Inline custom property `{{name}}` is never read via var({{name}}).",
} as const

export const jsxStyleNoUnusedCustomProp = defineCrossRule({
  id: "jsx-style-no-unused-custom-prop",
  severity: "warn",
  messages,
  meta: {
    description: "Detect inline style custom properties that are never consumed by CSS var() references.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids, css } = context
    const used = new Set<string>()
    for (let i = 0; i < css.variableRefs.length; i++) {
      const ref = css.variableRefs[i]
      if (!ref) continue
      used.add(ref.name)
    }

    const eligible = []
    for (let s = 0; s < solids.length; s++) {
      const solid = solids[s]
      if (!solid) continue
      const classListAttrs = getJSXAttributesByKind(solid, "classList")
      if (classListAttrs.length > 0) continue
      if (!hasOnlyStaticClassLiterals(solid)) continue
      eligible.push(solid)
    }

    for (let s = 0; s < eligible.length; s++) {
      const solid = eligible[s]
      if (!solid) continue
      const properties = solid.styleProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        if (p.type !== "Property") continue
        const n = objectKeyName(p.key)
        if (!n || !n.startsWith("--")) continue
        if (used.has(n)) continue

        emit(createDiagnostic(
          solid.file,
          p.key,
          jsxStyleNoUnusedCustomProp.id,
          "unusedInlineVar",
          resolveMessage(messages.unusedInlineVar, { name: n }),
          "warn",
        ))
      }
    }
  },
})
