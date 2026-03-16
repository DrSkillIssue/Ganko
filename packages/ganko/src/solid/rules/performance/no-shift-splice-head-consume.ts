import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getVariableByNameInScope } from "../../queries"
import { getEnclosingLoop } from "../../util"

const messages = {
  headConsume:
    "Head-consuming `{{method}}()` inside loops causes array reindexing costs. Use index cursor iteration instead.",
} as const

const options = {}

const SMALL_FIXED_ARRAY_LIMIT = 4

export const noShiftSpliceHeadConsume = defineSolidRule({
  id: "no-shift-splice-head-consume",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow shift/splice(0,1) head-consume patterns in loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const shiftCalls = getCallsByMethodName(graph, "shift")
    const spliceCalls = getCallsByMethodName(graph, "splice")
    const calls = [...shiftCalls, ...spliceCalls]

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      if (!call) continue;
      if (!ts.isCallExpression(call.node)) continue

      const method = methodName(call.node)
      if (!method) continue
      if (method !== "shift" && method !== "splice") continue
      if (method === "splice" && !isHeadSplice(call.node)) continue

      const loop = getEnclosingLoop(call.node)
      if (!loop) continue

      const receiver = receiverIdentifier(call.node)
      if (!receiver) continue

      const variable = getVariableByNameInScope(graph, receiver.text, call.scope)
      if (!variable) continue
      if (!declaredOutsideLoop(variable, loop)) continue
      if (isSmallFixedArray(variable)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          graph.sourceFile,
          "no-shift-splice-head-consume",
          "headConsume",
          resolveMessage(messages.headConsume, { method }),
          "warn",
        ),
      )
    }
  },
})

function methodName(node: ts.CallExpression): string | null {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (ts.isIdentifier(callee.name)) return callee.name.text
  return null
}

function receiverIdentifier(node: ts.CallExpression): ts.Identifier | null {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  const object = callee.expression
  if (!ts.isIdentifier(object)) return null
  return object
}

function isHeadSplice(node: ts.CallExpression): boolean {
  if (node.arguments.length === 0) return false
  const first = node.arguments[0]
  if (!first) return false
  if (!ts.isNumericLiteral(first) || first.text !== "0") return false
  if (node.arguments.length === 1) return true
  const second = node.arguments[1]
  if (!second) return false
  return ts.isNumericLiteral(second) && second.text === "1"
}

function declaredOutsideLoop(variable: { declarations: readonly ts.Node[] }, loop: ts.Node): boolean {
  const declaration = variable.declarations[0]
  if (!declaration) return true
  return declaration.pos < loop.pos
}

function isSmallFixedArray(variable: { initializer: ts.Expression | null }): boolean {
  const init = variable.initializer
  if (!init || !ts.isArrayLiteralExpression(init)) return false
  const elements = init.elements
  if (elements.length > SMALL_FIXED_ARRAY_LIMIT) return false
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element || !ts.isLiteralExpression(element)) return false
  }
  return true
}
