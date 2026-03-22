import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { extractKeyframeNames } from "@drskillissue/ganko-shared"
import { CSS_WIDE_KEYWORDS } from "../../../css/parser/css-keywords"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unusedKeyframes: "@keyframes `{{name}}` is never referenced by animation declarations.",
} as const

export const cssNoUnusedKeyframes = defineAnalysisRule({
  id: "no-unused-keyframes",
  severity: "warn",
  messages,
  meta: { description: "Disallow unused @keyframes declarations.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      const IGNORED = new Set([...CSS_WIDE_KEYWORDS, "none"])
      const usedNames = new Set<string>()
      for (const [, tree] of compilation.cssTrees) {
        const animDecls = [...(tree.declarationsByProperty.get("animation") ?? []), ...(tree.declarationsByProperty.get("animation-name") ?? [])]
        for (let i = 0; i < animDecls.length; i++) {
          const d = animDecls[i]
          if (!d) continue
          const names = extractKeyframeNames(d.value, d.property.toLowerCase())
          for (let j = 0; j < names.length; j++) { const n = names[j]; if (n && !IGNORED.has(n)) usedNames.add(n) }
        }
      }
      for (const [, tree] of compilation.cssTrees) {
        const keyframes = tree.atRulesByKind.get("keyframes")
        if (!keyframes) continue
        for (let i = 0; i < keyframes.length; i++) {
          const kf = keyframes[i]
          if (!kf) continue
          const name = kf.parsedParams.animationName
          if (!name || usedNames.has(name)) continue
          emit(createDiagnosticFromLoc(kf.file.path, { start: { line: kf.startLine, column: 1 }, end: { line: kf.startLine, column: 2 } }, cssNoUnusedKeyframes.id, "unusedKeyframes", resolveMessage(messages.unusedKeyframes, { name }), "warn"))
        }
      }
    })
  },
})
