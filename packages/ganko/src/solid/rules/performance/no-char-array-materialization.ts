import ts from "typescript"
import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getSpreadElements } from "../../queries"
import { getEnclosingLoop } from "../../util"
import { isLikelyStringParsingContext, isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  charArrayMaterialization:
    "Character array materialization via {{pattern}} in parsing loops allocates O(n) extra memory. Prefer index-based scanning.",
} as const

const options = {}

export const noCharArrayMaterialization = defineSolidRule({
  id: "no-char-array-materialization",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow split(\"\"), Array.from(str), or [...str] in parsing loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const splitCalls = getCallsByMethodName(graph, "split")
    for (let i = 0; i < splitCalls.length; i++) {
      const call = splitCalls[i]
      if (!call) continue;
      if (!ts.isCallExpression(call.node)) continue
      if (!isLoopedParseContext(graph, call.node)) continue

      const callee = call.node.expression
      if (!ts.isPropertyAccessExpression(callee)) continue
      if (!isStringLikeReceiver(graph, callee.expression, call.calleeRootVariable)) continue
      if (!isCharSplit(call.node)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          graph.sourceFile,
          "no-char-array-materialization",
          "charArrayMaterialization",
          resolveMessage(messages.charArrayMaterialization, { pattern: "split(\"\")" }),
          "warn",
        ),
      )
    }

    const fromCalls = getCallsByMethodName(graph, "from")
    for (let i = 0; i < fromCalls.length; i++) {
      const call = fromCalls[i]
      if (!call) continue;
      if (!ts.isCallExpression(call.node)) continue
      if (!isLoopedParseContext(graph, call.node)) continue
      if (!isArrayFromCall(call.node)) continue

      const first = call.node.arguments[0]
      if (!first || ts.isSpreadElement(first)) continue
      if (!isStringLikeReceiver(graph, first, null)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          graph.sourceFile,
          "no-char-array-materialization",
          "charArrayMaterialization",
          resolveMessage(messages.charArrayMaterialization, { pattern: "Array.from(str)" }),
          "warn",
        ),
      )
    }

    const spreadElements = getSpreadElements(graph)
    for (let i = 0; i < spreadElements.length; i++) {
      const spread = spreadElements[i]
      if (!spread) continue;
      if (!isLoopedParseContext(graph, spread)) continue
      if (!isArraySpread(spread)) continue
      if (!isStringLikeReceiver(graph, spread.expression, null)) continue

      emit(
        createDiagnostic(
          graph.file,
          spread,
          graph.sourceFile,
          "no-char-array-materialization",
          "charArrayMaterialization",
          resolveMessage(messages.charArrayMaterialization, { pattern: "[...str]" }),
          "warn",
        ),
      )
    }
  },
})

function isLoopedParseContext(graph: SolidGraph, node: ts.Node): boolean {
  if (!getEnclosingLoop(node)) return false
  return isLikelyStringParsingContext(graph, node)
}

function isCharSplit(node: ts.CallExpression): boolean {
  const first = node.arguments[0]
  return first !== undefined && ts.isStringLiteral(first) && first.text === ""
}

function isArrayFromCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "Array") return false
  const property = callee.name
  if (ts.isIdentifier(property)) return property.text === "from"
  return false
}

function isArraySpread(node: ts.SpreadElement | ts.SpreadAssignment): boolean {
  if (!ts.isSpreadElement(node)) return false
  return node.parent ? ts.isArrayLiteralExpression(node.parent) : false
}
