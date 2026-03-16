import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { getScopeFor, getVariableByNameInScope } from "../../solid/queries/scope"
import { defineCrossRule } from "../rule"
import { forEachClassListPropertyAcross } from "../../solid/queries/jsx-derived"

const messages = {
  accessorReference: "Signal accessor `{{name}}` must be called in classList value (use {{name}}()).",
} as const

export const jsxClasslistNoAccessorReference = defineCrossRule({
  id: "jsx-classlist-no-accessor-reference",
  severity: "error",
  messages,
  meta: {
    description: "Disallow passing accessor references directly as classList values.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachClassListPropertyAcross(solids, (solid, p) => {
      let v: ts.Identifier
      if (ts.isShorthandPropertyAssignment(p)) {
        v = p.name
      } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) {
        v = p.initializer
      } else {
        return
      }
      const scope = getScopeFor(solid, v)
      const variable = getVariableByNameInScope(solid, v.text, scope)
      if (!variable) return

      const isAccessorLike = variable.reactiveKind === "accessor" || variable.reactiveKind === "signal"
      if (!isAccessorLike) return

      const typeInfo = solid.typeResolver.getType(v)
      if (typeInfo) {
        if (!typeInfo.isAccessor && !typeInfo.isSignal) return
      }

      emit(createDiagnostic(
        solid.file,
        v,
        solid.sourceFile,
        jsxClasslistNoAccessorReference.id,
        "accessorReference",
        resolveMessage(messages.accessorReference, { name: v.text }),
        "error",
      ))
    })
  },
})
