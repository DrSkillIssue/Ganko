/**
 * Prefer Memo Complex Styles Rule
 *
 * Suggest using `createMemo()` for complex, conditional style objects.
 *
 * When a style object contains multiple conditional expressions, extracting
 * it to createMemo() avoids recreating the object on every change.
 *
 * Problem with inline complex styles:
 * ```
 * <div style={{
 *   color: active() ? 'red' : 'black',
 *   fontWeight: selected() ? 'bold' : 'normal',
 *   background: theme() === 'dark' ? '#000' : '#fff'
 * }} />
 * ```
 * - Creates new object literal on every render
 * - Style attributes must be recalculated even if values didn't change
 * - Harder to track which values actually changed
 *
 * Better with createMemo:
 * ```
 * const styles = createMemo(() => ({
 *   color: active() ? 'red' : 'black',
 *   fontWeight: selected() ? 'bold' : 'normal',
 *   background: theme() === 'dark' ? '#000' : '#fff'
 * }));
 * <div style={styles()} />
 * ```
 *
 * This rule is disabled by default - it's a style preference, not a bug.
 */

import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";
import { getEnclosingComponentScope, getComponentScopes } from "../../queries"
import { getJSXAttributesByKind } from "../../queries/jsx"

const messages = {
  preferMemoComplexStyle:
    "Complex style computation should be extracted to createMemo() for better approach. " +
    "This style object contains {{complexity}} conditional expressions that are recalculated on every render.",
  preferMemoConditionalSpread:
    "Conditional spread operators in style objects should be extracted to createMemo(). " +
    "Pattern like `...(condition ? {...} : {})` creates new objects on every render.",
} as const

const options = {}

export const preferMemoComplexStyles = defineSolidRule({
  id: "prefer-memo-complex-styles",
  severity: "warn",
  messages,
  meta: {
    description:
      "Enforce extracting complex style computations to createMemo for better approach. " +
      "Complex inline style objects are rebuilt on every render, which can impact approach.",
    fixable: false,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const minComplexity = 2

    const styleAttrs = getJSXAttributesByKind(graph, "style")
    if (styleAttrs.length === 0) return

    for (let i = 0, len = styleAttrs.length; i < len; i++) {
      const entry = styleAttrs[i]
      if (!entry) continue
      const { attr, element } = entry

      const componentScopes = getComponentScopes(graph)
      if (!getEnclosingComponentScope(graph, element.scope) && !componentScopes.has(element.scope)) {
        continue
      }

      const precomputed = attr.styleComplexity
      if (!precomputed) continue

      const value = attr.valueNode
      if (!value) continue

      if (precomputed.hasConditionalSpread) {
        emit(
          createDiagnostic(
            graph.file,
            value,
            "prefer-memo-complex-styles",
            "preferMemoConditionalSpread",
            messages.preferMemoConditionalSpread,
            "warn",
          ),
        )
      } else if (precomputed.conditionalCount >= minComplexity) {
        const msg = messages.preferMemoComplexStyle.replace(
          "{{complexity}}",
          String(precomputed.conditionalCount),
        )
        emit(
          createDiagnostic(
            graph.file,
            value,
            "prefer-memo-complex-styles",
            "preferMemoComplexStyle",
            msg,
            "warn",
          ),
        )
      }
    }
  },
});
