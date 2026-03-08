import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateVariables, getContainingFunction } from "../../queries"

const messages = {
  restSliceLoop:
    "Repeated `{{name}} = {{name}}.{{method}}(...)` in loops creates string churn. Track cursor indexes instead.",
} as const

const options = {}

export const noRestSliceLoop = defineSolidRule({
  id: "no-rest-slice-loop",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow repeated self-slice reassignment loops in string parsing code.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      const candidateAssignments = []
      for (let i = 0; i < variable.assignments.length; i++) {
        const assignment = variable.assignments[i]
        if (!assignment) continue;
        if (!assignment.isInLoop) continue
        if (assignment.operator !== "=" && assignment.operator !== null) continue
        if (!isSelfSliceOrSubstring(variable.name, assignment.value)) continue
        candidateAssignments.push(assignment)
      }

      if (candidateAssignments.length < 2) continue

      const first = candidateAssignments[0]
      let callAssignment: (typeof candidateAssignments)[number] | null = null
      for (let i = 0; i < candidateAssignments.length; i++) {
        const candidate = candidateAssignments[i]
        if (!candidate) continue
        if (candidate.value.type === "CallExpression") {
          callAssignment = candidate
          break
        }
      }
      const call = callAssignment?.value

      if (!first) continue;
      const fn = getContainingFunction(graph, first.node)
      const fnId = fn?.id ?? -1

      let countInFunction = 0
      for (let i = 0; i < candidateAssignments.length; i++) {
        const ca = candidateAssignments[i]
        if (!ca) continue
        const owner = getContainingFunction(graph, ca.node)
        const ownerId = owner?.id ?? -1
        if (ownerId === fnId) countInFunction++
      }
      if (countInFunction < 2) continue

      const method = call && call.type === "CallExpression" ? (callMethodName(call) ?? "slice") : "slice"
      const restDiagNode = callAssignment?.node ?? first.node
      emit(
        createDiagnostic(
          graph.file,
          restDiagNode,
          "no-rest-slice-loop",
          "restSliceLoop",
          resolveMessage(messages.restSliceLoop, {
            name: variable.name,
            method,
          }),
          "warn",
        ),
      )
    }
  },
})

function isSelfSliceOrSubstring(name: string, value: T.Expression): boolean {
  if (value.type === "CallExpression") {
    const callee = value.callee
    if (callee.type !== "MemberExpression") return false
    if (callee.object.type !== "Identifier" || callee.object.name !== name) return false
    const method = memberPropertyName(callee)
    return method === "slice" || method === "substring"
  }

  if (value.type === "ConditionalExpression") {
    return isSelfSliceOrSubstring(name, value.consequent) || isSelfSliceOrSubstring(name, value.alternate)
  }

  if (value.type === "LogicalExpression") {
    return isSelfSliceOrSubstring(name, value.left) || isSelfSliceOrSubstring(name, value.right)
  }

  return false
}

function callMethodName(node: T.CallExpression): string | null {
  const callee = node.callee
  if (callee.type !== "MemberExpression") return null
  return memberPropertyName(callee)
}

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}
