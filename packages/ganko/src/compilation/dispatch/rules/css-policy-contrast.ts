import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { getActivePolicy, getActivePolicyName } from "../../../css/policy"
import { parseColor, contrastRatio, compositeOver, type SRGB } from "../../../css/parser/color"
import { parsePxValue } from "../../../css/parser/value-util"
import { defineAnalysisRule, ComputationTier } from "../rule"

const WHITE: SRGB = { r: 1, g: 1, b: 1, a: 1 }
const BLACK: SRGB = { r: 0, g: 0, b: 0, a: 1 }
const messages = { insufficientContrast: "Contrast ratio `{{ratio}}:1` between `{{fg}}` and `{{bg}}` is below the minimum `{{min}}:1` for `{{textSize}}` text in policy `{{policy}}`." } as const

function computeComposited(fg: SRGB, bg: SRGB, backdrop: SRGB): number {
  const resolvedBg = bg.a < 1 ? compositeOver(bg, backdrop) : bg
  const resolvedFg = fg.a < 1 ? compositeOver(fg, resolvedBg) : fg
  return contrastRatio(resolvedFg, resolvedBg)
}

export const cssPolicyContrast = defineAnalysisRule({
  id: "css-policy-contrast",
  severity: "warn",
  messages,
  meta: { description: "Enforce minimum contrast ratio per accessibility policy.", fixable: false, category: "css-a11y" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const policy = getActivePolicy(); if (policy === null) return
      const name = getActivePolicyName() ?? ""
      const colorDecls = tree.declarationsByProperty.get("color"); if (!colorDecls) return
      const candidates = new Set<number>()
      for (let i = 0; i < colorDecls.length; i++) { const cd = colorDecls[i]; if (cd?.rule) candidates.add(cd.rule.id) }
      for (let i = 0; i < tree.rules.length; i++) {
        const rule = tree.rules[i]; if (!rule || !candidates.has(rule.id)) continue
        const fgDecls = rule.declarationIndex.get("color")
        const bgDecls = rule.declarationIndex.get("background-color") ?? rule.declarationIndex.get("background")
        if (!fgDecls || !bgDecls) continue
        const fgDecl = fgDecls[fgDecls.length - 1]; const bgDecl = bgDecls[bgDecls.length - 1]; if (!fgDecl || !bgDecl) continue
        const fgColor = parseColor(fgDecl.value); if (!fgColor) continue
        const bgRaw = bgDecl.property.toLowerCase() === "background" ? (bgDecl.value.includes("url(") || bgDecl.value.includes("gradient") ? null : bgDecl.value) : bgDecl.value
        if (!bgRaw) continue; const bgColor = parseColor(bgRaw); if (!bgColor) continue
        const large = (rule.declarationIndex.get("font-size") ?? []).some(d => { const px = parsePxValue(d.value); return px !== null && px >= policy.largeTextThreshold })
        const min = large ? policy.minContrastLargeText : policy.minContrastNormalText
        const needsDual = fgColor.a < 1 || bgColor.a < 1
        const ratio = needsDual ? Math.max(computeComposited(fgColor, bgColor, WHITE), computeComposited(fgColor, bgColor, BLACK)) : contrastRatio(fgColor, bgColor)
        const rounded = Math.round(ratio * 100) / 100; if (rounded >= min) continue
        emit(createCSSDiagnostic(
          fgDecl.file.path, fgDecl.startLine, fgDecl.startColumn,
          cssPolicyContrast.id, "insufficientContrast",
          resolveMessage(messages.insufficientContrast, { ratio: String(rounded), fg: fgDecl.value.trim(), bg: bgDecl.value.trim(), min: String(min), textSize: large ? "large" : "normal", policy: name }), "warn",
        ))
      }
    })
  },
})
