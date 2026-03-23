import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { findTransitionProperty, findPropertyInList } from "../../../css/parser/value-util"
import { defineAnalysisRule, ComputationTier } from "../rule"

const discrete = new Set(["display", "position", "overflow", "overflow-x", "overflow-y", "visibility", "float", "clear"])

const messages = {
  discreteTransition: "Property `{{property}}` is discrete and should not be transitioned.",
} as const

export const cssNoDiscreteTransition = defineAnalysisRule({
  id: "css-no-discrete-transition",
  severity: "error",
  messages,
  meta: { description: "Disallow transitions on discrete CSS properties.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const tDecls = tree.declarationsByProperty.get("transition") ?? []
      const tpDecls = tree.declarationsByProperty.get("transition-property") ?? []
      for (let i = 0; i < tDecls.length; i++) {
        const d = tDecls[i]
        if (!d) continue
        const bad = findTransitionProperty(d.value, discrete)
        if (!bad) continue
        emit(createCSSDiagnostic(
          d.file.path, d.startLine, d.startColumn,
          cssNoDiscreteTransition.id, "discreteTransition",
          resolveMessage(messages.discreteTransition, { property: bad }), "error",
        ))
      }
      for (let i = 0; i < tpDecls.length; i++) {
        const d = tpDecls[i]
        if (!d) continue
        const bad = findPropertyInList(d.value, discrete)
        if (!bad) continue
        emit(createCSSDiagnostic(
          d.file.path, d.startLine, d.startColumn,
          cssNoDiscreteTransition.id, "discreteTransition",
          resolveMessage(messages.discreteTransition, { property: bad }), "error",
        ))
      }
    })
  },
})
