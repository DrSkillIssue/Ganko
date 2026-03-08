import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getContainingFunction, getMethodChain } from "../../queries"
import { resolveVariableForIdentifier } from "./string-parsing-context"

const messages = {
  repeatedTokenNormalization:
    "Repeated token normalization `{{chain}}` on `{{name}}` in one function. Compute once and reuse.",
} as const

const options = {}

const NORMALIZATION_METHODS = ["trim", "toLowerCase", "toUpperCase"] as const

export const noRepeatedTokenNormalization = defineSolidRule({
  id: "no-repeated-token-normalization",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow repeated trim/lower/upper normalization chains on the same token in one function.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const grouped = new Map<string, { node: T.Node; chain: string; name: string; count: number }>()

    for (let i = 0; i < NORMALIZATION_METHODS.length; i++) {
      const normMethod = NORMALIZATION_METHODS[i]
      if (!normMethod) continue
      const calls = getCallsByMethodName(graph, normMethod)

      for (let j = 0; j < calls.length; j++) {
        const call = calls[j]
        if (!call) return;
        const { methods, root } = getMethodChain(graph, call)
        if (methods.length < 2) continue
        if (!allNormalizationMethods(methods)) continue
        if (!root || root.type !== "Identifier") continue

        if (!call) return;
        const fn = getContainingFunction(graph, call.node)
        const fnId = fn?.id ?? -1

        const variable = resolveVariableForIdentifier(graph, root)
        if (!variable) continue
        if (isReassignedInFunction(graph, variable, fnId)) continue

        const chain = methods.join("().") + "()"
        const key = `${fnId}:var:${variable.id}:${chain}`
        const existing = grouped.get(key)
        if (!existing) {
          grouped.set(key, {
            node: call.node,
            chain,
            name: variable.name,
            count: 1,
          })
          continue
        }
        existing.count++
      }
    }

    for (const [, entry] of grouped) {
      if (entry.count < 2) continue
      emit(
        createDiagnostic(
          graph.file,
          entry.node,
          "no-repeated-token-normalization",
          "repeatedTokenNormalization",
          resolveMessage(messages.repeatedTokenNormalization, {
            chain: entry.chain,
            name: entry.name,
          }),
          "warn",
        ),
      )
    }
  },
})

function allNormalizationMethods(methods: readonly string[]): boolean {
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i]
    if (method !== "trim" && method !== "toLowerCase" && method !== "toUpperCase") {
      return false
    }
  }
  return true
}

function isReassignedInFunction(
  graph: SolidGraph,
  variable: VariableEntity,
  functionId: number,
): boolean {
  for (let i = 0; i < variable.assignments.length; i++) {
    const assignment = variable.assignments[i]
    if (!assignment) continue;
    if (assignment.operator === null) continue
    const owner = getContainingFunction(graph, assignment.node)
    const ownerId = owner?.id ?? -1
    if (ownerId === functionId) return true
  }
  return false
}
