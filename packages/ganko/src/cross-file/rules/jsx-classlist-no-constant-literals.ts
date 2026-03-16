import ts from "typescript"
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
      if (!ts.isPropertyAssignment(p)) return
      const n = objectKeyName(p.name)
      if (!n) return
      const val = p.initializer
      if (val.kind !== ts.SyntaxKind.TrueKeyword && val.kind !== ts.SyntaxKind.FalseKeyword) return

      emit(createDiagnostic(
        solid.file,
        val,
        solid.sourceFile,
        jsxClasslistNoConstantLiterals.id,
        "constantEntry",
        resolveMessage(messages.constantEntry, { name: n, value: val.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false" }),
        "warn",
      ))
    })
  },
})
