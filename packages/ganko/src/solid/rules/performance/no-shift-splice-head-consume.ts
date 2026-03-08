import type { TSESTree as T } from "@typescript-eslint/utils"
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
      if (call.node.type !== "CallExpression") continue

      const method = methodName(call.node)
      if (!method) continue
      if (method !== "shift" && method !== "splice") continue
      if (method === "splice" && !isHeadSplice(call.node)) continue

      const loop = getEnclosingLoop(call.node)
      if (!loop) continue

      const receiver = receiverIdentifier(call.node)
      if (!receiver) continue

      const variable = getVariableByNameInScope(graph, receiver.name, call.scope)
      if (!variable) continue
      if (!declaredOutsideLoop(variable, loop)) continue
      if (isSmallFixedArray(variable)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "no-shift-splice-head-consume",
          "headConsume",
          resolveMessage(messages.headConsume, { method }),
          "warn",
        ),
      )
    }
  },
})

function methodName(node: T.CallExpression): string | null {
  const callee = node.callee
  if (callee.type !== "MemberExpression") return null
  if (callee.property.type === "Identifier") return callee.property.name
  if (callee.property.type === "Literal" && typeof callee.property.value === "string") return callee.property.value
  return null
}

function receiverIdentifier(node: T.CallExpression): T.Identifier | null {
  const callee = node.callee
  if (callee.type !== "MemberExpression") return null
  const object = callee.object
  if (object.type !== "Identifier") return null
  return object
}

function isHeadSplice(node: T.CallExpression): boolean {
  if (node.arguments.length === 0) return false
  const first = node.arguments[0]
  if (!first) return false
  if (first.type !== "Literal" || first.value !== 0) return false
  if (node.arguments.length === 1) return true
  const second = node.arguments[1]
  if (!second) return false
  return second.type === "Literal" && second.value === 1
}

function declaredOutsideLoop(variable: { declarations: readonly T.Node[] }, loop: T.Node): boolean {
  const declaration = variable.declarations[0]
  if (!declaration) return true
  return declaration.range[0] < loop.range[0]
}

function isSmallFixedArray(variable: { assignments: readonly { operator: T.AssignmentExpression["operator"] | null; value: T.Expression }[] }): boolean {
  if (variable.assignments.length === 0) return false
  const first = variable.assignments[0]
  if (!first) return false
  if (first.operator !== null) return false
  if (first.value.type !== "ArrayExpression") return false
  const elements = first.value.elements
  if (elements.length > SMALL_FIXED_ARRAY_LIMIT) return false
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element || element.type !== "Literal") return false
  }
  return true
}
