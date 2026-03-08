/**
 * Flags queue/worklist traversals that grow without bounded guards.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { ScopeEntity, VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateVariables } from "../../queries"

const messages = {
  boundedWorklist:
    "Worklist '{{name}}' grows via push() without visited set or explicit size bound. Add traversal guard to prevent pathological growth.",
} as const

const options = {}

interface QueueUsage {
  node: T.Node
  hasPushInLoop: boolean
  hasLengthInLoop: boolean
  hasConditionalLengthInLoop: boolean
}

export const boundedWorklistTraversal = defineSolidRule({
  id: "bounded-worklist-traversal",
  severity: "warn",
  messages,
  meta: {
    description: "Detect queue/worklist traversals with unbounded growth and no guard.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!isQueueLikeArray(variable)) continue
      if (!looksLikeWorklistName(variable.name)) continue

      const usage = summarizeQueueUsage(variable)
      if (!usage) continue
      if (!usage.hasPushInLoop) continue
      if (!usage.hasLengthInLoop) continue
      if (usage.hasConditionalLengthInLoop) continue
      if (hasVisitedSetGuard(variable)) continue

      emit(
        createDiagnostic(
          graph.file,
          usage.node,
          "bounded-worklist-traversal",
          "boundedWorklist",
          resolveMessage(messages.boundedWorklist, {
            name: variable.name,
          }),
          "warn",
        ),
      )
    }
  },
})

function isQueueLikeArray(variable: VariableEntity): boolean {
  if (variable.assignments.length === 0) return false
  const first = variable.assignments[0]
  if (!first) return false
  if (first.operator !== null) return false
  return first.value.type === "ArrayExpression"
}

function summarizeQueueUsage(variable: VariableEntity): QueueUsage | null {
  let firstPushNode: T.Node | null = null
  let hasPushInLoop = false
  let hasLengthInLoop = false
  let hasConditionalLengthInLoop = false

  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i]
    if (!read) continue;
    const parent = read.node.parent
    if (!parent || parent.type !== "MemberExpression" || parent.object !== read.node) continue

    const method = memberPropertyName(parent)
    if (!method) continue

    if (method === "length" && read.isInLoop) {
      hasLengthInLoop = true
      if (read.isInConditional) hasConditionalLengthInLoop = true
      continue
    }

    if (method !== "push" || !read.isInLoop) continue

    const call = parent.parent
    if (!call || call.type !== "CallExpression" || call.callee !== parent) continue

    hasPushInLoop = true
    if (firstPushNode === null) firstPushNode = call
  }

  if (!firstPushNode) return null
  return {
    node: firstPushNode,
    hasPushInLoop,
    hasLengthInLoop,
    hasConditionalLengthInLoop,
  }
}

function hasVisitedSetGuard(queueVariable: VariableEntity): boolean {
  const ownerScope = resolveOwningFunctionScope(queueVariable.scope)

  for (const variable of iterateVariablesByScope(ownerScope)) {
    if (variable === queueVariable) continue
    if (!isSetVariable(variable)) continue

    let hasHas = false
    let hasAdd = false

    for (let i = 0; i < variable.reads.length; i++) {
      const read = variable.reads[i]
      if (!read) continue;
      if (!read.isInLoop) continue

      const parent = read.node.parent
      if (!parent || parent.type !== "MemberExpression" || parent.object !== read.node) continue
      const call = parent.parent
      if (!call || call.type !== "CallExpression" || call.callee !== parent) continue

      const method = memberPropertyName(parent)
      if (method === "has") hasHas = true
      if (method === "add") hasAdd = true
      if (hasHas && hasAdd) return true
    }
  }

  return false
}

function iterateVariablesByScope(ownerScope: ScopeEntity): readonly VariableEntity[] {
  const out: VariableEntity[] = []
  const stack: ScopeEntity[] = [ownerScope]

  for (let i = 0; i < stack.length; i++) {
    const scope = stack[i]
    if (!scope) continue;
    for (let j = 0; j < scope.variables.length; j++) {
      const v = scope.variables[j];
      if (!v) continue;
      out.push(v)
    }
    for (let j = 0; j < scope.children.length; j++) {
      const child = scope.children[j];
      if (!child) continue;
      stack.push(child)
    }
  }

  return out
}

function resolveOwningFunctionScope(scope: ScopeEntity): ScopeEntity {
  let current: ScopeEntity | null = scope
  while (current) {
    if (current.kind === "function") return current
    if (current.parent === null) return current
    current = current.parent
  }
  return scope
}

function isSetVariable(variable: VariableEntity): boolean {
  if (variable.assignments.length === 0) return false
  const first = variable.assignments[0]
  if (!first) return false
  if (first.operator !== null) return false

  const value = first.value
  if (value.type === "NewExpression" && value.callee.type === "Identifier") {
    return value.callee.name === "Set"
  }
  if (value.type === "CallExpression" && value.callee.type === "Identifier") {
    return value.callee.name === "Set"
  }
  return false
}

function looksLikeWorklistName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes("queue") || lower.includes("worklist")
}

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}
