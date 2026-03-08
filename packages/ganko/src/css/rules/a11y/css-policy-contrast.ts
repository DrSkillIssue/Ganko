/**
 * CSS Policy: Contrast
 *
 * Checks that foreground/background color pairs within the same CSS rule
 * meet the minimum contrast ratio defined by the active accessibility policy.
 * Only flags statically resolvable color pairs (hex, rgb, hsl, named colors).
 */

import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { getActivePolicy, getActivePolicyName } from "../../policy"
import { parseColor, contrastRatio, compositeOver } from "../../parser/color"
import type { SRGB } from "../../parser/color"
import { parsePxValue } from "../../parser/value-util"

const WHITE: SRGB = { r: 1, g: 1, b: 1, a: 1 }
const BLACK: SRGB = { r: 0, g: 0, b: 0, a: 1 }

/**
 * Composite fg and bg against a known backdrop, then compute contrast.
 * Order: backdrop → bg (composited over backdrop) → fg (composited over resolved bg).
 */
function computeComposited(fg: SRGB, bg: SRGB, backdrop: SRGB): number {
  const resolvedBg = bg.a < 1 ? compositeOver(bg, backdrop) : bg
  const resolvedFg = fg.a < 1 ? compositeOver(fg, resolvedBg) : fg
  return contrastRatio(resolvedFg, resolvedBg)
}

const messages = {
  insufficientContrast: "Contrast ratio `{{ratio}}:1` between `{{fg}}` and `{{bg}}` is below the minimum `{{min}}:1` for `{{textSize}}` text in policy `{{policy}}`.",
} as const

/** Extract a plain color from a background shorthand (first color token). */
function extractBackgroundColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.includes("url(") || trimmed.includes("gradient")) return null
  return trimmed
}

/**
 * Determine if the text at this rule would be considered "large" per WCAG.
 * Uses the rule's declarationIndex for direct font-size lookup.
 */
function isLargeText(declarations: readonly { value: string }[] | undefined, threshold: number): boolean {
  if (!declarations) return false
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    if (!decl) continue
    const px = parsePxValue(decl.value)
    if (px !== null && px >= threshold) return true
  }
  return false
}

export const cssPolicyContrast = defineCSSRule({
  id: "css-policy-contrast",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum contrast ratio between foreground and background colors per accessibility policy.",
    fixable: false,
    category: "css-a11y",
  },
  options: {},
  check(graph, emit) {
    const policy = getActivePolicy()
    const name = getActivePolicyName()

    const colorDecls = graph.declarationsByProperty.get("color")
    if (!colorDecls) return

    const candidates = new Set<number>()
    for (let i = 0, len = colorDecls.length; i < len; i++) {
      const colorDecl = colorDecls[i]
      if (!colorDecl) continue
      const rule = colorDecl.rule
      if (rule) candidates.add(rule.id)
    }

    for (const ruleId of candidates) {
      const rule = graph.rules[ruleId]
      if (!rule) continue
      const fgDecls = rule.declarationIndex.get("color")
      const bgDecls = rule.declarationIndex.get("background-color") ?? rule.declarationIndex.get("background")
      if (!fgDecls || !bgDecls) continue

      const fgDecl = fgDecls[fgDecls.length - 1]
      const bgDecl = bgDecls[bgDecls.length - 1]
      if (!fgDecl || !bgDecl) continue

      const fgColor = parseColor(fgDecl.value)
      if (!fgColor) continue

      const bgRaw = bgDecl.property.toLowerCase() === "background"
        ? extractBackgroundColor(bgDecl.value)
        : bgDecl.value
      if (!bgRaw) continue

      const bgColor = parseColor(bgRaw)
      if (!bgColor) continue

      const large = isLargeText(rule.declarationIndex.get("font-size"), policy.largeTextThreshold)
      const min = large ? policy.minContrastLargeText : policy.minContrastNormalText
      const textSize = large ? "large" : "normal"

      /* When either color has alpha < 1 the effective rendered color depends
         on the unknown backdrop surface.  We composite against both extremes
         (white and black) and only warn when contrast fails against BOTH.
         If a color pair passes on at least one backdrop the designer may have
         chosen it for that particular theme context. */
      const needsDualBackdrop = fgColor.a < 1 || bgColor.a < 1

      let ratio: number
      if (needsDualBackdrop) {
        const ratioOnWhite = computeComposited(fgColor, bgColor, WHITE)
        const ratioOnBlack = computeComposited(fgColor, bgColor, BLACK)
        /* Use the worse of the two — warn only when BOTH fail. */
        ratio = Math.max(ratioOnWhite, ratioOnBlack)
      } else {
        ratio = contrastRatio(fgColor, bgColor)
      }

      const rounded = Math.round(ratio * 100) / 100
      if (rounded >= min) continue

      emitCSSDiagnostic(
        emit,
        fgDecl.file.path,
        fgDecl.startLine,
        fgDecl.startColumn,
        cssPolicyContrast,
        "insufficientContrast",
        resolveMessage(messages.insufficientContrast, {
          ratio: String(rounded),
          fg: fgDecl.value.trim(),
          bg: bgDecl.value.trim(),
          min: String(min),
          textSize,
          policy: name,
        }),
      )
    }
  },
})
