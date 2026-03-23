import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  hardcodedZ: "Use a z-index token variable instead of literal `{{value}}`.",
} as const

const DIGITS_ONLY = /^[0-9]+$/

export const cssNoHardcodedZIndex = defineAnalysisRule({
  id: "css-no-hardcoded-z-index",
  severity: "warn",
  messages,
  meta: { description: "Disallow hardcoded positive z-index literals.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const decls = tree.declarationsByProperty.get("z-index")
      if (!decls) return
      for (let i = 0; i < decls.length; i++) {
        const d = decls[i]
        if (!d) continue
        const t = d.value.trim()
        if (t.includes("var(") || !DIGITS_ONLY.test(t) || Number(t) <= 0) continue
        emit(createCSSDiagnostic(
          d.file.path, d.startLine, d.startColumn,
          cssNoHardcodedZIndex.id, "hardcodedZ",
          resolveMessage(messages.hardcodedZ, { value: t }), "warn",
        ))
      }
    })
  },
})
