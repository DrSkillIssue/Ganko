/**
 * Avoid Non-Null Assertions Rule
 *
 * Disallow the use of non-null assertion operator (`!`) in expressions.
 *
 * Non-null assertions tell TypeScript to trust you that a value is not null/undefined,
 * but this bypasses type safety and can lead to runtime errors.
 *
 * Problem examples:
 * ```
 * const value = obj!.property;       // Non-null assertion on obj
 * const item = arr![0];              // Non-null assertion on arr
 * const doubled = count! * 2;        // Non-null assertion on count
 * ```
 *
 * Better approaches:
 * - Use optional chaining: `obj?.property`
 * - Use nullish coalescing: `value ?? defaultValue`
 * - Properly narrow types with type guards
 * - Use `if` checks before accessing
 */

import type { Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getExpressionName } from "../../util/expression"
import { getSourceCode } from "../../queries/get"

const messages = {
  avoidNonNull:
    'Avoid non-null assertion on "{{name}}". Non-null assertions bypass type safety. Use optional chaining (`?.`), nullish coalescing (`??`), or proper type narrowing instead.',
} as const

const options = {}

export const avoidNonNullAssertions = defineSolidRule({
  id: "avoid-non-null-assertions",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow non-null assertion operator (`!`). Use optional chaining, nullish coalescing, or proper type narrowing instead.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const assertions = graph.nonNullAssertions
    if (assertions.length === 0) return

    const sourceText = getSourceCode(graph).text

    for (let i = 0, len = assertions.length; i < len; i++) {
      const assertion = assertions[i]
      if (!assertion) continue;
      const name = getExpressionName(assertion.expression)
      const expressionText = sourceText.slice(assertion.expression.range[0], assertion.expression.range[1])

      const fix: Fix = [{
        range: [assertion.node.range[0], assertion.node.range[1]],
        text: expressionText,
      }]

      emit(
        createDiagnostic(
          graph.file,
          assertion.node,
          "avoid-non-null-assertions",
          "avoidNonNull",
          resolveMessage(messages.avoidNonNull, { name }),
          "error",
          fix,
        ),
      )
    }
  },
})
