import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"
import { getEnclosingLoop } from "../../util"
import { isLikelyStringParsingContext, isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  fullSplitInHotParse:
    "`split()` inside parsing loops materializes full token arrays each iteration. Prefer cursor/index scanning.",
} as const

const options = {}

const CHAINED_FOLLOW_UP_METHODS = new Set(["map", "filter", "flatMap", "reduce", "join", "slice"])

export const noFullSplitInHotParse = defineSolidRule({
  id: "no-full-split-in-hot-parse",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow full split() materialization inside hot string parsing loops.",
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
      const loop = getEnclosingLoop(call.node)
      if (!loop) continue
      if (isInLoopControl(loop, call.node)) continue
      if (!isLikelyStringParsingContext(graph, call.node)) continue
      if (isCharSplit(call.node)) continue
      if (isFollowedByPipeline(call.node)) continue

      const callee = call.node.callee
      if (callee.type !== "MemberExpression") continue
      if (!isStringLikeReceiver(graph, callee.object, call.calleeRootVariable)) continue
      if (isSmallLiteralRoot(callee.object)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "no-full-split-in-hot-parse",
          "fullSplitInHotParse",
          messages.fullSplitInHotParse,
          "warn",
        ),
      )
    }
  },
})

function isCharSplit(node: T.CallExpression): boolean {
  const first = node.arguments[0]
  if (!first) return false
  return first.type === "Literal" && first.value === ""
}

function isFollowedByPipeline(node: T.CallExpression): boolean {
  const parent = node.parent
  if (!parent || parent.type !== "MemberExpression") return false
  if (parent.object !== node) return false

  const call = parent.parent
  if (!call || call.type !== "CallExpression" || call.callee !== parent) return false

  const method = memberPropertyName(parent)
  if (!method) return false
  return CHAINED_FOLLOW_UP_METHODS.has(method)
}

function isSmallLiteralRoot(node: T.Node): boolean {
  if (node.type !== "Literal") return false
  return typeof node.value === "string" && node.value.length <= 16
}

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}

function isInLoopControl(loop: T.Node, node: T.Node): boolean {
  if (!node.range) return false

  if (loop.type === "ForStatement") {
    if (isWithin(node, loop.init)) return true
    if (isWithin(node, loop.test)) return true
    if (isWithin(node, loop.update)) return true
    return false
  }

  if (loop.type === "ForOfStatement" || loop.type === "ForInStatement") {
    if (isWithin(node, loop.right)) return true
    if (isWithin(node, loop.left)) return true
    return false
  }

  if (loop.type === "WhileStatement" || loop.type === "DoWhileStatement") {
    return isWithin(node, loop.test)
  }

  return false
}

function isWithin(node: T.Node, container: T.Node | null): boolean {
  if (!container || !node.range || !container.range) return false
  return node.range[0] >= container.range[0] && node.range[1] <= container.range[1]
}
