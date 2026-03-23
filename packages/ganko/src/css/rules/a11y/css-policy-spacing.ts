/**
 * CSS Policy: Spacing
 *
 * Enforces minimum letter-spacing, word-spacing, and paragraph spacing
 * based on the active accessibility policy template. These thresholds
 * derive from WCAG 2.2 SC 1.4.12 (Text Spacing) and the W3C Low Vision
 * Needs working draft.
 */

import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { getActivePolicy, getActivePolicyName } from "../../policy"
import type { PolicyThresholds } from "../../policy"
import { parseEmValue } from "../../parser/value-util"
import type { RuleEntity } from "../../entities/rule"
import type { CSSWorkspaceView as CSSGraph } from "../../workspace-view"
import type { Emit } from "../../../graph"

const messages = {
  letterSpacingTooSmall: "Letter spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  wordSpacingTooSmall: "Word spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
  paragraphSpacingTooSmall: "Paragraph spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` ({{minMultiplier}}× font-size) for policy `{{policy}}`.",
} as const

export const cssPolicySpacing = defineCSSRule({
  id: "css-policy-spacing",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum letter-spacing, word-spacing, and paragraph spacing per accessibility policy.",
    fixable: false,
    category: "css-a11y",
  },
  options: {},
  check(graph, emit) {
    const policy = getActivePolicy()
    if (policy === null) return
    const name = getActivePolicyName() ?? ""

    const letterDecls = graph.declarationsByProperty.get("letter-spacing")
    if (letterDecls) {
      for (let i = 0; i < letterDecls.length; i++) {
        const d = letterDecls[i]
        if (!d) continue
        const em = parseEmValue(d.value)
        if (em === null) continue
        if (em >= policy.minLetterSpacing) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicySpacing,
          "letterSpacingTooSmall",
          resolveMessage(messages.letterSpacingTooSmall, {
            value: d.value.trim(),
            resolved: String(em),
            min: String(policy.minLetterSpacing),
            policy: name,
          }),
        )
      }
    }

    const wordDecls = graph.declarationsByProperty.get("word-spacing")
    if (wordDecls) {
      for (let i = 0; i < wordDecls.length; i++) {
        const d = wordDecls[i]
        if (!d) continue
        const em = parseEmValue(d.value)
        if (em === null) continue
        if (em >= policy.minWordSpacing) continue
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssPolicySpacing,
          "wordSpacingTooSmall",
          resolveMessage(messages.wordSpacingTooSmall, {
            value: d.value.trim(),
            resolved: String(em),
            min: String(policy.minWordSpacing),
            policy: name,
          }),
        )
      }
    }

    checkParagraphSpacing(graph, emit, policy, name)
  },
})

function isParagraphRule(rule: RuleEntity): boolean {
  return rule.elementKinds.has("paragraph")
}

/**
 * Check paragraph spacing (margin-bottom/margin-block-end on paragraph
 * elements). Paragraph spacing in WCAG SC 1.4.12 is defined as a
 * multiplier of font-size, so em values map directly.
 */
function checkParagraphSpacing(
  graph: CSSGraph,
  emit: Emit,
  policy: PolicyThresholds,
  name: string,
): void {
  const decls = graph.declarationsForProperties("margin-bottom", "margin-block-end")
  for (let i = 0; i < decls.length; i++) {
    const d = decls[i]
    if (!d) continue
    if (!d.rule) continue
    if (!isParagraphRule(d.rule)) continue

    const em = parseEmValue(d.value)
    if (em === null) continue
    if (em >= policy.minParagraphSpacing) continue

    emitCSSDiagnostic(
      emit,
      d.file.path,
      d.startLine,
      d.startColumn,
      cssPolicySpacing,
      "paragraphSpacingTooSmall",
      resolveMessage(messages.paragraphSpacingTooSmall, {
        value: d.value.trim(),
        resolved: String(em),
        min: String(policy.minParagraphSpacing),
        minMultiplier: String(policy.minParagraphSpacing),
        policy: name,
      }),
    )
  }
}
