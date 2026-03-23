/**
 * Flags functions that call .indexOf() on the same array variable 3+ times.
 * Multiple indexOf calls on arrays should be replaced with a Set lookup or
 * single-pass scan.
 *
 * Excludes string receivers — repeated .indexOf() on strings is a valid
 * substring search pattern (e.g., scanning for multiple characters).
 */

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getContainingFunction } from "../../queries"
import { isStringLikeReceiver } from "./string-parsing-context"

const messages = {
  repeatedIndexOf:
    "{{count}} .indexOf() calls on `{{name}}` in the same function. Use a Set, regex, or single-pass scan instead.",
} as const

const options = {}

const THRESHOLD = 3

/**
 * Extracts the receiver identifier name from a method call.
 * Returns null for non-identifier receivers (e.g. chained calls, computed).
 *
 * @param node - CallExpression node
 * @returns The identifier name of the receiver, or null
 */
function receiverName(node: ts.CallExpression | ts.NewExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null
  const obj = node.expression.expression
  if (ts.isIdentifier(obj)) return obj.text
  return null
}

/**
 * Determines if a variable is string-typed using all available evidence.
 *
 * @param graph - The SolidGraph for type resolution
 * @param name - The variable name to check
 * @param receiverNode - The receiver AST node for type-info lookups
 * @returns True if the variable is provably string-typed
 */

interface GroupEntry {
  readonly name: string
  readonly receiver: ts.Node
  readonly variable: VariableEntity | null
  readonly nodes: ts.Node[]
}

export const avoidRepeatedIndexofCheck = defineSolidRule({
  id: "avoid-repeated-indexof-check",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow 3+ .indexOf() calls on the same array variable in one function.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const indexOfCalls = getCallsByMethodName(graph, "indexOf")
    if (indexOfCalls.length < THRESHOLD) return

    const grouped = new Map<string, GroupEntry>()

    for (let i = 0, len = indexOfCalls.length; i < len; i++) {
      const call = indexOfCalls[i]
      if (!call) continue;
      const name = receiverName(call.node)
      if (!name) continue

      const fn = getContainingFunction(graph, call.node)
      if (!fn) continue

      const callee = call.node.expression
      const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : call.node
      const variable = call.calleeRootVariable
      const receiverKey = variable ? `var:${variable.id}` : `name:${name}`
      const key = `${fn.id}:${receiverKey}`

      const existing = grouped.get(key)
      if (existing) {
        existing.nodes.push(call.node)
        continue
      }

      grouped.set(key, {
        name,
        receiver,
        variable,
        nodes: [call.node],
      })
    }

    for (const [, entry] of grouped) {
      if (entry.nodes.length < THRESHOLD) continue

      // Skip string receivers — repeated .indexOf() on strings is valid
      // (scanning for multiple different substrings)
      if (isStringLikeReceiver(graph, entry.receiver as never, entry.variable)) continue

      const indexDiagNode = entry.nodes[0]
      if (!indexDiagNode) continue

      emit(
        createDiagnostic(
          graph.filePath,
          indexDiagNode,
          graph.sourceFile,
          "avoid-repeated-indexof-check",
          "repeatedIndexOf",
          resolveMessage(messages.repeatedIndexOf, {
            count: String(entry.nodes.length),
            name: entry.name,
          }),
          "warn",
        ),
      )
    }
  },
})
