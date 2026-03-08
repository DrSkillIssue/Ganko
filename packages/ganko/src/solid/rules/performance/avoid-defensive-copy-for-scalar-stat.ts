/**
 * Flags defensive array copies passed into scalar statistic functions.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
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
      if (call.node.type !== "CallExpression") continue

      const statName = calleeName(call.node.callee)
      if (!statName) continue
      if (!SCALAR_STATS.has(statName)) continue

      const firstArg = call.node.arguments[0]
      if (!firstArg) continue
      if (firstArg.type === "SpreadElement") continue
      if (!isDefensiveArrayCopy(firstArg)) continue

      emit(
        createDiagnostic(
          graph.file,
          firstArg,
          "avoid-defensive-copy-for-scalar-stat",
          "defensiveCopy",
          resolveMessage(messages.defensiveCopy, { stat: statName }),
          "warn",
        ),
      )
    }
  },
})

function calleeName(callee: T.CallExpression["callee"]): string | null {
  if (callee.type === "Identifier") return callee.name
  if (callee.type === "MemberExpression") {
    if (callee.property.type === "Identifier") return callee.property.name
    if (callee.property.type === "Literal" && typeof callee.property.value === "string") {
      return callee.property.value
    }
  }
  return null
}

function isDefensiveArrayCopy(argument: T.Expression): boolean {
  if (argument.type === "ArrayExpression") {
    if (argument.elements.length !== 1) return false
    const first = argument.elements[0]
    return first?.type === "SpreadElement"
  }

  if (argument.type !== "CallExpression") return false

  if (isZeroArgSliceCall(argument)) return true
  if (isArrayFromCall(argument)) return true

  return false
}

function isZeroArgSliceCall(node: T.CallExpression): boolean {
  if (node.arguments.length !== 0) return false
  const callee = node.callee
  if (callee.type !== "MemberExpression") return false

  const property = callee.property
  if (property.type === "Identifier") return property.name === "slice"
  if (property.type === "Literal" && typeof property.value === "string") return property.value === "slice"
  return false
}

function isArrayFromCall(node: T.CallExpression): boolean {
  const callee = node.callee
  if (callee.type !== "MemberExpression") return false
  if (callee.object.type !== "Identifier" || callee.object.name !== "Array") return false
  const property = callee.property
  return property.type === "Identifier" && property.name === "from"
}
