/**
 * Flags .slice().sort() chains that create an unnecessary intermediate copy.
 * Modern runtimes support .toSorted() which expresses intent directly.
 * Also flags .slice().reverse() (use .toReversed()).
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByMethodName, getMethodChain } from "../../queries"

const messages = {
  sliceSort:
    ".slice().sort() creates an intermediate array. Use .toSorted() instead.",
  sliceReverse:
    ".slice().reverse() creates an intermediate array. Use .toReversed() instead.",
  spreadSort:
    "[...array].sort() creates an intermediate array. Use .toSorted() instead.",
  spreadReverse:
    "[...array].reverse() creates an intermediate array. Use .toReversed() instead.",
} as const

const options = {}

export const avoidSliceSortPattern = defineSolidRule({
  id: "avoid-slice-sort-pattern",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow .slice().sort() and .slice().reverse() chains. Use .toSorted()/.toReversed().",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const targets = [
      { method: "sort", messageId: "sliceSort", msg: messages.sliceSort },
      { method: "reverse", messageId: "sliceReverse", msg: messages.sliceReverse },
    ]

    for (const target of targets) {
      const calls = getCallsByMethodName(graph, target.method)

      for (let i = 0, len = calls.length; i < len; i++) {
        const call = calls[i]
        if (!call) continue
        const { methods, root } = getMethodChain(graph, call)

        if (methods.length === 0) continue

        const last = methods[methods.length - 1]
        if (last !== target.method) continue

        let messageId: string = target.messageId
        let message: string = target.msg

        if (methods.length >= 2) {
          // Check if the method immediately before is "slice"
          const prev = methods[methods.length - 2]
          if (prev === "slice") {
            // keep defaults
          } else if (isSingleSpreadArray(root)) {
            if (target.method === "sort") {
              messageId = "spreadSort"
              message = messages.spreadSort
            } else {
              messageId = "spreadReverse"
              message = messages.spreadReverse
            }
          } else {
            continue
          }
        } else {
          if (!isSingleSpreadArray(root)) continue
          if (target.method === "sort") {
            messageId = "spreadSort"
            message = messages.spreadSort
          } else {
            messageId = "spreadReverse"
            message = messages.spreadReverse
          }
        }

        // Verify .slice() has 0 args (full copy) or any args (subrange copy)
        // Both are wasteful when followed by sort/reverse
        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "avoid-slice-sort-pattern",
            messageId,
            message,
            "warn",
          ),
        )
      }
    }
  },
})

function isSingleSpreadArray(root: ts.Node | null): boolean {
  if (!root || !ts.isArrayLiteralExpression(root)) return false
  if (root.elements.length !== 1) return false
  const first = root.elements[0]
  return first !== undefined && ts.isSpreadElement(first)
}
