import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"
import { getEnclosingLoop } from "../../util"
import { isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  perCharSubstring:
    "Per-character `{{method}}()` scanning in loops allocates extra strings. Prefer index + charCodeAt scanning.",
} as const

const options = {}

export const noPerCharSubstringScan = defineSolidRule({
  id: "no-per-char-substring-scan",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow per-character substring/charAt scanning patterns in loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const methods = ["charAt", "slice", "substring"] as const

    for (let i = 0; i < methods.length; i++) {
      const method = methods[i]
      if (!method) return;
      const calls = getCallsByMethodName(graph, method)

      for (let j = 0; j < calls.length; j++) {
        const call = calls[j]
        if (!call) continue;
        if (call.node.type !== "CallExpression") continue
        if (!getEnclosingLoop(call.node)) continue

        const callee = call.node.callee
        if (callee.type !== "MemberExpression") continue
        if (callee.object.type !== "Identifier") continue
        if (!isStringLikeReceiver(graph, callee.object, call.calleeRootVariable)) continue

        if (!method) return;
        if (!isPerCharacterPattern(call.node, method)) continue

        emit(
          createDiagnostic(
            graph.file,
            call.node,
            "no-per-char-substring-scan",
            "perCharSubstring",
            resolveMessage(messages.perCharSubstring, { method }),
            "warn",
          ),
        )
      }
    }
  },
})

function isPerCharacterPattern(node: T.CallExpression, method: "charAt" | "slice" | "substring"): boolean {
  if (method === "charAt") {
    const first = node.arguments[0]
    return first !== undefined && isIndexExpression(first)
  }

  if (node.arguments.length < 2) return false
  const first = node.arguments[0]
  const second = node.arguments[1]
  if (!first) return false
  if (!isIndexExpression(first)) return false

  if (first.type === "Identifier") {
    if (!second) return false
    return isIndexPlusOne(second, first.name)
  }

  return false
}

function isIndexExpression(node: T.Node): boolean {
  return node.type === "Identifier"
}

function isIndexPlusOne(node: T.Node, indexName: string): boolean {
  if (node.type !== "BinaryExpression") return false
  if (node.operator !== "+") return false
  if (node.left.type !== "Identifier" || node.left.name !== indexName) return false
  return node.right.type === "Literal" && node.right.value === 1
}
