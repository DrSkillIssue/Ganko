import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  avoidLegacyVh: "Use 100dvh/100svh instead of `100vh` for mobile-safe viewport sizing.",
} as const

const LEGACY_VH_100 = /(^|\s|,)100vh($|\s|;|,)/

export const cssNoLegacyVh100 = defineAnalysisRule({
  id: "css-no-legacy-vh-100",
  severity: "warn",
  messages,
  meta: { description: "Disallow 100vh in viewport sizing declarations.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (const prop of ["height", "min-height", "max-height"]) {
        const decls = tree.declarationsByProperty.get(prop)
        if (!decls) continue
        for (let i = 0; i < decls.length; i++) {
          const d = decls[i]
          if (!d || !LEGACY_VH_100.test(d.value)) continue
          emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssNoLegacyVh100.id, "avoidLegacyVh", resolveMessage(messages.avoidLegacyVh), "warn"))
        }
      }
    })
  },
})
