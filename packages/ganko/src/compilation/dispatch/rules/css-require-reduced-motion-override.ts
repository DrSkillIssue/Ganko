import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import type { RuleEntity } from "../../../css/entities/rule"
import { defineAnalysisRule, ComputationTier } from "../rule"

const ZERO_MS = /(^|\s|,)0ms($|\s|,)/
const ZERO_S = /(^|\s|,)0s($|\s|,)/
const TIME_VALUE_G = /([0-9]*\.?[0-9]+)(ms|s)/g
const AMPERSAND_G = /&/g
const WHITESPACE_G = /\s+/g

const messages = {
  missingReducedMotion: "Animated selector `{{selector}}` lacks prefers-reduced-motion override.",
} as const

function isAnimationDecl(p: string): boolean { return p === "animation" || p === "animation-duration" }
function isTransitionDecl(p: string): boolean { return p === "transition" || p === "transition-duration" }
function isDisabledMotionValue(v: string): boolean {
  const s = v.toLowerCase()
  return s.includes("none") || ZERO_MS.test(s) || ZERO_S.test(s)
}
function hasPositiveTime(value: string): boolean {
  const m = value.toLowerCase().match(TIME_VALUE_G)
  if (!m) return false
  for (let i = 0; i < m.length; i++) {
    const token = m[i]; if (!token) continue
    const unit = token.endsWith("ms") ? "ms" : "s"
    const n = Number(token.slice(0, unit === "ms" ? -2 : -1))
    if (!Number.isNaN(n) && n > 0) return true
  }
  return false
}
function isReducedMotionRule(rule: { containingMedia: { params: string } | null }): boolean {
  const m = rule.containingMedia
  if (!m) return false
  const p = m.params.toLowerCase()
  return p.includes("prefers-reduced-motion") && p.includes("reduce")
}
function resolveFullSelectors(rule: RuleEntity): string[] {
  const chain: RuleEntity[] = [rule]
  let cur: RuleEntity["parent"] = rule.parent
  while (cur !== null) { if (cur.kind === "rule") { chain.push(cur) }; cur = cur.parent }
  const outermost = chain[chain.length - 1]
  if (!outermost) return []
  let resolved: string[] = splitSelectors(outermost.selectorText)
  for (let i = chain.length - 2; i >= 0; i--) {
    const entry = chain[i]; if (!entry) continue
    const childParts = splitSelectors(entry.selectorText)
    const next: string[] = []
    for (let p = 0; p < resolved.length; p++) {
      const parent = resolved[p]; if (!parent) continue
      for (let c = 0; c < childParts.length; c++) {
        const child = childParts[c]; if (!child) continue
        next.push(child.includes("&") ? child.replace(AMPERSAND_G, parent) : parent + " " + child)
      }
    }
    resolved = next
  }
  return resolved
}
function splitSelectors(text: string): string[] {
  if (text.indexOf(",") === -1) { const t = text.trim(); return t ? [t] : [] }
  const out: string[] = []; let start = 0; let parenD = 0; let brackD = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 0x28) parenD++; else if (ch === 0x29) parenD--
    else if (ch === 0x5b) brackD++; else if (ch === 0x5d) brackD--
    else if (ch === 0x2c && parenD === 0 && brackD === 0) { const t = text.substring(start, i).trim(); if (t) out.push(t); start = i + 1 }
  }
  const t = text.substring(start).trim(); if (t) out.push(t)
  return out
}
function normalizeSelector(s: string): string { return s.replace(WHITESPACE_G, " ").trim() }

export const cssRequireReducedMotionOverride = defineAnalysisRule({
  id: "css-require-reduced-motion-override",
  severity: "warn",
  messages,
  meta: { description: "Require reduced-motion override for animated selectors.", fixable: false, category: "css-a11y" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      const reduced = new Set<string>()
      const motionDecls: { d: import("../../../css/entities/declaration").DeclarationEntity; tree: import("../../core/css-syntax-tree").CSSSyntaxTree }[] = []

      for (const [, tree] of compilation.cssTrees) {
        for (const prop of ["animation", "animation-duration", "transition", "transition-duration"]) {
          const decls = tree.declarationsByProperty.get(prop)
          if (!decls) continue
          for (let i = 0; i < decls.length; i++) { const d = decls[i]; if (d) motionDecls.push({ d, tree }) }
        }
      }

      for (let i = 0; i < motionDecls.length; i++) {
        const { d } = motionDecls[i]!
        const r = d.rule; if (!r || !isReducedMotionRule(r)) continue
        const p = d.property.toLowerCase()
        const group = isAnimationDecl(p) ? "animation" : isTransitionDecl(p) ? "transition" : null
        if (!group) continue
        const resolved = resolveFullSelectors(r)
        for (let j = 0; j < resolved.length; j++) { const sel = resolved[j]; if (sel) reduced.add(`${normalizeSelector(sel)}|${group}`) }
      }

      for (let i = 0; i < motionDecls.length; i++) {
        const { d } = motionDecls[i]!
        const r = d.rule; if (!r || isReducedMotionRule(r)) continue
        const p = d.property.toLowerCase()
        const group = isAnimationDecl(p) ? "animation" : isTransitionDecl(p) ? "transition" : null
        if (!group || isDisabledMotionValue(d.value) || !hasPositiveTime(d.value)) continue
        const resolved = resolveFullSelectors(r)
        let covered = false
        for (let j = 0; j < resolved.length; j++) { const sel = resolved[j]; if (sel && reduced.has(`${normalizeSelector(sel)}|${group}`)) { covered = true; break } }
        if (covered) continue
        emit(createCSSDiagnostic(
          d.file.path, d.startLine, d.startColumn,
          cssRequireReducedMotionOverride.id, "missingReducedMotion",
          resolveMessage(messages.missingReducedMotion, { selector: r.selectorText }), "warn",
        ))
      }
    })
  },
})
