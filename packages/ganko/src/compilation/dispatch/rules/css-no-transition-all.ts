import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  avoidTransitionAll: "Avoid `transition: all`. Transition specific properties to reduce unnecessary style and paint work.",
} as const

const WORD_ALL = /\ball\b/

export const cssNoTransitionAll = defineAnalysisRule({
  id: "no-transition-all",
  severity: "warn",
  messages,
  meta: { description: "Disallow transition: all.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const tDecls = tree.declarationsByProperty.get("transition") ?? []
      const tpDecls = tree.declarationsByProperty.get("transition-property") ?? []
      const allDecls = [...tDecls, ...tpDecls]
      for (let i = 0; i < allDecls.length; i++) {
        const d = allDecls[i]
        if (!d || !WORD_ALL.test(d.value)) continue
        emit(createCSSDiagnostic(
          d.file.path, d.startLine, d.startColumn,
          cssNoTransitionAll.id, "avoidTransitionAll",
          resolveMessage(messages.avoidTransitionAll), "warn",
        ))
      }
    })
  },
})
