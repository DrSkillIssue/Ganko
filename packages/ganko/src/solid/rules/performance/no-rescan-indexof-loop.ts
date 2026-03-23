import ts from "typescript"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getContainingFunction } from "../../queries"
import { getEnclosingLoop } from "../../util"
import { isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  rescanIndexOf:
    "Repeated `{{method}}()` from string start inside loops rescans prior text. Pass a cursor start index.",
} as const

const options = {}

type SearchMethod = "indexOf" | "includes"

export const noRescanIndexofLoop = defineSolidRule({
  id: "no-rescan-indexof-loop",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow repeated indexOf/includes scans from start in parsing loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const grouped = new Map<string, { method: SearchMethod; node: ts.CallExpression; count: number }>()

    collect(graph, "indexOf", grouped)
    collect(graph, "includes", grouped)

    for (const [, entry] of grouped) {
      if (entry.count < 2) continue
      emit(
        createDiagnostic(
          graph.filePath,
          entry.node,
          graph.sourceFile,
          "no-rescan-indexof-loop",
          "rescanIndexOf",
          resolveMessage(messages.rescanIndexOf, { method: entry.method }),
          "warn",
        ),
      )
    }
  },
})

function collect(
  graph: SolidGraph,
  method: SearchMethod,
  grouped: Map<string, { method: SearchMethod; node: ts.CallExpression; count: number }>,
): void {
  const calls = getCallsByMethodName(graph, method)
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]
    if (!call) continue;
    if (!ts.isCallExpression(call.node)) continue
    if (!startsFromBeginning(call.node, method)) continue

    const callee = call.node.expression
    if (!ts.isPropertyAccessExpression(callee)) continue
    if (!ts.isIdentifier(callee.expression)) continue
    const receiverName = callee.expression.text
    if (!isStringLikeReceiver(graph, callee.expression, call.calleeRootVariable)) continue

    const loop = getEnclosingLoop(call.node)
    if (!loop) continue
    const fn = getContainingFunction(graph, call.node)
    const fnId = fn?.id ?? -1

    const receiverKey = call.calleeRootVariable
      ? `var:${call.calleeRootVariable.id}`
      : `name:${receiverName}`
    const key = `${fnId}:${receiverKey}:${method}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, { method, node: call.node, count: 1 })
      continue
    }
    existing.count++
  }
}

function startsFromBeginning(node: ts.CallExpression, method: SearchMethod): boolean {
  if (method === "indexOf") {
    if (node.arguments.length < 2) return true
    const second = node.arguments[1]
    if (!second) return true
    if (ts.isNumericLiteral(second) && second.text === "0") return true
    return false
  }

  if (node.arguments.length < 2) return true
  const second = node.arguments[1]
  if (!second) return true
  return ts.isNumericLiteral(second) && second.text === "0"
}
