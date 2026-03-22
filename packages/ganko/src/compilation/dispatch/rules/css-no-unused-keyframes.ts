import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
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
        for (let i = 0; i < tree.atRules.length; i++) {
          const atRule = tree.atRules[i]
          if (!atRule) continue
          if (atRule.declarations.length > 0) continue
          const nodes = atRule.node.nodes
          if (!nodes) continue
          for (let j = 0; j < nodes.length; j++) {
            const child = nodes[j]
            if (!child || child.type !== "decl") continue
            const prop = child.prop.toLowerCase()
            if (prop !== "animation" && prop !== "animation-name") continue
            const names = extractKeyframeNames(child.value, prop)
            for (let k = 0; k < names.length; k++) { const n = names[k]; if (n && !IGNORED.has(n)) usedNames.add(n) }
          }
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
          emit(createCSSDiagnostic(
            kf.file.path, kf.startLine, 1,
            cssNoUnusedKeyframes.id, "unusedKeyframes",
            resolveMessage(messages.unusedKeyframes, { name }), "warn",
          ))
        }
      }
    })
  },
})
