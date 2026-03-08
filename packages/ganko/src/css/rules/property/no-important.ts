import { resolveMessage } from "../../../diagnostic"
import type { DeclarationEntity } from "../../entities/declaration"
import type { AtRuleEntity } from "../../entities/at-rule"
import type { RuleEntity } from "../../entities/rule"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  avoidImportant:
    "Avoid `!important` on `{{property}}`. It increases override cost and usually signals specificity debt.",
} as const

/**
 * `!important` is the correct mechanism in several well-defined contexts where a
 * declaration must unconditionally override component-level styles:
 *
 * - Accessibility: `@media (prefers-reduced-motion: ...)` overrides must win.
 * - Device capability: `@media (hover: none)`, `(pointer: coarse)` workarounds.
 * - HTML semantic enforcement: `[hidden]` attribute must override display.
 *
 * Detecting these by walking the at-rule and selector context rather than
 * by pattern-matching property names or values.
 */
function isSystemLevelOverride(decl: DeclarationEntity): boolean {
  const rule = decl.rule
  if (!rule) return false

  // Check if any ancestor @media at-rule is an accessibility or device-capability query
  for (let i = 0; i < rule.containingMediaStack.length; i++) {
    const media = rule.containingMediaStack[i]
    if (!media) continue
    if (isAccessibilityOrCapabilityMedia(media)) return true
  }

  // Check if the rule's selector targets HTML semantic attributes
  if (isHtmlSemanticEnforcementSelector(rule)) return true

  return false
}

function isAccessibilityOrCapabilityMedia(media: AtRuleEntity): boolean {
  const params = media.params.toLowerCase()
  // Accessibility preference queries
  if (params.includes("prefers-reduced-motion")) return true
  if (params.includes("prefers-contrast")) return true
  if (params.includes("prefers-color-scheme")) return true
  if (params.includes("forced-colors")) return true
  // Device capability queries where overrides are necessary for usability
  if (params.includes("hover:") || params.includes("hover :")) return true
  if (params.includes("pointer:") || params.includes("pointer :")) return true
  return false
}

function isHtmlSemanticEnforcementSelector(rule: RuleEntity): boolean {
  const selectorText = rule.selectorText.toLowerCase()
  // [hidden] attribute enforcement — standard CSS reset pattern
  if (selectorText.includes("[hidden]")) return true
  return false
}

export const noImportant = defineCSSRule({
  id: "no-important",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow !important declarations.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    for (let i = 0; i < graph.importantDeclarations.length; i++) {
      const decl = graph.importantDeclarations[i]
      if (!decl) continue
      if (isSystemLevelOverride(decl)) continue

      emitCSSDiagnostic(
        emit,
        decl.file.path,
        decl.startLine,
        decl.startColumn,
        noImportant,
        "avoidImportant",
        resolveMessage(messages.avoidImportant, { property: decl.property }),
      )
    }
  },
})
