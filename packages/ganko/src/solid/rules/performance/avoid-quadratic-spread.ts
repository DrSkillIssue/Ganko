/**
 * Flags spreading accumulator in reduce callbacks which creates O(n²) complexity.
 */

import { defineSolidRule } from "../../rule";
import { getCallsByMethodName, getScopeFor, getVariableByNameInScope } from "../../queries";
import { createDiagnostic } from "../../../diagnostic";

const messages = {
  quadraticSpread: "Spreading accumulator in reduce creates O(n²) complexity. Use push() instead.",
} as const;

const options = {};

export const avoidQuadraticSpread = defineSolidRule({
  id: "avoid-quadratic-spread",
  severity: "error",
  messages,
  meta: {
    description: "Disallow spreading accumulator in reduce callbacks (O(n²) complexity).",
    fixable: false,
    category: "performance",
  },
  options,

  /**
   * Checks for spread of accumulator parameter inside reduce callbacks.
   *
   * @param graph - The SolidGraph to check
   * @param emit - Function to emit diagnostics
   */
  check(graph, emit) {
    const reduceCalls = getCallsByMethodName(graph, "reduce");
    if (reduceCalls.length === 0) return;

    for (let i = 0, rlen = reduceCalls.length; i < rlen; i++) {
      const call = reduceCalls[i];
      if (!call) continue;
      const args = call.node.arguments;
      if (args.length === 0) continue;

      const callback = args[0];
      if (!callback) continue;
      if (callback.type !== "ArrowFunctionExpression" &&
          callback.type !== "FunctionExpression") continue;

      const params = callback.params;
      if (params.length === 0) continue;

      const accParam = params[0];
      if (!accParam) continue;
      if (accParam.type !== "Identifier") continue;
      const callbackScope = getScopeFor(graph, callback);
      const accVar = getVariableByNameInScope(graph, accParam.name, callbackScope);
      if (!accVar) continue;

      for (let j = 0, rlen2 = accVar.reads.length; j < rlen2; j++) {
        const read = accVar.reads[j];
        if (!read) continue;
        const parent = read.node.parent;
        if (!parent || parent.type !== "SpreadElement") continue;
        if (parent.argument !== read.node) continue;

        emit(
          createDiagnostic(graph.file, parent, "avoid-quadratic-spread", "quadraticSpread", messages.quadraticSpread, "error"),
        );
        break;
      }
    }
  },
});
