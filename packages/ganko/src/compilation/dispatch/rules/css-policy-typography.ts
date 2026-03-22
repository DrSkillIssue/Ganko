import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { getActivePolicy, getActivePolicyName } from "../../../css/policy"
import type { PolicyThresholds } from "../../../css/policy"
import { parsePxValue, parseUnitlessValue } from "../../../css/parser/value-util"
import type { DeclarationEntity } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  fontTooSmall: "Font size `{{value}}` ({{resolved}}px) is below the `{{context}}` minimum of `{{min}}px` for policy `{{policy}}`.",
  lineHeightTooSmall: "Line height `{{value}}` is below the `{{context}}` minimum of `{{min}}` for policy `{{policy}}`.",
} as const

const LINE_HEIGHT_EXEMPT_KINDS = new Set(["inline-formatting", "pseudo-element"])

function resolveContext(d: DeclarationEntity, p: PolicyThresholds): { context: string; min: number } {
  const kinds = d.rule?.elementKinds
  if (kinds && kinds.size > 0) {
    if (kinds.has("heading")) return { context: "heading", min: p.minHeadingFontSize }
    if (kinds.has("button")) return { context: "button", min: p.minButtonFontSize }
    if (kinds.has("paragraph")) return { context: "body", min: p.minBodyFontSize }
    if (kinds.has("caption")) return { context: "caption", min: p.minCaptionFontSize }
    if (kinds.has("input")) return { context: "input", min: p.minButtonFontSize }
    if (kinds.has("inline-formatting")) return { context: "caption", min: p.minCaptionFontSize }
  }
  return { context: "unclassified", min: p.minCaptionFontSize }
}

function resolveLineHeightContext(d: DeclarationEntity, p: PolicyThresholds): { context: string; min: number } {
  const kinds = d.rule?.elementKinds
  if (kinds && kinds.size > 0) {
    if (kinds.has("heading")) return { context: "heading", min: p.minHeadingLineHeight }
    if (kinds.has("paragraph")) return { context: "body", min: p.minLineHeight }
  }
  return { context: "body", min: p.minLineHeight }
}

export const cssPolicyTypography = defineAnalysisRule({
  id: "css-policy-typography",
  severity: "warn",
  messages,
  meta: { description: "Enforce minimum font sizes and line heights per accessibility policy.", fixable: false, category: "css-a11y" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const policy = getActivePolicy(); if (policy === null) return
      const name = getActivePolicyName() ?? ""
      const fontDecls = tree.declarationsByProperty.get("font-size")
      if (fontDecls) {
        for (let i = 0; i < fontDecls.length; i++) {
          const d = fontDecls[i]; if (!d) continue; const px = parsePxValue(d.value); if (px === null) continue
          const { context, min } = resolveContext(d, policy); if (px >= min) continue
          emit(createCSSDiagnostic(
            d.file.path, d.startLine, d.startColumn,
            cssPolicyTypography.id, "fontTooSmall",
            resolveMessage(messages.fontTooSmall, { value: d.value.trim(), resolved: String(Math.round(px * 100) / 100), context, min: String(min), policy: name }), "warn",
          ))
        }
      }
      const lhDecls = tree.declarationsByProperty.get("line-height")
      if (lhDecls) {
        for (let i = 0; i < lhDecls.length; i++) {
          const d = lhDecls[i]; if (!d) continue
          const kinds = d.rule?.elementKinds; if (kinds) { let exempt = false; for (const k of kinds) { if (LINE_HEIGHT_EXEMPT_KINDS.has(k)) { exempt = true; break } }; if (exempt) continue }
          const lh = parseUnitlessValue(d.value); if (lh === null) continue
          const { context, min } = resolveLineHeightContext(d, policy); if (lh >= min) continue
          emit(createCSSDiagnostic(
            d.file.path, d.startLine, d.startColumn,
            cssPolicyTypography.id, "lineHeightTooSmall",
            resolveMessage(messages.lineHeightTooSmall, { value: d.value.trim(), context, min: String(min), policy: name }), "warn",
          ))
        }
      }
    })
  },
})
