import type { TSESTree as T } from "@typescript-eslint/utils"
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
      if (call.node.type !== "CallExpression") continue
      if (!isLoopedParseContext(graph, call.node)) continue

      const callee = call.node.callee
      if (callee.type !== "MemberExpression") continue
      if (!isStringLikeReceiver(graph, callee.object, call.calleeRootVariable)) continue
      if (!isCharSplit(call.node)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
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
      if (call.node.type !== "CallExpression") continue
      if (!isLoopedParseContext(graph, call.node)) continue
      if (!isArrayFromCall(call.node)) continue

      const first = call.node.arguments[0]
      if (!first || first.type === "SpreadElement") continue
      if (!isStringLikeReceiver(graph, first, null)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
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
      if (!isStringLikeReceiver(graph, spread.argument, null)) continue

      emit(
        createDiagnostic(
          graph.file,
          spread,
          "no-char-array-materialization",
          "charArrayMaterialization",
          resolveMessage(messages.charArrayMaterialization, { pattern: "[...str]" }),
          "warn",
        ),
      )
    }
  },
})

function isLoopedParseContext(graph: SolidGraph, node: T.Node): boolean {
  if (!getEnclosingLoop(node)) return false
  return isLikelyStringParsingContext(graph, node)
}

function isCharSplit(node: T.CallExpression): boolean {
  const first = node.arguments[0]
  return first !== undefined && first.type === "Literal" && first.value === ""
}

function isArrayFromCall(node: T.CallExpression): boolean {
  const callee = node.callee
  if (callee.type !== "MemberExpression") return false
  if (callee.object.type !== "Identifier" || callee.object.name !== "Array") return false
  const property = callee.property
  if (property.type === "Identifier") return property.name === "from"
  if (property.type === "Literal" && typeof property.value === "string") return property.value === "from"
  return false
}

function isArraySpread(node: T.SpreadElement): boolean {
  return node.parent?.type === "ArrayExpression"
}
