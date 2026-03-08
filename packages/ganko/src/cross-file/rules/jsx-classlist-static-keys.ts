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
      // SpreadElements forward an entire classList object — valid pattern
      if (p.type === "SpreadElement") return
      if (p.type !== "Property") {
        emit(createDiagnostic(solid.file, p, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
        return
      }
      // Computed keys (e.g. [local.class ?? ""]) are valid — standard
      // prop forwarding pattern. Cross-file mapping rules skip them.
      if (p.computed) return
      if (p.key.type === "Identifier") return
      if (p.key.type === "Literal" && typeof p.key.value === "string") return
      emit(createDiagnostic(solid.file, p.key, jsxClasslistStaticKeys.id, "nonStaticKey", resolveMessage(messages.nonStaticKey), "error"))
    })
  },
})
