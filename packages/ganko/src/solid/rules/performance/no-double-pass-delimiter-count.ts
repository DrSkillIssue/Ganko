import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByMethodName, getContainingFunction } from "../../queries"
import { isLikelyStringParsingContext, isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  doublePassDelimiterCount:
    "Delimiter counting via `split(...).length` plus another `split(...)` repeats full-string passes. Prefer one indexed scan.",
} as const

const options = {}

interface SplitUsage {
  count: number
  hasCountingSplit: boolean
  node: T.Node
}

export const noDoublePassDelimiterCount = defineSolidRule({
  id: "no-double-pass-delimiter-count",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow split-based delimiter counting followed by additional split passes.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const splitCalls = getCallsByMethodName(graph, "split")
    const grouped = new Map<string, SplitUsage>()

    for (let i = 0; i < splitCalls.length; i++) {
      const call = splitCalls[i]
      if (!call) continue;
      if (call.node.type !== "CallExpression") continue
      if (!isLikelyStringParsingContext(graph, call.node)) continue

      const callee = call.node.callee
      if (callee.type !== "MemberExpression") continue
      if (!isStringLikeReceiver(graph, callee.object, call.calleeRootVariable)) continue

      const receiver = receiverKey(callee.object, call.calleeRootVariable?.id ?? null)
      if (!receiver) continue
      const delimiter = delimiterKey(call.node.arguments[0])
      if (!delimiter) continue

      const fn = getContainingFunction(graph, call.node)
      const fnKey = fn ? `fn:${fn.id}` : "<module>"
      const key = `${fnKey}:${receiver}:${delimiter}`

      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          count: 1,
          hasCountingSplit: isLengthAccess(call.node),
          node: call.node,
        })
        continue
      }

      existing.count++
      if (isLengthAccess(call.node)) existing.hasCountingSplit = true
    }

    for (const [, usage] of grouped) {
      if (usage.count < 2) continue
      if (!usage.hasCountingSplit) continue
      emit(
        createDiagnostic(
          graph.file,
          usage.node,
          "no-double-pass-delimiter-count",
          "doublePassDelimiterCount",
          messages.doublePassDelimiterCount,
          "warn",
        ),
      )
    }
  },
})

function receiverKey(node: T.Node, variableId: number | null): string | null {
  if (variableId !== null) return `var:${variableId}`
  if (node.type === "Identifier") return `id:${node.name}`
  if (node.type === "Literal" && typeof node.value === "string") return `lit:${node.value}`
  return null
}

function delimiterKey(node: T.CallExpression["arguments"][number] | undefined): string | null {
  if (!node || node.type === "SpreadElement") return null
  if (node.type === "Literal") {
    if (typeof node.value === "string") return `str:${node.value}`
    return null
  }

  if (node.type === "TemplateLiteral") {
    if (node.expressions.length > 0) return null
    return `tpl:${node.quasis[0]?.value.cooked ?? ""}`
  }

  return null
}

function isLengthAccess(node: T.CallExpression): boolean {
  const parent = node.parent
  if (!parent || parent.type !== "MemberExpression") return false
  if (parent.object !== node) return false
  if (parent.computed) return false
  return parent.property.type === "Identifier" && parent.property.name === "length"
}
