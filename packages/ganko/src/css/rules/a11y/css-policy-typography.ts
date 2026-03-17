/**
 * CSS Policy: Typography
 *
 * Enforces minimum font sizes and line heights based on the active
 * accessibility policy template. Checks font-size, line-height, and
 * heading-specific constraints by matching selectors to element types.
 */

import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { getActivePolicy, getActivePolicyName } from "../../policy"
import type { PolicyThresholds } from "../../policy"
import { parsePxValue, parseUnitlessValue } from "../../parser/value-util"
import type { DeclarationEntity } from "../../entities"

const messages = {
  fontTooSmall: "Font size `{{value}}` ({{resolved}}px) is below the `{{context}}` minimum of `{{min}}px` for policy `{{policy}}`.",
  lineHeightTooSmall: "Line height `{{value}}` is below the `{{context}}` minimum of `{{min}}` for policy `{{policy}}`.",
} as const

/**
 * Element kinds where line-height constraints do not apply.
 * Inline formatting elements (sub, sup, kbd, etc.) intentionally use
 * `line-height: 0` or `line-height: 1` for baseline alignment.
 * Pseudo-elements (::before, ::-webkit-*) are rendering artifacts.
 */
const LINE_HEIGHT_EXEMPT_KINDS = new Set(["inline-formatting", "pseudo-element"])

/**
 * Resolve font-size context and minimum for a declaration.
 *
 * When the rule's selectors contain a positively identified element kind
 * (heading, button, paragraph, etc.) the corresponding threshold applies.
 * When no element kind can be determined from the selector, the caption
 * threshold (12px for WCAG-AA) is used as a floor — we cannot assume
 * unclassified selectors target body text.  Only selectors matching
 * `PARAGRAPH_ELEMENTS` / paragraph-like classes get the full body minimum.
 */
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
  /* Unclassified selector — cannot determine element role.
     Use caption threshold as the absolute WCAG floor. */
  return { context: "unclassified", min: p.minCaptionFontSize }
}

/** Check whether a declaration's rule targets elements exempt from line-height checks. */
function isLineHeightExempt(d: DeclarationEntity): boolean {
  const kinds = d.rule?.elementKinds
  if (!kinds) return false
  for (const kind of kinds) {
    if (LINE_HEIGHT_EXEMPT_KINDS.has(kind)) return true
  }
  return false
}

/** Resolve line-height context and minimum for a declaration. */
function resolveLineHeightContext(d: DeclarationEntity, p: PolicyThresholds): { context: string; min: number } {
  const kinds = d.rule?.elementKinds
  if (kinds && kinds.size > 0) {
    if (kinds.has("heading")) return { context: "heading", min: p.minHeadingLineHeight }
    if (kinds.has("paragraph")) return { context: "body", min: p.minLineHeight }
  }
  /* For non-paragraph, non-heading elements the body line-height minimum
     still applies — WCAG SC 1.4.12 applies broadly to text content. */
  return { context: "body", min: p.minLineHeight }
}

export const cssPolicyTypography = defineCSSRule({
  id: "css-policy-typography",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum font sizes and line heights per accessibility policy.",
    fixable: false,
    category: "css-a11y",
  },
  options: {},
  check(graph, emit) {
    const policy = getActivePolicy()
    if (policy === null) return
    const name = getActivePolicyName() ?? ""

    const fontDecls = graph.declarationsByProperty.get("font-size")
    if (fontDecls) {
      for (let i = 0; i < fontDecls.length; i++) {
        const d = fontDecls[i]
        if (!d) continue
        const px = parsePxValue(d.value)
        if (px === null) continue
        const { context, min } = resolveContext(d, policy)
        if (px >= min) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicyTypography,
          "fontTooSmall",
          resolveMessage(messages.fontTooSmall, {
            value: d.value.trim(),
            resolved: String(Math.round(px * 100) / 100),
            context,
            min: String(min),
            policy: name,
          }),
        )
      }
    }

    const lhDecls = graph.declarationsByProperty.get("line-height")
    if (lhDecls) {
      for (let i = 0; i < lhDecls.length; i++) {
        const d = lhDecls[i]
        if (!d) continue
        if (isLineHeightExempt(d)) continue
        const lh = parseUnitlessValue(d.value)
        if (lh === null) continue
        const { context, min } = resolveLineHeightContext(d, policy)
        if (lh >= min) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicyTypography,
          "lineHeightTooSmall",
          resolveMessage(messages.lineHeightTooSmall, {
            value: d.value.trim(),
            context,
            min: String(min),
            policy: name,
          }),
        )
      }
    }
  },
})
