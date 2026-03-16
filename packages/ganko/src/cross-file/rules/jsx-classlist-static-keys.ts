import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { forEachClassListPropertyAcross } from "../../solid/queries/jsx-derived"

const messages = {
  nonStaticKey: "classList key must be statically known for reliable class mapping.",
} as const

export const jsxClasslistStaticKeys = defineCrossRule({
  id: "jsx-classlist-static-keys",
  severity: "error",
  messages,
  meta: {
    description: "Require classList keys to be static and non-computed.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    forEachClassListPropertyAcross(solids, (solid, p) => {
      // SpreadAssignments forward an entire classList object — valid pattern
      if (ts.isSpreadAssignment(p)) return
      if (!ts.isPropertyAssignment(p)) {
        emit(createDiagnostic(solid.file, p, solid.sourceFile, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
        return
      }
      // Computed keys (e.g. [local.class ?? ""]) are valid — standard
      // prop forwarding pattern. Cross-file mapping rules skip them.
      if (ts.isComputedPropertyName(p.name)) return
      if (ts.isIdentifier(p.name)) return
      if (ts.isStringLiteral(p.name)) return
      emit(createDiagnostic(solid.file, p.name, solid.sourceFile, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
    })
  },
})
