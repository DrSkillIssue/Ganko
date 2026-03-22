import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getScopeFor, getVariableByNameInScope } from "../../../solid/queries/scope"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  accessorReference: "Signal accessor `{{name}}` must be called in classList value (use {{name}}()).",
} as const

export const jsxClasslistNoAccessorReference = defineAnalysisRule({
  id: "jsx-classlist-no-accessor-reference",
  severity: "error",
  messages,
  meta: {
    description: "Disallow passing accessor references directly as classList values.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      const properties = solidTree.classListProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        let v: ts.Identifier
        if (ts.isShorthandPropertyAssignment(p)) {
          v = p.name
        } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) {
          v = p.initializer
        } else {
          continue
        }
        const scope = getScopeFor(solidTree, v)
        const variable = getVariableByNameInScope(solidTree, v.text, scope)
        if (!variable) continue

        const isAccessorLike = variable.reactiveKind === "accessor" || variable.reactiveKind === "signal"
        if (!isAccessorLike) continue

        const typeInfo = solidTree.typeResolver.getType(v)
        if (typeInfo) {
          if (!typeInfo.isAccessor && !typeInfo.isSignal) continue
        }

        emit(createDiagnostic(solidTree.filePath, v, solidTree.sourceFile, jsxClasslistNoAccessorReference.id, "accessorReference", resolveMessage(messages.accessorReference, { name: v.text }), "error"))
      }
    })
  },
})
