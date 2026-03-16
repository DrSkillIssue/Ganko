/**
 * Flags repeated linear scans over fixed literal collections.
 *
 * Large immutable lookup tables should use precomputed Map/Set indexes when
 * used in hot paths (loops) or repeatedly within a function.
 */

import ts from "typescript"
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
  node: ts.Node
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
            graph.sourceFile,
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
  const init = variable.initializer
  if (!init || !ts.isArrayLiteralExpression(init)) return false

  for (let i = 0; i < variable.declarations.length; i++) {
    const decl = variable.declarations[i]
    if (!decl) continue;
    if (!ts.isIdentifier(decl)) return false

    const declarator = decl.parent
    if (!declarator || !ts.isVariableDeclaration(declarator)) return false
    const varDeclList = declarator.parent
    if (!varDeclList || !ts.isVariableDeclarationList(varDeclList)) return false
    if (!(varDeclList.flags & ts.NodeFlags.Const)) return false
  }

  return true
}

function countFixedLiteralElements(variable: VariableEntity): number {
  const init = variable.initializer
  if (!init || !ts.isArrayLiteralExpression(init)) return 0

  const elements = init.elements
  let count = 0
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) return 0
    if (!ts.isStringLiteral(element) && !ts.isNumericLiteral(element)) return 0
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
    if (!parent || !ts.isPropertyAccessExpression(parent)) continue
    if (parent.expression !== node) continue

    const callParent = parent.parent
    if (callParent && ts.isCallExpression(callParent) && callParent.expression === parent) {
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

    // Check element access (computed property)
    if (parent.parent && ts.isElementAccessExpression(parent.parent) && parent.parent.expression === parent) {
      // This doesn't apply for PropertyAccessExpression - skip
    }
  }

  // Also check element access patterns
  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i]
    if (!read) continue;
    const node = read.node
    const parent = node.parent
    if (!parent || !ts.isElementAccessExpression(parent)) continue
    if (parent.expression !== node) continue
    if (!isManualIndexComparison(parent, read.isInConditional)) continue
    recordUsage(graph, byFunctionKey, parent)
  }

  return byFunctionKey
}

function memberPropertyName(node: ts.PropertyAccessExpression): string | null {
  const property = node.name
  if (ts.isIdentifier(property)) return property.text
  return null
}

function isMembershipFindPredicate(call: ts.CallExpression): boolean {
  const callback = call.arguments[0]
  if (!callback) return false
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
  if (callback.parameters.length === 0) return false

  const firstParam = callback.parameters[0]
  if (!firstParam) return false
  if (!ts.isIdentifier(firstParam.name)) return false
  const paramName = firstParam.name.text
  const bodyExpr = callbackBodyExpression(callback.body)
  if (!bodyExpr || !ts.isBinaryExpression(bodyExpr)) return false
  if (bodyExpr.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false

  const leftIsParam = ts.isIdentifier(bodyExpr.left) && bodyExpr.left.text === paramName
  const rightIsParam = ts.isIdentifier(bodyExpr.right) && bodyExpr.right.text === paramName
  if (!leftIsParam && !rightIsParam) return false

  const otherSide = leftIsParam ? bodyExpr.right : bodyExpr.left
  return !expressionReferencesAny(otherSide, new Set([paramName]))
}

function callbackBodyExpression(body: ts.Block | ts.Expression | ts.ConciseBody): ts.Expression | null {
  if (!ts.isBlock(body)) return body as ts.Expression
  if (body.statements.length !== 1) return null
  const statement = body.statements[0]
  if (!statement) return null
  if (!ts.isReturnStatement(statement)) return null
  return statement.expression ?? null
}

function isManualIndexComparison(member: ts.ElementAccessExpression, isInConditional: boolean): boolean {
  if (!isInConditional) return false
  const enclosingLoop = getEnclosingLoop(member)
  if (!enclosingLoop) return false

  const comparisonCandidate = nearestComparisonCandidate(member)
  return comparisonCandidate !== null && COMPARISON_OPERATORS.has(comparisonCandidate.operatorToken.getText())
}

function nearestComparisonCandidate(member: ts.ElementAccessExpression): ts.BinaryExpression | null {
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

function asComparison(node: ts.Node): ts.BinaryExpression | null {
  if (ts.isBinaryExpression(node)) return node
  return null
}

function isTypeWrapper(node: ts.Node): boolean {
  return (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
}

function recordUsage(graph: SolidGraph, map: Map<string, UsageInfo>, node: ts.Node): void {
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
