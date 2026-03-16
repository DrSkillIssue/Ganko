import ts from "typescript"
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
  node: ts.Node
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
      if (!ts.isCallExpression(call.node)) continue
      if (!isLikelyStringParsingContext(graph, call.node)) continue

      const callee = call.node.expression
      if (!ts.isPropertyAccessExpression(callee)) continue
      if (!isStringLikeReceiver(graph, callee.expression, call.calleeRootVariable)) continue

      const receiver = receiverKey(callee.expression, call.calleeRootVariable?.id ?? null)
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
          graph.sourceFile,
          "no-double-pass-delimiter-count",
          "doublePassDelimiterCount",
          messages.doublePassDelimiterCount,
          "warn",
        ),
      )
    }
  },
})

function receiverKey(node: ts.Node, variableId: number | null): string | null {
  if (variableId !== null) return `var:${variableId}`
  if (ts.isIdentifier(node)) return `id:${node.text}`
  if (ts.isStringLiteral(node)) return `lit:${node.text}`
  return null
}

function delimiterKey(node: ts.Node | undefined): string | null {
  if (!node || ts.isSpreadElement(node)) return null
  if (ts.isStringLiteral(node)) return `str:${node.text}`
  if (ts.isNumericLiteral(node)) return null

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return `tpl:${node.text}`
  }

  if (ts.isTemplateExpression(node)) {
    if (node.templateSpans.length > 0) return null
    return `tpl:${node.head.text}`
  }

  return null
}

function isLengthAccess(node: ts.CallExpression): boolean {
  const parent = node.parent
  if (!parent || !ts.isPropertyAccessExpression(parent)) return false
  if (parent.expression !== node) return false
  return ts.isIdentifier(parent.name) && parent.name.text === "length"
}
