/**
 * Flags repeated linear scans over fixed literal collections.
 *
 * Large immutable lookup tables should use precomputed Map/Set indexes when
 * used in hot paths (loops) or repeatedly within a function.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { FunctionEntity, VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateVariables, getContainingFunction } from "../../queries"
import { COMPARISON_OPERATORS, expressionReferencesAny, getEnclosingLoop } from "../../util"
import type { SolidGraph } from "../../impl"

const messages = {
  preferMapLookup:
    "Linear scan over fixed collection '{{name}}' in '{{fnName}}'. Precompute Map/Set lookup for O(1) access.",
} as const

const options = {}

const MIN_LITERAL_COUNT = 8

interface UsageInfo {
  count: number
  inLoop: boolean
  node: T.Node
  fnName: string
}

export const preferMapLookupOverLinearScan = defineSolidRule({
  id: "prefer-map-lookup-over-linear-scan",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow repeated linear scans over fixed literal collections in hot paths.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!isFixedLiteralArray(variable)) continue

      const literalCount = countFixedLiteralElements(variable)
      if (literalCount < MIN_LITERAL_COUNT) continue

      const usages = collectLookupUsages(graph, variable)
      if (usages.size === 0) continue

      for (const usage of usages.values()) {
        if (!usage.inLoop && usage.count < 2) continue

        emit(
          createDiagnostic(
            graph.file,
            usage.node,
            "prefer-map-lookup-over-linear-scan",
            "preferMapLookup",
            resolveMessage(messages.preferMapLookup, {
              name: variable.name,
              fnName: usage.fnName,
            }),
            "warn",
          ),
        )
      }
    }
  },
})

function isFixedLiteralArray(variable: VariableEntity): boolean {
  if (variable.declarations.length === 0) return false
  if (variable.assignments.length !== 1) return false

  const firstAssignment = variable.assignments[0]
  if (!firstAssignment) return false
  if (firstAssignment.operator !== null) return false
  if (firstAssignment.value.type !== "ArrayExpression") return false

  for (let i = 0; i < variable.declarations.length; i++) {
    const decl = variable.declarations[i]
    if (!decl) continue;
    if (decl.type !== "Identifier") return false

    const declarator = decl.parent
    if (!declarator || declarator.type !== "VariableDeclarator") return false
    const varDecl = declarator.parent
    if (!varDecl || varDecl.type !== "VariableDeclaration") return false
    if (varDecl.kind !== "const") return false
  }

  return true
}

function countFixedLiteralElements(variable: VariableEntity): number {
  const firstAssignment = variable.assignments[0]
  if (!firstAssignment) return 0
  if (firstAssignment.value.type !== "ArrayExpression") return 0

  const elements = firstAssignment.value.elements
  let count = 0
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) return 0
    if (element.type !== "Literal") return 0
    if (typeof element.value !== "string" && typeof element.value !== "number") return 0
    count++
  }
  return count
}

function collectLookupUsages(graph: SolidGraph, variable: VariableEntity): ReadonlyMap<string, UsageInfo> {
  const byFunctionKey = new Map<string, UsageInfo>()

  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i]
    if (!read) continue;
    const node = read.node
    const parent = node.parent
    if (!parent || parent.type !== "MemberExpression") continue
    if (parent.object !== node) continue

    const callParent = parent.parent
    if (callParent?.type === "CallExpression" && callParent.callee === parent) {
      const method = memberPropertyName(parent)
      if (method === "includes" || method === "indexOf") {
        recordUsage(graph, byFunctionKey, callParent)
        continue
      }

      if (method === "find" && isMembershipFindPredicate(callParent)) {
        recordUsage(graph, byFunctionKey, callParent)
        continue
      }
    }

    if (!parent.computed) continue
    if (!isManualIndexComparison(parent, read.isInConditional)) continue
    recordUsage(graph, byFunctionKey, parent)
  }

  return byFunctionKey
}

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}

function isMembershipFindPredicate(call: T.CallExpression): boolean {
  const callback = call.arguments[0]
  if (!callback) return false
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return false
  if (callback.params.length === 0) return false

  const firstParam = callback.params[0]
  if (!firstParam) return false
  if (firstParam.type !== "Identifier") return false
  const bodyExpr = callbackBodyExpression(callback.body)
  if (!bodyExpr || bodyExpr.type !== "BinaryExpression") return false
  if (bodyExpr.operator !== "===") return false

  const leftIsParam = bodyExpr.left.type === "Identifier" && bodyExpr.left.name === firstParam.name
  const rightIsParam = bodyExpr.right.type === "Identifier" && bodyExpr.right.name === firstParam.name
  if (!leftIsParam && !rightIsParam) return false

  const otherSide = leftIsParam ? bodyExpr.right : bodyExpr.left
  return !expressionReferencesAny(otherSide, new Set([firstParam.name]))
}

function callbackBodyExpression(body: T.BlockStatement | T.Expression): T.Expression | null {
  if (body.type !== "BlockStatement") return body
  if (body.body.length !== 1) return null
  const statement = body.body[0]
  if (!statement) return null
  if (statement.type !== "ReturnStatement") return null
  return statement.argument
}

function isManualIndexComparison(member: T.MemberExpression, isInConditional: boolean): boolean {
  if (!isInConditional) return false
  const enclosingLoop = getEnclosingLoop(member)
  if (!enclosingLoop) return false

  const comparisonCandidate = nearestComparisonCandidate(member)
  return comparisonCandidate !== null && COMPARISON_OPERATORS.has(comparisonCandidate.operator)
}

function nearestComparisonCandidate(member: T.MemberExpression): T.BinaryExpression | null {
  const first = member.parent
  if (!first) return null
  const direct = asComparison(first)
  if (direct) return direct
  if (!isTypeWrapper(first)) return null

  const second = first.parent
  if (!second) return null
  const secondMatch = asComparison(second)
  if (secondMatch) return secondMatch
  if (!isTypeWrapper(second)) return null

  const third = second.parent
  if (!third) return null
  const thirdMatch = asComparison(third)
  if (thirdMatch) return thirdMatch
  if (!isTypeWrapper(third)) return null

  const fourth = third.parent
  if (!fourth) return null
  return asComparison(fourth)
}

function asComparison(node: T.Node): T.BinaryExpression | null {
  if (node.type === "BinaryExpression") return node
  return null
}

function isTypeWrapper(node: T.Node): boolean {
  return (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression"
  )
}

function recordUsage(graph: SolidGraph, map: Map<string, UsageInfo>, node: T.Node): void {
  const fn = getContainingFunction(graph, node)
  const key = functionKey(fn)
  const existing = map.get(key)
  const inLoop = getEnclosingLoop(node) !== null

  if (!existing) {
    map.set(key, {
      count: 1,
      inLoop,
      node,
      fnName: functionLabel(fn),
    })
    return
  }

  existing.count++
  if (inLoop) existing.inLoop = true
}

function functionKey(fn: FunctionEntity | null): string {
  if (!fn) return "<module>"
  return `fn:${fn.id}`
}

function functionLabel(fn: FunctionEntity | null): string {
  if (!fn) return "<module>"
  return fn.name ?? fn.variableName ?? "<anonymous>"
}
