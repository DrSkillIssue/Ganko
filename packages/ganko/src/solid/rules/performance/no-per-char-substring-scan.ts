import ts from "typescript"
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
        if (!ts.isCallExpression(call.node)) continue
        if (!getEnclosingLoop(call.node)) continue

        const callee = call.node.expression
        if (!ts.isPropertyAccessExpression(callee)) continue
        if (!ts.isIdentifier(callee.expression)) continue
        if (!isStringLikeReceiver(graph, callee.expression, call.calleeRootVariable)) continue

        if (!method) return;
        if (!isPerCharacterPattern(call.node, method)) continue

        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
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

function isPerCharacterPattern(node: ts.CallExpression, method: "charAt" | "slice" | "substring"): boolean {
  if (method === "charAt") {
    const first = node.arguments[0]
    return first !== undefined && isIndexExpression(first)
  }

  if (node.arguments.length < 2) return false
  const first = node.arguments[0]
  const second = node.arguments[1]
  if (!first) return false
  if (!isIndexExpression(first)) return false

  if (ts.isIdentifier(first)) {
    if (!second) return false
    return isIndexPlusOne(second, first.text)
  }

  return false
}

function isIndexExpression(node: ts.Node): boolean {
  return ts.isIdentifier(node)
}

function isIndexPlusOne(node: ts.Node, indexName: string): boolean {
  if (!ts.isBinaryExpression(node)) return false
  if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false
  if (!ts.isIdentifier(node.left) || node.left.text !== indexName) return false
  return ts.isNumericLiteral(node.right) && node.right.text === "1"
}
