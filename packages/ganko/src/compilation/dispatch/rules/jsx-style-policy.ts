import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { getStaticStringValue, getStaticNumericValue, getStaticStringFromJSXValue } from "../../../solid/util/static-value"
import { getActivePolicy, getActivePolicyName } from "../../../css/policy"
import { parsePxValue, parseUnitlessValue, parseEmValue } from "../../../css/parser/value-util"
import { toKebabCase } from "@drskillissue/ganko-shared"
import { getJSXAttributeEntity } from "../../../solid/queries/jsx"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  fontTooSmall: "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for policy `{{policy}}`.",
  lineHeightTooSmall: "Inline style `line-height: {{value}}` is below the minimum `{{min}}` for policy `{{policy}}`.",
  heightTooSmall: "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for interactive elements in policy `{{policy}}`.",
  letterSpacingTooSmall: "Inline style `letter-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  wordSpacingTooSmall: "Inline style `word-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
} as const

const INLINE_TOUCH_TARGET_KEYS = new Set(["height", "min-height", "width", "min-width"])
const INTERACTIVE_HTML_TAGS = new Set(["button", "a", "input", "select", "textarea", "label", "summary"])
const INTERACTIVE_ARIA_ROLES = new Set(["button", "link", "checkbox", "radio", "combobox", "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "tab"])

function normalizeKey(key: string): string {
  if (key.includes("-")) return key.toLowerCase()
  return toKebabCase(key)
}

function formatRounded(value: number): string {
  return Math.round(value * 100) / 100 + ""
}

export const jsxStylePolicy = defineAnalysisRule({
  id: "jsx-style-policy",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce accessibility policy thresholds on inline JSX style objects.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.ElementResolution },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      const policy = getActivePolicy()
      if (policy === null) return
      const name = getActivePolicyName() ?? ""

      const properties = solidTree.styleProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        if (!ts.isPropertyAssignment(p)) continue
        const key = getPropertyKeyName(p.name)
        if (!key) continue
        const normalizedKey = normalizeKey(key)

        if (normalizedKey === "font-size") {
          const strVal = getStaticStringValue(p.initializer)
          if (!strVal) continue
          const px = parsePxValue(strVal)
          if (px === null || px >= policy.minBodyFontSize) continue
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxStylePolicy.id, "fontTooSmall",
            resolveMessage(messages.fontTooSmall, { prop: key, value: strVal, resolved: formatRounded(px), min: String(policy.minBodyFontSize), policy: name }), "warn"))
          continue
        }

        if (normalizedKey === "line-height") {
          const strVal = getStaticStringValue(p.initializer)
          const numVal = getStaticNumericValue(p.initializer)
          const lh = numVal ?? (strVal ? parseUnitlessValue(strVal) : null)
          if (lh === null || lh >= policy.minLineHeight) continue
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxStylePolicy.id, "lineHeightTooSmall",
            resolveMessage(messages.lineHeightTooSmall, { value: String(lh), min: String(policy.minLineHeight), policy: name }), "warn"))
          continue
        }

        if (INLINE_TOUCH_TARGET_KEYS.has(normalizedKey)) {
          const element = entry.element
          if (element.tagName === null || !INTERACTIVE_HTML_TAGS.has(element.tagName)) {
            const roleAttr = getJSXAttributeEntity(solidTree, element, "role")
            if (roleAttr === null || roleAttr.valueNode === null) continue
            const role = getStaticStringFromJSXValue(roleAttr.valueNode)
            if (role === null || !INTERACTIVE_ARIA_ROLES.has(role)) continue
          }
          const strVal = getStaticStringValue(p.initializer)
          if (!strVal) continue
          const px = parsePxValue(strVal)
          if (px === null || px >= policy.minButtonHeight) continue
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxStylePolicy.id, "heightTooSmall",
            resolveMessage(messages.heightTooSmall, { prop: key, value: strVal, resolved: formatRounded(px), min: String(policy.minButtonHeight), policy: name }), "warn"))
          continue
        }

        if (normalizedKey === "letter-spacing") {
          const strVal = getStaticStringValue(p.initializer)
          if (!strVal) continue
          const em = parseEmValue(strVal)
          if (em === null || em >= policy.minLetterSpacing) continue
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxStylePolicy.id, "letterSpacingTooSmall",
            resolveMessage(messages.letterSpacingTooSmall, { value: strVal, resolved: String(em), min: String(policy.minLetterSpacing), policy: name }), "warn"))
          continue
        }

        if (normalizedKey === "word-spacing") {
          const strVal = getStaticStringValue(p.initializer)
          if (!strVal) continue
          const em = parseEmValue(strVal)
          if (em === null || em >= policy.minWordSpacing) continue
          emit(createDiagnostic(solidTree.filePath, p.initializer, solidTree.sourceFile, jsxStylePolicy.id, "wordSpacingTooSmall",
            resolveMessage(messages.wordSpacingTooSmall, { value: strVal, resolved: String(em), min: String(policy.minWordSpacing), policy: name }), "warn"))
        }
      }
    })
  },
})
