import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  emptyKeyframes: "@keyframes `{{name}}` has no effective keyframes.",
} as const

export const cssNoEmptyKeyframes = defineAnalysisRule({
  id: "css-no-empty-keyframes",
  severity: "error",
  messages,
  meta: { description: "Disallow empty @keyframes rules.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const keyframes = tree.atRulesByKind.get("keyframes")
      if (!keyframes) return
      for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i]
        if (!kf) continue
        const name = kf.parsedParams.animationName
        if (!name) continue
        if (kf.rules.length === 0) {
          emit(createDiagnosticFromLoc(kf.file.path, { start: { line: kf.startLine, column: 1 }, end: { line: kf.startLine, column: 2 } }, cssNoEmptyKeyframes.id, "emptyKeyframes", resolveMessage(messages.emptyKeyframes, { name }), "error"))
          continue
        }
        let hasDecl = false
        for (let j = 0; j < kf.rules.length; j++) { const r = kf.rules[j]; if (r && r.declarations.length > 0) { hasDecl = true; break } }
        if (!hasDecl) emit(createDiagnosticFromLoc(kf.file.path, { start: { line: kf.startLine, column: 1 }, end: { line: kf.startLine, column: 2 } }, cssNoEmptyKeyframes.id, "emptyKeyframes", resolveMessage(messages.emptyKeyframes, { name }), "error"))
      }
    })
  },
})
