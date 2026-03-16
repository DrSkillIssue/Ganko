/**
 * Effect Outside Root Rule
 *
 * Detects createEffect/createMemo/createComputed/createRenderEffect called
 * outside a reactive root (component, createRoot, runWithOwner).
 *
 * Without an Owner, computations are orphaned and never disposed.
 * They hold references to their sources and closure forever.
 *
 * BAD:
 *   const [count, setCount] = createSignal(0);
 *   createEffect(() => console.log(count()));
 *
 * GOOD:
 *   function App() {
 *     const [count, setCount] = createSignal(0);
 *     createEffect(() => console.log(count()));
 *     return <div>{count()}</div>;
 *   }
 */

import ts from "typescript"
import type { SolidGraph } from "../../impl"
import type { CallEntity, ScopeEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import {
  getCallsByPrimitive,
  getEnclosingComponentScope,
  getAncestorScopes,
  getCallByNode,
} from "../../queries"
import { getFunctionName } from "../../util"
import { isFunctionInReactivePrimitiveConfig } from "../../util/pattern-detection"
import { EFFECT_SOURCES } from "./leak-detect"

const messages = {
  orphanedEffect:
    "{{primitive}}() called outside a reactive root. Without an Owner, this computation is never disposed and leaks memory. Wrap in a component, createRoot, or runWithOwner.",
} as const

const options = {}

export const effectOutsideRoot = defineSolidRule({
  id: "effect-outside-root",
  severity: "error",
  messages,
  meta: {
    description: "Detect reactive computations created outside a reactive root (no Owner).",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    for (const primitive of EFFECT_SOURCES) {
      const calls = getCallsByPrimitive(graph, primitive)

      for (let i = 0, len = calls.length; i < len; i++) {
        const call = calls[i]
        if (!call) continue

        if (hasOwner(graph, call)) continue

        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "effect-outside-root",
            "orphanedEffect",
            resolveMessage(messages.orphanedEffect, { primitive }),
            "error",
          ),
        )
      }
    }
  },
})

/**
 * Check if a call has an Owner at runtime.
 *
 * Owner is set when inside:
 * 1. A component function body
 * 2. A createRoot callback
 * 3. A runWithOwner callback
 * 4. A custom reactive primitive (createXxx/useXxx convention)
 */
function hasOwner(graph: SolidGraph, call: CallEntity): boolean {
  const scope = call.scope

  if (getEnclosingComponentScope(graph, scope) !== null) {
    return true
  }

  // Also check if the scope itself is a component (wiring only sets parents)
  if (graph.componentScopes.has(scope)) {
    return true
  }

  const ancestors = getAncestorScopes(graph, scope)
  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i]
    if (!ancestor) continue;
    if (ancestor.kind !== "function") continue

    const node = ancestor.node
    if (node === null) continue

    if (
      !ts.isArrowFunction(node) &&
      !ts.isFunctionExpression(node) &&
      !ts.isFunctionDeclaration(node)
    ) continue

    // Check if this function is a callback to createRoot or runWithOwner
    const parent = node.parent
    if (parent && ts.isCallExpression(parent)) {
      const parentCall = getCallByNode(graph, parent)
      if (parentCall?.primitive) {
        const name = parentCall.primitive.name
        if (name === "createRoot" || name === "runWithOwner") {
          return true
        }
      }
    }

    // Check if this function matches reactive primitive naming (createXxx/useXxx)
    // AND contains a Solid reactive primitive call (to avoid suppressing for
    // non-reactive functions like createLogger, createElement)
    const name = getFunctionName(node)
    if (name !== null && isReactivePrimitiveName(name) && containsSolidPrimitive(graph, ancestor)) {
      return true
    }

    // Check if this function is a property callback inside an object literal
    // argument to a create*/use* call (e.g. createSimpleContext({ init: () => ... }))
    if (isFunctionInReactivePrimitiveConfig(node)) {
      return true
    }
  }

  return false
}

/**
 * Check if a scope contains any Solid reactive primitive call.
 * This verifies the function is genuinely a reactive hook, not just
 * a function that happens to start with "create" or "use".
 */
function containsSolidPrimitive(graph: SolidGraph, scope: ScopeEntity): boolean {
  if (!scope.node) return false
  const scopeStart = scope.node.getStart()
  const scopeEnd = scope.node.end

  const calls = graph.calls
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i]
    if (!call) continue;
    if (!call.primitive) continue
    const callStart = call.node.getStart()
    if (callStart >= scopeStart && call.node.end <= scopeEnd) {
      return true
    }
  }

  return false
}

function isReactivePrimitiveName(name: string): boolean {
  const len = name.length
  if (len > 6 && name.charCodeAt(0) === 99 && name.startsWith("create")) return true
  if (len > 3 && name.charCodeAt(0) === 117 && name.startsWith("use")) return true
  return false
}
