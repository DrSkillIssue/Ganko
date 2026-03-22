import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { extractKeyframeNames } from "@drskillissue/ganko-shared"
import { CSS_WIDE_KEYWORDS } from "../../../css/parser/css-keywords"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unknownAnimationName: "Animation name `{{name}}` in `{{property}}` does not match any declared @keyframes.",
} as const

export const cssNoUnknownAnimationName = defineAnalysisRule({
  id: "no-unknown-animation-name",
  severity: "error",
  messages,
  meta: { description: "Disallow animation names that do not match declared keyframes.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      // Needs workspace-wide keyframe name index
      const knownNames = new Set<string>()
      for (const [, tree] of compilation.cssTrees) {
        const keyframes = tree.atRulesByKind.get("keyframes")
        if (!keyframes) continue
        for (let i = 0; i < keyframes.length; i++) {
          const kf = keyframes[i]
          if (!kf) continue
          const name = kf.parsedParams.animationName
          if (name) knownNames.add(name)
        }
      }
      // Check animation references across all files
      const IGNORED = new Set([...CSS_WIDE_KEYWORDS, "none"])
      for (const [, tree] of compilation.cssTrees) {
        const animDecls = [...(tree.declarationsByProperty.get("animation") ?? []), ...(tree.declarationsByProperty.get("animation-name") ?? [])]
        for (let i = 0; i < animDecls.length; i++) {
          const d = animDecls[i]
          if (!d) continue
          const names = extractKeyframeNames(d.value, d.property.toLowerCase())
          for (let j = 0; j < names.length; j++) {
            const name = names[j]
            if (!name || IGNORED.has(name) || name.includes("(") || knownNames.has(name)) continue
            emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssNoUnknownAnimationName.id, "unknownAnimationName", resolveMessage(messages.unknownAnimationName, { name, property: d.property }), "error"))
          }
        }
      }
    })
  },
})
