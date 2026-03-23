/**
 * Flags use of the arguments object which can prevent TurboFan from compiling.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";
import { getIdentifierReferences } from "../../queries/get"
import { getContainingFunction } from "../../queries/entity"

const messages = {
  avoidArguments: "arguments object can prevent V8 optimization. Use rest parameters (...args) instead.",
} as const

const options = {}

export const avoidArgumentsObject = defineSolidRule({
  id: "avoid-arguments-object",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow arguments object (use rest parameters instead).",
    fixable: false,
    category: "performance",
  },
  options,
  /**
   * Checks for references to the arguments object.
   *
   * @param graph - The SolidGraph to check
   * @param emit - Function to emit diagnostics
   */
  check(graph, emit) {
    const argumentsRefs = getIdentifierReferences(graph, "arguments")
    if (argumentsRefs.length === 0) return

    for (let i = 0, len = argumentsRefs.length; i < len; i++) {
      const ref = argumentsRefs[i]

      if (!ref) return;
      const fn = getContainingFunction(graph, ref)
      if (!fn) continue
      if (ts.isArrowFunction(fn.node)) continue

      const params = fn.params
      let isShadowed = false
      for (let j = 0, plen = params.length; j < plen; j++) {
        const param = params[j]
        if (!param) continue
        if (param.name === "arguments") {
          isShadowed = true
          break
        }
      }
      if (isShadowed) continue

      emit(
        createDiagnostic(
          graph.filePath,
          ref,
          graph.sourceFile,
          "avoid-arguments-object",
          "avoidArguments",
          messages.avoidArguments,
          "warn",
        ),
      )
    }
  },
})
