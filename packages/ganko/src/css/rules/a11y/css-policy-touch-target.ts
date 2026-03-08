/**
 * CSS Policy: Touch Targets
 *
 * Enforces minimum heights, widths, and padding for interactive elements
 * (buttons, inputs) based on the active accessibility policy template.
 */

import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { getActivePolicy, getActivePolicyName } from "../../policy"
import { parsePxValue } from "../../parser/value-util"
import type { RuleEntity } from "../../entities/rule"

const messages = {
  heightTooSmall: "`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.",
  widthTooSmall: "`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.",
  paddingTooSmall: "Horizontal padding `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.",
} as const

type ElementKind = "button" | "input" | null

function classifyRule(rule: RuleEntity): ElementKind {
  if (rule.elementKinds.has("button")) return "button"
  if (rule.elementKinds.has("input")) return "input"
  return null
}

const HEIGHT_PROPERTIES = new Set(["height", "min-height"])
const WIDTH_PROPERTIES = new Set(["width", "min-width"])
const HPADDING_PROPERTIES = new Set(["padding-left", "padding-right", "padding-inline", "padding-inline-start", "padding-inline-end"])

export const cssPolicyTouchTarget = defineCSSRule({
  id: "css-policy-touch-target",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum interactive element sizes per accessibility policy.",
    fixable: false,
    category: "css-a11y",
  },
  options: {},
  check(graph, emit) {
    const policy = getActivePolicy()
    const name = getActivePolicyName()

    const decls = graph.declarationsForProperties(
      "height", "min-height", "width", "min-width",
      "padding-left", "padding-right", "padding-inline", "padding-inline-start", "padding-inline-end",
    )
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (!d) continue
      if (!d.rule) continue
      const prop = d.property.toLowerCase()

      const kind = classifyRule(d.rule)
      if (!kind) continue

      // Visually hidden inputs (position: absolute/fixed + opacity: 0) delegate
      // their touch target to a parent label or sibling control. Checking their
      // intrinsic dimensions is meaningless.
      if (isVisuallyHiddenInput(d.rule)) continue

      const px = parsePxValue(d.value)
      if (px === null) continue

      if (HEIGHT_PROPERTIES.has(prop)) {
        const min = kind === "button" ? policy.minButtonHeight : policy.minInputHeight
        if (px >= min) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicyTouchTarget,
          "heightTooSmall",
          resolveMessage(messages.heightTooSmall, {
            property: d.property,
            value: d.value.trim(),
            resolved: String(Math.round(px * 100) / 100),
            min: String(min),
            element: kind,
            policy: name,
          }),
        )
        continue
      }

      if (WIDTH_PROPERTIES.has(prop)) {
        const min = kind === "button" ? policy.minButtonWidth : policy.minTouchTarget
        if (px >= min) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicyTouchTarget,
          "widthTooSmall",
          resolveMessage(messages.widthTooSmall, {
            property: d.property,
            value: d.value.trim(),
            resolved: String(Math.round(px * 100) / 100),
            min: String(min),
            element: kind,
            policy: name,
          }),
        )
        continue
      }

      if (kind === "button" && HPADDING_PROPERTIES.has(prop)) {
        if (px >= policy.minButtonHorizontalPadding) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicyTouchTarget,
          "paddingTooSmall",
          resolveMessage(messages.paddingTooSmall, {
            value: d.value.trim(),
            resolved: String(Math.round(px * 100) / 100),
            min: String(policy.minButtonHorizontalPadding),
            element: kind,
            policy: name,
          }),
        )
      }
    }
  },
})

/**
 * Detects visually hidden interactive elements — inputs or buttons that are
 * removed from visual presentation using `position: absolute/fixed` combined
 * with `opacity: 0`. This is the standard accessible hidden input pattern
 * where the actual touch target is a parent `<label>` or sibling control.
 *
 * Uses the rule's `declarationIndex` to check sibling declarations without
 * re-scanning the entire rule.
 */
function isVisuallyHiddenInput(rule: RuleEntity): boolean {
  if (!hasPositionAbsoluteOrFixed(rule)) return false
  if (!hasOpacityZero(rule)) return false
  return true
}

function hasPositionAbsoluteOrFixed(rule: RuleEntity): boolean {
  const positionDecls = rule.declarationIndex.get("position")
  if (!positionDecls || positionDecls.length === 0) return false

  for (let i = 0; i < positionDecls.length; i++) {
    const decl = positionDecls[i]
    if (!decl) continue
    const v = decl.value.trim().toLowerCase()
    if (v === "absolute" || v === "fixed") return true
  }
  return false
}

function hasOpacityZero(rule: RuleEntity): boolean {
  const opacityDecls = rule.declarationIndex.get("opacity")
  if (!opacityDecls || opacityDecls.length === 0) return false

  for (let i = 0; i < opacityDecls.length; i++) {
    const decl = opacityDecls[i]
    if (!decl) continue
    const v = decl.value.trim()
    if (v === "0") return true
  }
  return false
}
