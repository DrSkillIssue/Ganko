import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import type { AtRuleEntity } from "../../../css/entities/at-rule"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unstableFontSwap:
    "`@font-face` for '{{family}}' uses `font-display: {{display}}` without metric overrides (for example `size-adjust`), which can cause CLS when the webfont swaps in.",
} as const

const SWAP_DISPLAYS = new Set(["swap", "fallback"])

export const cssLayoutFontSwapInstability = defineAnalysisRule({
  id: "css-layout-font-swap-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Require metric overrides for swapping webfonts to reduce layout shifts during font load.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((_compilation, symbolTable, emit) => {
      const usedFamilies = symbolTable.usedFontFamilies
      if (usedFamilies.size === 0) return

      for (const family of usedFamilies) {
        const fontFaces = symbolTable.fontFaces.get(family)
        if (!fontFaces) continue

        let hasAnyMetricsAdjustedCandidate = false
        const pendingReports: {
          declaration: { file: { path: string }; startLine: number; startColumn: number; property: string }
          display: string
        }[] = []

        for (let i = 0; i < fontFaces.length; i++) {
          const ff = fontFaces[i]
          if (!ff) continue
          if (!ff.display) continue
          if (!SWAP_DISPLAYS.has(ff.display)) continue
          if (!ff.hasWebFontSource) continue

          // Find the font-display declaration within the @font-face entity
          const displayDecl = findFontDisplayDeclaration(ff.entity)
          if (!displayDecl) continue

          if (ff.hasEffectiveMetricOverrides) {
            hasAnyMetricsAdjustedCandidate = true
            continue
          }

          pendingReports.push({ declaration: displayDecl, display: ff.display })
        }

        if (pendingReports.length === 0) continue
        if (hasAnyMetricsAdjustedCandidate) continue

        for (let i = 0; i < pendingReports.length; i++) {
          const report = pendingReports[i]
          if (!report) continue
          emit(createCSSDiagnostic(
  report.declaration.file.path, report.declaration.startLine, report.declaration.startColumn,
  cssLayoutFontSwapInstability.id, "unstableFontSwap",
  resolveMessage(messages.unstableFontSwap, {
    family,
    display: report.display,
  }), "warn",
))
        }
      }
    })
  },
})

function findFontDisplayDeclaration(entity: AtRuleEntity): { file: { path: string }; startLine: number; startColumn: number; property: string } | null {
  for (let i = 0; i < entity.declarations.length; i++) {
    const decl = entity.declarations[i]
    if (!decl) continue
    if (decl.property.toLowerCase() === "font-display") return decl
  }
  return null
}
