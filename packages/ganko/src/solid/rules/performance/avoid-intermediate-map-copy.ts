/**
 * Flags temporary Map pipelines that copy key-for-key into another Map.
 */

import ts from "typescript"
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
  node: ts.Node
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
          graph.filePath,
          loopCopy.node,
          graph.sourceFile,
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
  const init = variable.initializer
  if (!init || !ts.isNewExpression(init)) return false
  if (!init.expression || !ts.isIdentifier(init.expression)) return false
  return init.expression.text === "Map"
}

function countForOfConsumers(variable: VariableEntity): number {
  let count = 0
  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i];
    if (!read) continue;
    const readNode = read.node
    const parent = readNode.parent
    if (!parent) continue

    if (ts.isForOfStatement(parent) && parent.expression === readNode) {
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

    if (ts.isReturnStatement(parent)) return true
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node) return true
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
    if (!parent || !ts.isPropertyAccessExpression(parent) || parent.expression !== readNode) continue

    const call = parent.parent
    if (!call || !ts.isCallExpression(call) || call.expression !== parent) continue

    const method = parent.name.text
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

function findMapCopyLoop(calls: readonly { node: ts.CallExpression | ts.NewExpression }[], temp: VariableEntity): LoopCopyInfo | null {
  for (let i = 0; i < temp.reads.length; i++) {
    const tempRead = temp.reads[i];
    if (!tempRead) continue;
    const readNode = tempRead.node
    const parent = readNode.parent
    if (!parent || !ts.isForOfStatement(parent) || parent.expression !== readNode) continue

    const keyName = forOfKeyName(parent.initializer)
    if (!keyName) continue

    const loopStart = parent.getStart()
    const loopEnd = parent.end
    for (let j = 0; j < calls.length; j++) {
      const callEntry = calls[j];
      if (!callEntry) continue;
      const node = callEntry.node
      if (!ts.isCallExpression(node)) continue
      const nodeStart = node.getStart()
      if (!(nodeStart >= loopStart && node.end <= loopEnd)) continue

      const callee = node.expression
      if (!ts.isPropertyAccessExpression(callee)) continue
      const method = callee.name.text
      if (method !== "set") continue
      if (!ts.isIdentifier(callee.expression)) continue

      const firstArg = node.arguments[0]
      if (!firstArg || !ts.isIdentifier(firstArg) || firstArg.text !== keyName) continue
      if (callee.expression.text === temp.name) continue

      return {
        outName: callee.expression.text,
        node,
      }
    }
  }

  return null
}

function forOfKeyName(left: ts.ForInitializer): string | null {
  if (!ts.isVariableDeclarationList(left)) return null
  if (left.declarations.length !== 1) return null
  const decl = left.declarations[0]
  if (!decl || !ts.isArrayBindingPattern(decl.name)) return null
  const first = decl.name.elements[0]
  if (!first || !ts.isBindingElement(first) || !ts.isIdentifier(first.name)) return null
  return first.name.text
}

function isCallArgument(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const args = parent.arguments
    if (args) {
      for (let i = 0; i < args.length; i++) {
        const argument = args[i]
        if (!argument) continue;
        if (argument === node) return true
        if (ts.isSpreadElement(argument) && argument.expression === node) return true
      }
    }
  }

  if (ts.isSpreadElement(parent)) {
    const grand = parent.parent
    if (!grand) return false
    return ts.isCallExpression(grand) || ts.isNewExpression(grand)
  }

  return false
}
