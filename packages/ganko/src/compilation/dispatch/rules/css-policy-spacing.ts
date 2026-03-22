import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { getActivePolicy, getActivePolicyName } from "../../../css/policy"
import { parsePxValue, parseEmValue } from "../../../css/parser/value-util"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  letterSpacingTooSmall: "Letter spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  wordSpacingTooSmall: "Word spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  touchTargetTooSmall: "`{{property}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for interactive elements in policy `{{policy}}`.",
} as const

const INTERACTIVE_SELECTORS = /button|input|select|textarea|\[role=/i

export const cssPolicySpacing = defineAnalysisRule({
  id: "css-policy-spacing",
  severity: "warn",
  messages,
  meta: { description: "Enforce minimum spacing per accessibility policy.", fixable: false, category: "css-a11y" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const policy = getActivePolicy(); if (policy === null) return
      const name = getActivePolicyName() ?? ""
      const lsDecls = tree.declarationsByProperty.get("letter-spacing")
      if (lsDecls) {
        for (let i = 0; i < lsDecls.length; i++) {
          const d = lsDecls[i]; if (!d) continue; const em = parseEmValue(d.value); if (em === null || em >= policy.minLetterSpacing) continue
          emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssPolicySpacing.id, "letterSpacingTooSmall", resolveMessage(messages.letterSpacingTooSmall, { value: d.value.trim(), resolved: String(em), min: String(policy.minLetterSpacing), policy: name }), "warn"))
        }
      }
      const wsDecls = tree.declarationsByProperty.get("word-spacing")
      if (wsDecls) {
        for (let i = 0; i < wsDecls.length; i++) {
          const d = wsDecls[i]; if (!d) continue; const em = parseEmValue(d.value); if (em === null || em >= policy.minWordSpacing) continue
          emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssPolicySpacing.id, "wordSpacingTooSmall", resolveMessage(messages.wordSpacingTooSmall, { value: d.value.trim(), resolved: String(em), min: String(policy.minWordSpacing), policy: name }), "warn"))
        }
      }
      for (const prop of ["height", "min-height"]) {
        const decls = tree.declarationsByProperty.get(prop)
        if (!decls) continue
        for (let i = 0; i < decls.length; i++) {
          const d = decls[i]; if (!d) continue; const rule = d.rule; if (!rule) continue
          if (!INTERACTIVE_SELECTORS.test(rule.selectorText)) continue
          const px = parsePxValue(d.value); if (px === null || px >= policy.minButtonHeight) continue
          emit(createDiagnosticFromLoc(d.file.path, { start: { line: d.startLine, column: d.startColumn }, end: { line: d.startLine, column: d.startColumn + 1 } }, cssPolicySpacing.id, "touchTargetTooSmall", resolveMessage(messages.touchTargetTooSmall, { property: prop, value: d.value.trim(), resolved: String(Math.round(px * 100) / 100), min: String(policy.minButtonHeight), policy: name }), "warn"))
        }
      }
    })
  },
})
