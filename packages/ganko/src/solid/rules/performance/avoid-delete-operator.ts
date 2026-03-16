/**
 * Flags use of delete operator on object properties.
 * The delete operator transitions objects to "dictionary mode" in V8.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";

const messages = {
  avoidDelete: "delete operator transitions object to slow mode. Use `obj.prop = undefined` or destructuring instead.",
} as const

const options = {}

export const avoidDeleteOperator = defineSolidRule({
  id: "avoid-delete-operator",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow delete operator on objects (causes V8 deoptimization).",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const deleteExprs = graph.deleteExpressions
    if (deleteExprs.length === 0) return

    for (let i = 0, len = deleteExprs.length; i < len; i++) {
      const expr = deleteExprs[i];
      if (!expr) continue;
      const arg = expr.expression;
      if (!ts.isPropertyAccessExpression(arg) && !ts.isElementAccessExpression(arg)) continue;

      emit(
        createDiagnostic(graph.file, expr, graph.sourceFile, "avoid-delete-operator", "avoidDelete", messages.avoidDelete, "warn"),
      )
    }
  },
});
