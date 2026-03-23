import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getContainingFunction, iterateVariables } from "../../queries"
import { isLikelyStringParsingContext, isStringLikeVariable } from "./string-parsing-context"

const messages = {
  loopStringPlusEquals:
    "Repeated string `+=` in parsing loops creates avoidable allocations. Buffer chunks and join once.",
} as const

const options = {}

export const noLoopStringPlusEquals = defineSolidRule({
  id: "no-loop-string-plus-equals",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow repeated string += accumulation in parsing loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!isStringLikeVariable(graph, variable)) continue

      const byFunction = new Map<string, { count: number; node: ts.Node }>()
      for (let i = 0; i < variable.assignments.length; i++) {
        const assignment = variable.assignments[i]
        if (!assignment) continue;
        if (assignment.operator !== ts.SyntaxKind.PlusEqualsToken) continue
        if (!assignment.isInLoop) continue
        if (!isLikelyStringParsingContext(graph, assignment.node)) continue

        const fn = getContainingFunction(graph, assignment.node)
        const key = fn ? `fn:${fn.id}` : "<module>"
        const existing = byFunction.get(key)
        if (!existing) {
          byFunction.set(key, { count: 1, node: assignment.node })
          continue
        }
        existing.count++
      }

      for (const [, entry] of byFunction) {
        if (entry.count < 2) continue
        emit(
          createDiagnostic(
            graph.filePath,
            entry.node,
            graph.sourceFile,
            "no-loop-string-plus-equals",
            "loopStringPlusEquals",
            messages.loopStringPlusEquals,
            "warn",
          ),
        )
      }
    }
  },
})
