/**
 * Create Root Dispose Rule
 *
 * Detects createRoot(dispose => ...) where the dispose parameter is never used.
 *
 * When createRoot receives a callback with a parameter, that parameter is the
 * dispose function. If never called, the reactive tree lives forever.
 *
 * BAD:
 *   createRoot((dispose) => {
 *     createEffect(() => { ... });
 *   });
 *
 * GOOD:
 *   createRoot((dispose) => {
 *     createEffect(() => { ... });
 *     onCleanup(dispose);
 *   });
 */

import ts from "typescript"
import type { SolidGraph } from "../../impl"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByPrimitive } from "../../queries"

const messages = {
  unusedDispose:
    "createRoot() dispose parameter is never used. The reactive tree will never be cleaned up. Call dispose(), return it, or pass it to onCleanup().",
} as const

const options = {}

export const createRootDispose = defineSolidRule({
  id: "create-root-dispose",
  severity: "warn",
  messages,
  meta: {
    description: "Detect createRoot with unused dispose parameter.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const calls = getCallsByPrimitive(graph, "createRoot")
    if (calls.length === 0) return

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;
      const callbackArg = call.arguments[0]
      if (!callbackArg) continue

      const callbackNode = callbackArg.node
      if (
        !ts.isArrowFunction(callbackNode) &&
        !ts.isFunctionExpression(callbackNode)
      ) continue

      // Only flag when the callback declares a dispose parameter
      const params = callbackNode.parameters
      if (params.length === 0) continue

      const disposeParam = params[0]
      if (!disposeParam) continue;
      if (!ts.isIdentifier(disposeParam.name)) continue

      // Find the variable entity for the dispose parameter via scope resolution
      const disposeVar = findParameterVariable(graph, disposeParam.name.text, callbackNode)
      if (disposeVar && disposeVar.reads.length > 0) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          graph.sourceFile,
          "create-root-dispose",
          "unusedDispose",
          messages.unusedDispose,
          "warn",
        ),
      )
    }
  },
})

/**
 * Find the VariableEntity for a parameter by resolving through the graph's
 * scope system. This correctly handles shadowed names because each scope
 * tracks its own variable bindings.
 */
function findParameterVariable(
  graph: SolidGraph,
  name: string,
  fnNode: ts.ArrowFunction | ts.FunctionExpression,
): VariableEntity | null {
  // The function's scope contains the parameter as a variable
  const scopes = graph.scopes
  for (let i = 0, len = scopes.length; i < len; i++) {
    const scope = scopes[i]
    if (!scope) continue;
    if (scope.node !== fnNode) continue
    const vars = scope.variables
    for (let vi = 0, vlen = vars.length; vi < vlen; vi++) {
      const v = vars[vi];
      if (!v) continue;
      if (v.name === name) return v
    }
  }
  return null
}
