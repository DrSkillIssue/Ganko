/**
 * Flags [...iterable].sort().map().join() pipelines.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { getCallsByMethodName, getMethodChain } from "../../queries"

const messages = {
  spreadSortMapJoin:
    "Spread+sort+map+join pipeline allocates multiple intermediates. Prefer single-pass string construction on hot paths.",
} as const

const options = {}

export const avoidSpreadSortMapJoinPipeline = defineSolidRule({
  id: "avoid-spread-sort-map-join-pipeline",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow [...iterable].sort().map().join() pipelines on hot paths.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const joins = getCallsByMethodName(graph, "join")
    if (joins.length === 0) return

    for (let i = 0; i < joins.length; i++) {
      const join = joins[i]
      if (!join) return;
      const { methods, root } = getMethodChain(graph, join)
      if (methods.length < 3) continue

      const lastMethod = methods[methods.length - 1]
      if (lastMethod !== "join") continue

      const sortIndex = methods.indexOf("sort")
      if (sortIndex === -1) continue
      const mapIndex = methods.indexOf("map")
      if (mapIndex === -1) continue
      if (sortIndex > mapIndex) continue
      if (mapIndex >= methods.length - 1) continue

      if (!isSingleSpreadArray(root)) continue

      emit(
        createDiagnostic(
          graph.filePath,
          join.node,
          graph.sourceFile,
          "avoid-spread-sort-map-join-pipeline",
          "spreadSortMapJoin",
          messages.spreadSortMapJoin,
          "warn",
        ),
      )
    }
  },
})

function isSingleSpreadArray(root: ts.Node | null): boolean {
  if (!root || !ts.isArrayLiteralExpression(root)) return false
  if (root.elements.length !== 1) return false
  const first = root.elements[0]
  return first !== undefined && ts.isSpreadElement(first)
}
