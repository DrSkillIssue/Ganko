/**
 * Recursive Timer Rule
 *
 * Detects setTimeout that recursively calls its enclosing function,
 * creating an unbreakable polling loop. When used inside effects,
 * multiple chains accumulate since no cleanup cancels them.
 *
 * BAD:
 *   function poll() {
 *     fetch("/status").then(() => setTimeout(poll, 5000));
 *   }
 *
 * GOOD:
 *   function poll(signal: AbortSignal) {
 *     if (signal.aborted) return;
 *     fetch("/status").then(() => setTimeout(() => poll(signal), 5000));
 *   }
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { Emit } from "../../../graph"
import type { SolidGraph } from "../../impl"
import type { CallEntity, FunctionEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { isInsideNode } from "./leak-detect"

const messages = {
  recursiveTimer:
    "setTimeout() recursively calls '{{name}}', creating an unbreakable polling loop. Add a termination condition or use setInterval with cleanup.",
} as const

const options = {}

export const recursiveTimer = defineSolidRule({
  id: "recursive-timer",
  severity: "warn",
  messages,
  meta: {
    description: "Detect setTimeout that recursively calls its enclosing function.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const calls = graph.calls

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;
      const callee = call.callee
      if (callee.type !== "Identifier" || callee.name !== "setTimeout") continue

      const firstArg = call.arguments[0]
      if (!firstArg) continue

      const argNode = firstArg.node
      const enclosing = getNamedEnclosingFunction(graph, call.node)
      if (!enclosing) continue

      // Skip if the enclosing function has a termination condition (early return)
      if (hasTerminationCondition(enclosing)) continue

      const enclosingName = preferredFunctionName(enclosing)
      if (!enclosingName) continue

      // Case 1: setTimeout(fnName, delay) — direct reference
      if (argNode.type === "Identifier" && referencesFunction(enclosing, argNode.name)) {
        emitDiagnostic(graph, emit, call, enclosingName)
        continue
      }

      // Case 2: setTimeout(() => fnName(...), delay) — call inside callback
      if (
        argNode.type === "ArrowFunctionExpression" ||
        argNode.type === "FunctionExpression"
      ) {
        if (callbackCallsFunction(graph, argNode, enclosing)) {
          emitDiagnostic(graph, emit, call, enclosingName)
        }
      }
    }
  },
})

function emitDiagnostic(graph: SolidGraph, emit: Emit, call: CallEntity, name: string): void {
  emit(
    createDiagnostic(
      graph.file,
      call.node,
      "recursive-timer",
      "recursiveTimer",
      resolveMessage(messages.recursiveTimer, { name }),
      "warn",
    ),
  )
}

/**
 * Check if a function has a termination condition — an early return that
 * prevents unconditional recursion.
 */
function hasTerminationCondition(fn: FunctionEntity): boolean {
  const returns = fn.returnStatements
  for (let i = 0, len = returns.length; i < len; i++) {
    const ret = returns[i];
    if (!ret) continue;
    if (ret.isEarly) return true
  }
  return false
}

function getNamedEnclosingFunction(graph: SolidGraph, node: T.Node): FunctionEntity | null {
  if (!node.range) return null

  let best: FunctionEntity | null = null
  let bestSize = Infinity
  for (let i = 0, len = graph.functions.length; i < len; i++) {
    const fn = graph.functions[i]
    if (!fn) continue;
    if (!fn.name && !fn.variableName) continue

    const range = fn.node.range
    if (!range) continue
    if (!isNodeRangeInside(node.range, range)) continue

    const size = range[1] - range[0]
    if (size >= bestSize) continue
    best = fn
    bestSize = size
  }

  return best
}

function isNodeRangeInside(
  inner: readonly [number, number],
  outer: readonly [number, number],
): boolean {
  return inner[0] >= outer[0] && inner[1] <= outer[1]
}

/**
 * Check if a callback body calls a function by name, using the graph's
 * existing call entities rather than walking the AST.
 */
function callbackCallsFunction(
  graph: SolidGraph,
  callback: T.ArrowFunctionExpression | T.FunctionExpression,
  fn: FunctionEntity,
): boolean {
  const calls = graph.calls
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i]
    if (!call) continue;
    const callee = call.callee
    if (callee.type !== "Identifier") continue
    if (!referencesFunction(fn, callee.name)) continue
    if (isInsideNode(call.node, callback)) return true
  }
  return false
}

function referencesFunction(fn: FunctionEntity, identifierName: string): boolean {
  if (fn.name === identifierName) return true
  return fn.variableName === identifierName
}

function preferredFunctionName(fn: FunctionEntity): string | null {
  return fn.name ?? fn.variableName
}
