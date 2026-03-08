/**
 * Flags temporary Map pipelines that copy key-for-key into another Map.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateVariables } from "../../queries"

const messages = {
  intermediateMapCopy:
    "Intermediate Map '{{tempName}}' is copied into '{{outName}}' key-for-key. Build output directly to avoid extra allocation.",
} as const

const options = {}

interface LoopCopyInfo {
  outName: string
  node: T.Node
}

export const avoidIntermediateMapCopy = defineSolidRule({
  id: "avoid-intermediate-map-copy",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow temporary Map allocations that are copied key-for-key into another Map.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!isLocalMap(variable)) continue
      if (escapesScope(variable)) continue

      const usage = summarizeMapUsage(variable)
      if (usage.writes === 0) continue
      if (usage.queries > 0) continue

      const loopCopy = findMapCopyLoop(graph.calls, variable)
      if (!loopCopy) continue
      if (countForOfConsumers(variable) !== 1) continue

      emit(
        createDiagnostic(
          graph.file,
          loopCopy.node,
          "avoid-intermediate-map-copy",
          "intermediateMapCopy",
          resolveMessage(messages.intermediateMapCopy, {
            tempName: variable.name,
            outName: loopCopy.outName,
          }),
          "warn",
        ),
      )
    }
  },
})

function isLocalMap(variable: VariableEntity): boolean {
  if (variable.scope.kind === "program") return false
  if (variable.assignments.length === 0) return false

  const first = variable.assignments[0]
  if (!first) return false
  if (first.operator !== null) return false
  if (first.value.type !== "NewExpression") return false
  if (first.value.callee.type !== "Identifier") return false
  return first.value.callee.name === "Map"
}

function countForOfConsumers(variable: VariableEntity): number {
  let count = 0
  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i];
    if (!read) continue;
    const readNode = read.node
    const parent = readNode.parent
    if (!parent) continue

    if (parent.type === "ForOfStatement" && parent.right === readNode) {
      count++
    }
  }
  return count
}

function escapesScope(variable: VariableEntity): boolean {
  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i];
    if (!read) continue;
    const node = read.node
    const parent = node.parent
    if (!parent) continue

    if (parent.type === "ReturnStatement") return true
    if (parent.type === "VariableDeclarator" && parent.init === node) return true
    if (parent.type === "AssignmentExpression" && parent.right === node) return true
    if (isCallArgument(node, parent)) return true
  }
  return false
}

function summarizeMapUsage(variable: VariableEntity): { writes: number; queries: number } {
  let writes = 0
  let queries = 0

  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i];
    if (!read) continue;
    const readNode = read.node
    const parent = readNode.parent
    if (!parent || parent.type !== "MemberExpression" || parent.object !== readNode) continue

    const call = parent.parent
    if (!call || call.type !== "CallExpression" || call.callee !== parent) continue

    const method = memberPropertyName(parent)
    if (!method) continue

    if (method === "set") {
      writes++
      continue
    }
    if (method === "get" || method === "has") {
      queries++
      continue
    }
  }

  return { writes, queries }
}

function findMapCopyLoop(calls: readonly { node: T.CallExpression | T.NewExpression }[], temp: VariableEntity): LoopCopyInfo | null {
  for (let i = 0; i < temp.reads.length; i++) {
    const tempRead = temp.reads[i];
    if (!tempRead) continue;
    const readNode = tempRead.node
    const parent = readNode.parent
    if (!parent || parent.type !== "ForOfStatement" || parent.right !== readNode) continue

    const keyName = forOfKeyName(parent.left)
    if (!keyName) continue

    const loopRange = parent.range
    for (let j = 0; j < calls.length; j++) {
      const callEntry = calls[j];
      if (!callEntry) continue;
      const node = callEntry.node
      if (node.type !== "CallExpression") continue
      if (!isInside(node, loopRange)) continue

      const callee = node.callee
      if (callee.type !== "MemberExpression") continue
      const method = memberPropertyName(callee)
      if (method !== "set") continue
      if (callee.object.type !== "Identifier") continue

      const firstArg = node.arguments[0]
      if (!firstArg || firstArg.type !== "Identifier" || firstArg.name !== keyName) continue
      if (callee.object.name === temp.name) continue

      return {
        outName: callee.object.name,
        node,
      }
    }
  }

  return null
}

function forOfKeyName(left: T.ForOfStatement["left"]): string | null {
  if (left.type !== "VariableDeclaration") return null
  if (left.declarations.length !== 1) return null
  const decl = left.declarations[0]
  if (!decl || decl.id.type !== "ArrayPattern") return null
  const first = decl.id.elements[0]
  if (!first || first.type !== "Identifier") return null
  return first.name
}

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}

function isCallArgument(node: T.Node, parent: T.Node): boolean {
  if (parent.type === "CallExpression" || parent.type === "NewExpression") {
    for (let i = 0; i < parent.arguments.length; i++) {
      const argument = parent.arguments[i]
      if (!argument) continue;
      if (argument === node) return true
      if (argument.type === "SpreadElement" && argument.argument === node) return true
    }
  }

  if (parent.type === "SpreadElement") {
    const grand = parent.parent
    if (!grand) return false
    return grand.type === "CallExpression" || grand.type === "NewExpression"
  }

  return false
}

function isInside(node: T.Node, range: readonly [number, number]): boolean {
  return node.range[0] >= range[0] && node.range[1] <= range[1]
}
