import ts from "typescript"
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
      if (!ts.isCallExpression(call.node)) continue
      const loop = getEnclosingLoop(call.node)
      if (!loop) continue
      if (isInLoopControl(loop, call.node)) continue
      if (!isLikelyStringParsingContext(graph, call.node)) continue
      if (isCharSplit(call.node)) continue
      if (isFollowedByPipeline(call.node)) continue

      const callee = call.node.expression
      if (!ts.isPropertyAccessExpression(callee)) continue
      if (!isStringLikeReceiver(graph, callee.expression, call.calleeRootVariable)) continue
      if (isSmallLiteralRoot(callee.expression)) continue

      emit(
        createDiagnostic(
          graph.filePath,
          call.node,
          graph.sourceFile,
          "no-full-split-in-hot-parse",
          "fullSplitInHotParse",
          messages.fullSplitInHotParse,
          "warn",
        ),
      )
    }
  },
})

function isCharSplit(node: ts.CallExpression): boolean {
  const first = node.arguments[0]
  if (!first) return false
  return ts.isStringLiteral(first) && first.text === ""
}

function isFollowedByPipeline(node: ts.CallExpression): boolean {
  const parent = node.parent
  if (!parent || !ts.isPropertyAccessExpression(parent)) return false
  if (parent.expression !== node) return false

  const call = parent.parent
  if (!call || !ts.isCallExpression(call) || call.expression !== parent) return false

  const method = memberPropertyName(parent)
  if (!method) return false
  return CHAINED_FOLLOW_UP_METHODS.has(method)
}

function isSmallLiteralRoot(node: ts.Node): boolean {
  if (!ts.isStringLiteral(node)) return false
  return node.text.length <= 16
}

function memberPropertyName(node: ts.PropertyAccessExpression): string | null {
  const property = node.name
  if (ts.isIdentifier(property)) return property.text
  return null
}

function isInLoopControl(loop: ts.Node, node: ts.Node): boolean {
  if (ts.isForStatement(loop)) {
    if (isWithin(node, loop.initializer)) return true
    if (isWithin(node, loop.condition)) return true
    if (isWithin(node, loop.incrementor)) return true
    return false
  }

  if (ts.isForOfStatement(loop) || ts.isForInStatement(loop)) {
    if (isWithin(node, loop.expression)) return true
    if (isWithin(node, loop.initializer)) return true
    return false
  }

  if (ts.isWhileStatement(loop) || ts.isDoStatement(loop)) {
    return isWithin(node, loop.expression)
  }

  return false
}

function isWithin(node: ts.Node, container: ts.Node | undefined | null): boolean {
  if (!container) return false
  return node.pos >= container.pos && node.end <= container.end
}
