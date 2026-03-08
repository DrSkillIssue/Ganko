/**
 * No Destructure Rule
 *
 * Disallow destructuring props in Solid.js component parameters.
 *
 * Why destructuring props breaks reactivity:
 * In Solid.js, props are reactive. When you destructure them, you lose reactivity
 * for the destructured values because they become static variables.
 *
 * Problem example:
 * ```
 * export const Button = ({ label, disabled }) => {
 *   // label and disabled are static - not reactive!
 *   return <button disabled={disabled}>{label}</button>;
 * };
 * ```
 *
 * Correct approach:
 * ```
 * export const Button = (props) => {
 *   // props.label and props.disabled stay reactive
 *   return <button disabled={props.disabled}>{props.label}</button>;
 * };
 * ```
 *
 * This rule detects destructuring in component parameters and suggests accessing
 * props directly instead to maintain reactivity.
 */

import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";

const messages = {
  noDestructure:
    "Destructuring component props breaks Solid's reactivity. Props are reactive getters, so `{ a }` captures the value at component creation time and won't update. Use `props.a` to access props reactively.",
  noDestructureWithDefaults:
    "Destructuring component props breaks Solid's reactivity. For default values, use `mergeProps({ a: defaultValue }, props)` instead of `{ a = defaultValue }`.",
  noDestructureWithRest:
    "Destructuring component props breaks Solid's reactivity. For rest patterns, use `splitProps(props, ['a', 'b'])` instead of `{ a, b, ...rest }`.",
  noDestructureWithBoth:
    "Destructuring component props breaks Solid's reactivity. For default values with rest, use `splitProps(mergeProps({ a: defaultValue }, props), ['a'])` to combine both patterns.",
} as const

const options = {}

export const noDestructure = defineSolidRule({
  id: "no-destructure",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow destructuring props in Solid components. Props must be accessed via property access (props.x) to preserve reactivity.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const components = graph.componentFunctions
    if (components.length === 0) return

    for (let i = 0, len = components.length; i < len; i++) {
      const fn = components[i]
      if (!fn) continue;
      if (fn.params.length !== 1) continue

      const firstParam = fn.params[0]
      if (!firstParam) continue
      const param = firstParam.node
      if (param.type !== "ObjectPattern") continue

      if (fn.node.parent?.type === "JSXExpressionContainer") continue

      const pattern = param
      const hasDefaults = pattern.properties.some(
        (p) => p.type === "Property" && p.value.type === "AssignmentPattern",
      )
      const hasRest = pattern.properties.some((p) => p.type === "RestElement")

      let messageId: keyof typeof messages
      if (hasDefaults && hasRest) {
        messageId = "noDestructureWithBoth"
      } else if (hasDefaults) {
        messageId = "noDestructureWithDefaults"
      } else if (hasRest) {
        messageId = "noDestructureWithRest"
      } else {
        messageId = "noDestructure"
      }

      emit(createDiagnostic(graph.file, pattern, "no-destructure", messageId, messages[messageId], "error"))
    }
  },
})
