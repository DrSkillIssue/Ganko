/**
 * No React Deps Rule
 *
 * Disallow usage of dependency arrays in `createEffect`, `createMemo`, and
 * `createRenderEffect`.
 *
 * In Solid.js, these primitives automatically track their dependencies, unlike
 * React's useEffect/useMemo which require explicit dependency arrays. This
 * rule catches the common mistake of developers coming from React who pass
 * dependency arrays as a second argument.
 *
 * Valid usage:
 * - `createEffect(() => console.log(signal()));` - auto-tracking
 * - `createEffect((prev) => prev + signal(), 0);` - using previous value
 *
 * Invalid usage:
 * - `createEffect(() => console.log(signal()), [signal()]);` - React pattern
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import type { Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { traceToValue, getSourceCode } from "../../queries"

const messages = {
  noUselessDep:
    "In Solid, `{{name}}` doesn't accept a dependency array because it automatically tracks its dependencies. If you really need to override the list of dependencies, use `on`.",
} as const

/**
 * Solid primitives that auto-track dependencies (unlike React's useEffect/useMemo).
 * These can take an optional second argument for initial value, which might be
 * confused with React's dependency array pattern.
 */
const AUTO_TRACKING_PRIMITIVES = ["createEffect", "createMemo", "createRenderEffect"] as const

/**
 * Check if a call looks like a React-style effect/memo with dependency array.
 * Pattern: createEffect(fn, [deps]) or createMemo(fn, [deps])
 *
 * Requires exactly 2 arguments, neither of which is a spread element.
 *
 * @param node - The call expression to check
 * @returns True if the call has exactly 2 non-spread arguments
 */
function hasReactStyleDeps(node: T.CallExpression): boolean {
  const args = node.arguments
  if (args.length !== 2) return false
  const firstArg = args[0];
  if (!firstArg) return false
  if (firstArg.type === "SpreadElement") return false
  const secondArg = args[1];
  if (!secondArg) return false
  if (secondArg.type === "SpreadElement") return false
  return true
}

/**
 * Check if the arguments represent a React-style dependency array pattern.
 *
 * The pattern is detected when:
 * - First arg: function with no parameters (not using prev value)
 * - Second arg: array expression (looks like dependency array)
 *
 * @param tracedArg0 - The traced first argument (should be a function)
 * @param tracedArg1 - The traced second argument (should be an array)
 * @returns True if the pattern matches React-style dependency arrays
 */
function isReactDepsPattern(tracedArg0: T.Node, tracedArg1: T.Node): boolean {
  const type0 = tracedArg0.type
  if (type0 !== "FunctionExpression" && type0 !== "ArrowFunctionExpression" && type0 !== "FunctionDeclaration") {
    return false
  }
  if (tracedArg0.params.length !== 0) return false
  if (tracedArg1.type !== "ArrayExpression") return false
  return true
}

/**
 * Create a fix to remove an argument from a call expression.
 * Returns range that includes preceding comma.
 */
function createRemoveArgFix(
  graph: SolidGraph,
  arg: T.Expression | T.SpreadElement,
): Fix {
  const sourceCode = getSourceCode(graph)
  const commaBefore = sourceCode.getTokenBefore(arg)

  if (commaBefore?.value === ",") {
    return [{ range: [commaBefore.range[0], arg.range[1]], text: "" }]
  }

  return [{ range: [arg.range[0], arg.range[1]], text: "" }]
}

const options = {}

export const noReactDeps = defineSolidRule({
  id: "no-react-deps",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow usage of dependency arrays in `createEffect`, `createMemo`, and `createRenderEffect`.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    for (let p = 0; p < AUTO_TRACKING_PRIMITIVES.length; p++) {
      const primitiveName = AUTO_TRACKING_PRIMITIVES[p]
      if (!primitiveName) return;
      const calls = graph.callsByPrimitive.get(primitiveName)
      if (!calls || calls.length === 0) continue

      for (let i = 0, len = calls.length; i < len; i++) {
        const call = calls[i]
        if (!call) continue;
        const node = call.node

        // Only check CallExpressions (not NewExpressions)
        if (node.type !== "CallExpression") continue

        // Check if it has React-style deps pattern (exactly 2 non-spread args)
        if (!hasReactStyleDeps(node)) continue

        // Get arguments - safe to access since hasReactStyleDeps confirmed length === 2
        const arg0 = node.arguments[0]
        const arg1 = node.arguments[1]
        if (!arg1) continue;

        // Skip spread elements (already checked in hasReactStyleDeps, but needed for type narrowing)
        if (!arg0) return;
        if (arg0.type === "SpreadElement" || arg1.type === "SpreadElement") continue

        // Trace arguments to their actual values using graph.traceToValue()
        if (!arg0) return;
        const tracedArg0 = traceToValue(graph, arg0, call.scope)
        const tracedArg1 = traceToValue(graph, arg1, call.scope)

        if (!isReactDepsPattern(tracedArg0, tracedArg1)) continue

        // Check if we can auto-fix (only if the array is inline, not a variable reference)
        const isInlineArray = tracedArg1 === arg1

        emit(
          createDiagnostic(
            graph.file,
            arg1,
            "no-react-deps",
            "noUselessDep",
            resolveMessage(messages.noUselessDep, { name: primitiveName }),
            "error",
            isInlineArray ? createRemoveArgFix(graph, arg1) : undefined,
          ),
        )
      }
    }
  },
})
