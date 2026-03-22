/**
 * Flags closures created inside loops that capture loop variables.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";
import { isInLoop } from "../../util";

const messages = {
  closureInLoop: "Function created inside loop allocates new closure per iteration. Consider hoisting or using event delegation.",
} as const

const options = {}

export const avoidFunctionAllocationInHotLoop = defineSolidRule({
  id: "avoid-function-allocation-in-hot-loop",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow creating closures inside loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const fn of graph.functions) {
      const fnNode = fn.node;

      // Skip named function declarations - they're hoisted
      if (ts.isFunctionDeclaration(fnNode)) continue;

      // Must be inside a loop
      if (!isInLoop(fnNode)) continue;

      // Must capture variables
      const captures = fn.captures;
      if (captures.length === 0) continue;

      // Check if any captured variable has reads inside a loop
      let capturesLoopVariable = false;
      for (let i = 0, clen = captures.length; i < clen; i++) {
        const capture = captures[i];
        if (!capture) continue;
        const reads = capture.reads;
        for (let j = 0, rlen = reads.length; j < rlen; j++) {
          const read = reads[j];
          if (!read) continue;
          if (read.isInLoop) {
            capturesLoopVariable = true;
            break;
          }
        }
        if (capturesLoopVariable) break;
      }

      if (!capturesLoopVariable) continue;

      emit(
        createDiagnostic(graph.filePath, fnNode, graph.sourceFile, "avoid-function-allocation-in-hot-loop", "closureInLoop", messages.closureInLoop, "warn"),
      )
    }
  },
});

