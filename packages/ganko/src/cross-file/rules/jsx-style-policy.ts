/**
 * Cross-File Policy: JSX Inline Style
 *
 * Enforces accessibility policy thresholds on inline JSX style objects.
 * Checks font-size, line-height, height, min-height, width, min-width,
 * padding, letter-spacing, and word-spacing values against the active
 * policy template.
 */

import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { forEachStylePropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"
import { getStaticStringValue, getStaticNumericValue, getStaticStringFromJSXValue } from "../../solid/util/static-value"
import { getActivePolicy, getActivePolicyName } from "../../css/policy"
import { parsePxValue, parseUnitlessValue, parseEmValue } from "../../css/parser/value-util"
import { formatRounded, normalizeStylePropertyKey } from "./rule-runtime"
import { getJSXAttributeEntity } from "../../solid/queries/jsx"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"

const messages = {
  fontTooSmall: "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for policy `{{policy}}`.",
  lineHeightTooSmall: "Inline style `line-height: {{value}}` is below the minimum `{{min}}` for policy `{{policy}}`.",
  heightTooSmall: "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for interactive elements in policy `{{policy}}`.",
  letterSpacingTooSmall: "Inline style `letter-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  wordSpacingTooSmall: "Inline style `word-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
} as const

const INLINE_TOUCH_TARGET_KEYS = new Set([
  "height",
  "min-height",
  "width",
  "min-width",
])

/** Native HTML tags that are inherently interactive touch targets. */
const INTERACTIVE_HTML_TAGS = new Set(["button", "a", "input", "select", "textarea", "label", "summary"])

/**
 * ARIA roles whose purpose is direct user interaction. Elements with these roles
 * are touch targets and must meet minimum-size thresholds.
 */
const INTERACTIVE_ARIA_ROLES = new Set([
  "button", "link", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "tab",
])

function isInteractiveElement(solid: SolidGraph, element: JSXElementEntity): boolean {
  if (element.tagName !== null && INTERACTIVE_HTML_TAGS.has(element.tagName)) return true
  const roleAttr = getJSXAttributeEntity(solid, element, "role")
  if (roleAttr !== null && roleAttr.valueNode !== null) {
    const role = getStaticStringFromJSXValue(roleAttr.valueNode)
    if (role !== null && INTERACTIVE_ARIA_ROLES.has(role)) return true
  }
  return false
}

export const jsxStylePolicy = defineCrossRule({
  id: "jsx-style-policy",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce accessibility policy thresholds on inline JSX style objects.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const { solids } = context
    const policy = getActivePolicy()
    if (policy === null) return
    const name = getActivePolicyName() ?? ""

    forEachStylePropertyAcross(solids, (solid, p, element) => {
      if (!ts.isPropertyAssignment(p)) return
      const key = objectKeyName(p.name)
      if (!key) return
      const normalizedKey = normalizeStylePropertyKey(key)

      if (normalizedKey === "font-size") {
        const strVal = getStaticStringValue(p.initializer)
        if (!strVal) return
        const px = parsePxValue(strVal)
        if (px === null || px >= policy.minBodyFontSize) return
        emit(createDiagnostic(
          solid.file, p.initializer, solid.sourceFile, jsxStylePolicy.id, "fontTooSmall",
          resolveMessage(messages.fontTooSmall, {
            prop: key, value: strVal, resolved: formatRounded(px),
            min: String(policy.minBodyFontSize), policy: name,
          }), "warn",
        ))
        return
      }

      if (normalizedKey === "line-height") {
        const strVal = getStaticStringValue(p.initializer)
        const numVal = getStaticNumericValue(p.initializer)
        const lh = numVal ?? (strVal ? parseUnitlessValue(strVal) : null)
        if (lh === null || lh >= policy.minLineHeight) return
        emit(createDiagnostic(
          solid.file, p.initializer, solid.sourceFile, jsxStylePolicy.id, "lineHeightTooSmall",
          resolveMessage(messages.lineHeightTooSmall, {
            value: String(lh), min: String(policy.minLineHeight), policy: name,
          }), "warn",
        ))
        return
      }

      if (INLINE_TOUCH_TARGET_KEYS.has(normalizedKey)) {
        if (!isInteractiveElement(solid, element)) return
        const strVal = getStaticStringValue(p.initializer)
        if (!strVal) return
        const px = parsePxValue(strVal)
        if (px === null) return
        const min = policy.minButtonHeight
        if (px >= min) return
        emit(createDiagnostic(
          solid.file, p.initializer, solid.sourceFile, jsxStylePolicy.id, "heightTooSmall",
          resolveMessage(messages.heightTooSmall, {
            prop: key, value: strVal, resolved: formatRounded(px),
            min: String(min), policy: name,
          }), "warn",
        ))
        return
      }

      if (normalizedKey === "letter-spacing") {
        const strVal = getStaticStringValue(p.initializer)
        if (!strVal) return
        const em = parseEmValue(strVal)
        if (em === null || em >= policy.minLetterSpacing) return
        emit(createDiagnostic(
          solid.file, p.initializer, solid.sourceFile, jsxStylePolicy.id, "letterSpacingTooSmall",
          resolveMessage(messages.letterSpacingTooSmall, {
            value: strVal, resolved: String(em), min: String(policy.minLetterSpacing), policy: name,
          }), "warn",
        ))
        return
      }

      if (normalizedKey === "word-spacing") {
        const strVal = getStaticStringValue(p.initializer)
        if (!strVal) return
        const em = parseEmValue(strVal)
        if (em === null || em >= policy.minWordSpacing) return
        emit(createDiagnostic(
          solid.file, p.initializer, solid.sourceFile, jsxStylePolicy.id, "wordSpacingTooSmall",
          resolveMessage(messages.wordSpacingTooSmall, {
            value: strVal, resolved: String(em), min: String(policy.minWordSpacing), policy: name,
          }), "warn",
        ))
      }
    })
  },
})
