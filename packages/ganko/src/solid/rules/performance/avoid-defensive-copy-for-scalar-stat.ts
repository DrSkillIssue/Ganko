/**
 * Flags defensive array copies passed into scalar statistic functions.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

const messages = {
  defensiveCopy:
    "Defensive copy before scalar statistic '{{stat}}' allocates unnecessarily. Prefer readonly/non-mutating scalar computation.",
} as const

const options = {}

const SCALAR_STATS = new Set([
  "median",
  "computeMedian",
  "mean",
  "average",
  "percentile",
  "p95",
  "quantile",
  "sum",
  "variance",
  "stddev",
])

export const avoidDefensiveCopyForScalarStat = defineSolidRule({
  id: "avoid-defensive-copy-for-scalar-stat",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow defensive array copies passed into scalar statistic calls.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const calls = graph.calls
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      if (!call) continue;
      if (!ts.isCallExpression(call.node)) continue

      const statName = calleeName(call.node.expression)
      if (!statName) continue
      if (!SCALAR_STATS.has(statName)) continue

      const firstArg = call.node.arguments[0]
      if (!firstArg) continue
      if (ts.isSpreadElement(firstArg)) continue
      if (!isDefensiveArrayCopy(firstArg)) continue

      emit(
        createDiagnostic(
          graph.filePath,
          firstArg,
          graph.sourceFile,
          "avoid-defensive-copy-for-scalar-stat",
          "defensiveCopy",
          resolveMessage(messages.defensiveCopy, { stat: statName }),
          "warn",
        ),
      )
    }
  },
})

function calleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text
  }
  if (ts.isElementAccessExpression(callee)) {
    if (ts.isStringLiteral(callee.argumentExpression)) {
      return callee.argumentExpression.text
    }
  }
  return null
}

function isDefensiveArrayCopy(argument: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(argument)) {
    if (argument.elements.length !== 1) return false
    const first = argument.elements[0]
    return first !== undefined && ts.isSpreadElement(first)
  }

  if (!ts.isCallExpression(argument)) return false

  if (isZeroArgSliceCall(argument)) return true
  if (isArrayFromCall(argument)) return true

  return false
}

function isZeroArgSliceCall(node: ts.CallExpression): boolean {
  if (node.arguments.length !== 0) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  return callee.name.text === "slice"
}

function isArrayFromCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "Array") return false
  return callee.name.text === "from"
}
