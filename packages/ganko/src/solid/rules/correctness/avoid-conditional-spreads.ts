/**
 * Avoid Conditional Spreads Rule
 *
 * Disallow spread operators used conditionally to include/exclude props.
 *
 * This rule flags fragile patterns like:
 * - `{...condition && { prop: value }}`
 * - `{...condition ? { prop: value } : {}}`
 * - `{...(x > 0 && { x })}`
 *
 * Why it's problematic:
 * - Relies on falsy spread behavior that's non-obvious
 * - Harder to understand intent than explicit conditional props
 * - Can mask prop conflicts and make debugging difficult
 * - Creates extra object literals in the JSX
 *
 * Better alternatives:
 * - Use explicit conditional props: `{...(condition && { prop })}`
 * - Use helper functions to build prop objects
 * - Use `classList` and `style` for dynamic attributes
 */

import type { ConditionalSpreadEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";

/**
 * Check if a conditional spread is inside a classList or style attribute value.
 * These expressions are re-evaluated reactively — conditional spreads are the
 * idiomatic pattern for toggling classes/styles.
 */
function isClassListOrStyleSpread(spread: ConditionalSpreadEntity): boolean {
  return spread.attributeContext === "classList" || spread.attributeContext === "style"
}

const messages = {
  avoidConditionalSpread:
    "Avoid conditional spread with empty object fallback. " +
    "Instead of `...(cond ? {...} : {})`, build the object first with conditional property assignment, then spread once.",
  avoidLogicalAndSpread:
    "Avoid logical AND spread pattern. " +
    "Instead of `...(cond && {...})`, use explicit conditional property assignment for clarity.",
} as const

const options = {}

export const avoidConditionalSpreads = defineSolidRule({
  id: "avoid-conditional-spreads",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow conditional spread operators that create empty objects. " +
      "Patterns like `...(condition ? {...} : {})` are fragile and create unnecessary object creations.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const conditionalSpreads = graph.conditionalSpreads
    if (conditionalSpreads.length === 0) return

    for (let i = 0, len = conditionalSpreads.length; i < len; i++) {
      const spread = conditionalSpreads[i]

      // Skip conditional spreads in classList/style on native DOM elements.
      // Solid diffs classList and merges style — conditional spreads are the
      // idiomatic pattern for toggling classes/styles.
      if (!spread) return;
      if (isClassListOrStyleSpread(spread)) continue

      const messageId =
        spread.spreadType === "ternary"
          ? "avoidConditionalSpread"
          : "avoidLogicalAndSpread"
      const msg = messages[messageId]

      emit(createDiagnostic(graph.filePath, spread.node, graph.sourceFile, "avoid-conditional-spreads", messageId, msg, "error"))
    }
  },
})
