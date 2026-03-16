import ts from "typescript"
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
        if (assignment.operator !== ts.SyntaxKind.EqualsToken && assignment.operator !== null) continue
        if (!isSelfSliceOrSubstring(variable.name, assignment.value)) continue
        candidateAssignments.push(assignment)
      }

      if (candidateAssignments.length < 2) continue

      const first = candidateAssignments[0]
      let callAssignment: (typeof candidateAssignments)[number] | null = null
      for (let i = 0; i < candidateAssignments.length; i++) {
        const candidate = candidateAssignments[i]
        if (!candidate) continue
        if (ts.isCallExpression(candidate.value)) {
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

      const method = call && ts.isCallExpression(call) ? (callMethodName(call) ?? "slice") : "slice"
      const restDiagNode = callAssignment?.node ?? first.node
      emit(
        createDiagnostic(
          graph.file,
          restDiagNode,
          graph.sourceFile,
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

function isSelfSliceOrSubstring(name: string, value: ts.Expression): boolean {
  if (ts.isCallExpression(value)) {
    const callee = value.expression
    if (!ts.isPropertyAccessExpression(callee)) return false
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== name) return false
    const method = memberPropertyName(callee)
    return method === "slice" || method === "substring"
  }

  if (ts.isConditionalExpression(value)) {
    return isSelfSliceOrSubstring(name, value.whenTrue) || isSelfSliceOrSubstring(name, value.whenFalse)
  }

  if (ts.isBinaryExpression(value) && (
    value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )) {
    return isSelfSliceOrSubstring(name, value.left) || isSelfSliceOrSubstring(name, value.right)
  }

  return false
}

function callMethodName(node: ts.CallExpression): string | null {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  return memberPropertyName(callee)
}

function memberPropertyName(node: ts.PropertyAccessExpression): string | null {
  const property = node.name
  if (ts.isIdentifier(property)) return property.text
  return null
}
