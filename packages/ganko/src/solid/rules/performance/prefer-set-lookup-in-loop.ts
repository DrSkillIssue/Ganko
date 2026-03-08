/**
 * Flags linear array searches called inside loops on the same collection.
 * When .includes() or .indexOf() is called on an array identifier inside a loop body,
 * the collection should be converted to a Set for O(1) lookups.
 *
 * Excludes string receivers — .indexOf() on strings is a substring search,
 * not a membership check convertible to Set.has().
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
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
function receiverName(node: T.CallExpression | T.NewExpression): string | null {
  if (node.callee.type !== "MemberExpression") return null
  const obj = node.callee.object
  if (obj.type === "Identifier") return obj.name
  return null
}

function findIsMembershipCheck(node: T.CallExpression): boolean {
  const callback = node.arguments[0]
  if (!callback) return false
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return false
  if (callback.params.length === 0) return false

  const firstParam = callback.params[0]
  if (!firstParam) return false
  if (firstParam.type !== "Identifier") return false

  const expression = callbackBodyExpression(callback.body)
  if (!expression) return false
  if (expression.type !== "BinaryExpression") return false
  if (expression.operator !== "===") return false

  const leftIsParam = expression.left.type === "Identifier" && expression.left.name === firstParam.name
  const rightIsParam = expression.right.type === "Identifier" && expression.right.name === firstParam.name
  if (!leftIsParam && !rightIsParam) return false

  const otherSide = leftIsParam ? expression.right : expression.left
  return !expressionReferencesAny(otherSide, new Set([firstParam.name]))
}

function callbackBodyExpression(body: T.BlockStatement | T.Expression): T.Expression | null {
  if (body.type !== "BlockStatement") return body
  if (body.body.length !== 1) return null
  const statement = body.body[0]
  if (!statement) return null
  if (statement.type !== "ReturnStatement") return null
  return statement.argument ?? null
}

/**
 * Checks if the receiver is declared outside (before) the loop.
 * A locally-built array inside the loop is not a candidate for Set conversion.
 *
 * @param loop - The enclosing loop node
 * @param variable - Receiver variable entity
 * @returns True if the receiver's binding is declared outside the loop
 */
function isDeclaredOutsideLoop(loop: T.Node, variable: VariableEntity): boolean {
  if (!loop.range) return false
  const loopRange = loop.range

  if (variable.declarations.length === 0) return false
  for (let i = 0; i < variable.declarations.length; i++) {
    const declaration = variable.declarations[i]
    if (!declaration) continue
    if (!declaration.range) continue
    if (isRangeInside(declaration.range, loopRange)) return false
  }
  return true
}

function isRangeInside(inner: readonly [number, number], outer: readonly [number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] <= outer[1]
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
        if (call.node.type !== "CallExpression") continue

        if (method === "find" && !findIsMembershipCheck(call.node)) continue

        const name = receiverName(call.node)
        if (!name) continue
        const callee = call.node.callee
        if (callee.type !== "MemberExpression") continue
        if (callee.object.type !== "Identifier") continue
        const variable = call.calleeRootVariable
        if (!variable) continue

        const loop = getEnclosingLoop(call.node)
        if (!loop) continue

        if (!isDeclaredOutsideLoop(loop, variable)) continue

        // Skip string receivers — .indexOf() on strings is substring search
        if (isStringLikeReceiver(graph, callee.object, variable)) continue

        // Deduplicate: one report per variable per loop
        const key = `${loop.range[0]}:var:${variable.id}`
        if (reported.has(key)) continue
        reported.add(key)

        emit(
          createDiagnostic(
            graph.file,
            call.node,
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
