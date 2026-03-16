/**
 * Flags linear array searches called inside loops on the same collection.
 * When .includes() or .indexOf() is called on an array identifier inside a loop body,
 * the collection should be converted to a Set for O(1) lookups.
 *
 * Excludes string receivers — .indexOf() on strings is a substring search,
 * not a membership check convertible to Set.has().
 */

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"
import { getEnclosingLoop, expressionReferencesAny } from "../../util"
import { isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  preferSet:
    "`.{{method}}()` on `{{name}}` called inside a loop. Convert to a Set for O(1) lookups.",
} as const

const options = {}

const LINEAR_SEARCH_METHODS = ["includes", "indexOf", "find"] as const



/**
 * Extracts the receiver identifier name from a method call.
 *
 * @param node - CallExpression node
 * @returns The identifier name of the receiver, or null
 */
function receiverName(node: ts.CallExpression | ts.NewExpression): string | null {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  const obj = callee.expression
  if (ts.isIdentifier(obj)) return obj.text
  return null
}

function findIsMembershipCheck(node: ts.CallExpression): boolean {
  const callback = node.arguments[0]
  if (!callback) return false
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
  if (callback.parameters.length === 0) return false

  const firstParam = callback.parameters[0]
  if (!firstParam) return false
  if (!ts.isIdentifier(firstParam.name)) return false
  const paramName = firstParam.name.text

  const expression = callbackBodyExpression(callback.body)
  if (!expression) return false
  if (!ts.isBinaryExpression(expression)) return false
  if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false

  const leftIsParam = ts.isIdentifier(expression.left) && expression.left.text === paramName
  const rightIsParam = ts.isIdentifier(expression.right) && expression.right.text === paramName
  if (!leftIsParam && !rightIsParam) return false

  const otherSide = leftIsParam ? expression.right : expression.left
  return !expressionReferencesAny(otherSide, new Set([paramName]))
}

function callbackBodyExpression(body: ts.Block | ts.Expression | ts.ConciseBody): ts.Expression | null {
  if (!ts.isBlock(body)) return body
  if (body.statements.length !== 1) return null
  const statement = body.statements[0]
  if (!statement) return null
  if (!ts.isReturnStatement(statement)) return null
  return statement.expression ?? null
}

/**
 * Checks if the receiver is declared outside (before) the loop.
 * A locally-built array inside the loop is not a candidate for Set conversion.
 *
 * @param loop - The enclosing loop node
 * @param variable - Receiver variable entity
 * @returns True if the receiver's binding is declared outside the loop
 */
function isDeclaredOutsideLoop(loop: ts.Node, variable: VariableEntity): boolean {
  if (variable.declarations.length === 0) return false
  for (let i = 0; i < variable.declarations.length; i++) {
    const declaration = variable.declarations[i]
    if (!declaration) continue
    if (declaration.pos >= loop.pos && declaration.end <= loop.end) return false
  }
  return true
}

export const preferSetLookupInLoop = defineSolidRule({
  id: "prefer-set-lookup-in-loop",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow linear search methods (.includes/.indexOf) on arrays inside loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const reported = new Set<string>()

    for (const method of LINEAR_SEARCH_METHODS) {
      const calls = getCallsByMethodName(graph, method)

      for (let i = 0, len = calls.length; i < len; i++) {
        const call = calls[i]
        if (!call) continue
        if (!ts.isCallExpression(call.node)) continue

        if (method === "find" && !findIsMembershipCheck(call.node)) continue

        const name = receiverName(call.node)
        if (!name) continue
        const callee = call.node.expression
        if (!ts.isPropertyAccessExpression(callee)) continue
        if (!ts.isIdentifier(callee.expression)) continue
        const variable = call.calleeRootVariable
        if (!variable) continue

        const loop = getEnclosingLoop(call.node)
        if (!loop) continue

        if (!isDeclaredOutsideLoop(loop, variable)) continue

        // Skip string receivers — .indexOf() on strings is substring search
        if (isStringLikeReceiver(graph, callee.expression, variable)) continue

        // Deduplicate: one report per variable per loop
        const key = `${loop.pos}:var:${variable.id}`
        if (reported.has(key)) continue
        reported.add(key)

        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "prefer-set-lookup-in-loop",
            "preferSet",
            resolveMessage(messages.preferSet, { method, name }),
            "warn",
          ),
        )
      }
    }
  },
})
