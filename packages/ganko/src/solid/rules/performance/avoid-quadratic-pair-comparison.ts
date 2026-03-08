/**
 * Flags nested for-loops where both iterate the same collection variable
 * and compare elements, creating O(n²) pair comparison.
 * Suggests grouping by key first.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getContainingFunction, getScopeFor, getVariableByNameInScope, iterateVariables } from "../../queries"
import { COMPARISON_OPERATORS } from "../../util"

const messages = {
  quadraticPair:
    "Nested loops over `{{collection}}` create O(n²) pair comparison. Group by a key property first.",
} as const

const options = {}

/**
 * Extracts the index variable name from a for-loop's init clause.
 * Recognizes: for (let i = 0; ...)
 */
function forLoopIndex(node: T.ForStatement): string | null {
  const init = node.init
  if (!init) return null
  if (init.type !== "VariableDeclaration") return null
  if (init.declarations.length !== 1) return null
  const decl = init.declarations[0]
  if (!decl) return null
  if (decl.id.type !== "Identifier") return null
  return decl.id.name
}

/**
 * Checks if a for-loop's test bounds against the outer's index variable
 * (j < i pattern) or the same collection's .length.
 */
function boundsAgainst(inner: T.ForStatement, outerIndex: string, collection: string): boolean {
  const test = inner.test
  if (!test) return false
  if (test.type !== "BinaryExpression") return false
  if (test.operator !== "<" && test.operator !== "<=") return false

  const right = test.right
  if (right.type === "Identifier" && right.name === outerIndex) return true

  if (
    right.type === "MemberExpression" &&
    right.property.type === "Identifier" &&
    right.property.name === "length" &&
    right.object.type === "Identifier" &&
    right.object.name === collection
  ) {
    return true
  }

  return false
}

interface IndexedRead {
  readonly forLoop: T.ForStatement
  readonly indexName: string
  readonly readNode: T.MemberExpression
  readonly comparison: T.BinaryExpression
  readonly functionId: number
  readonly isInConditional: boolean
}

export const avoidQuadraticPairComparison = defineSolidRule({
  id: "avoid-quadratic-pair-comparison",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow nested for-loops over the same collection creating O(n²) pair comparison.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const reported = new Set<string>()

    for (const variable of iterateVariables(graph)) {
      const reads = variable.reads
      if (reads.length < 2) continue

      const indexed: IndexedRead[] = []

      for (let i = 0, len = reads.length; i < len; i++) {
        const read = reads[i]
        if (!read) continue;
        const readNode = asIndexedRead(read.node)
        if (!readNode) continue

        const index = readNode.property
        if (index.type !== "Identifier") continue

        const forLoop = loopForIndexReference(graph, index)
        if (!forLoop) continue

        const loopIndex = forLoopIndex(forLoop)
        if (!loopIndex || loopIndex !== index.name) continue

        const comparison = comparisonForIndexedRead(readNode)
        if (!comparison) continue

        const fn = getContainingFunction(graph, forLoop)
        indexed.push({
          forLoop,
          indexName: index.name,
          readNode,
          comparison,
          functionId: fn?.id ?? -1,
          isInConditional: read.isInConditional,
        })
      }

      if (indexed.length < 2) continue

      for (let a = 0; a < indexed.length; a++) {
        for (let b = a + 1; b < indexed.length; b++) {
          const ra = indexed[a]
          if (!ra) continue;
          const rb = indexed[b]
          if (!rb) continue;
          if (ra.forLoop === rb.forLoop) continue
          if (ra.indexName === rb.indexName) continue
          if (ra.functionId !== rb.functionId) continue

          let outer: IndexedRead
          let inner: IndexedRead

          if (isRangeInside(rb.forLoop.range, ra.forLoop.range)) {
            outer = ra
            inner = rb
          } else if (isRangeInside(ra.forLoop.range, rb.forLoop.range)) {
            outer = rb
            inner = ra
          } else {
            continue
          }

          if (!boundsAgainst(inner.forLoop, outer.indexName, variable.name)) continue
          if (!outer.isInConditional || !inner.isInConditional) continue
          if (outer.comparison !== inner.comparison) continue

          const key = `${outer.forLoop.range[0]}:${inner.forLoop.range[0]}:${variable.id}`
          if (reported.has(key)) continue
          reported.add(key)

          emit(
            createDiagnostic(
              graph.file,
              inner.forLoop,
              "avoid-quadratic-pair-comparison",
              "quadraticPair",
              resolveMessage(messages.quadraticPair, { collection: variable.name }),
              "warn",
            ),
          )
        }
      }
    }
  },
})

function asIndexedRead(node: T.Node): T.MemberExpression | null {
  const parent = node.parent
  if (!parent || parent.type !== "MemberExpression") return null
  if (!parent.computed) return null
  if (parent.object !== node) return null
  return parent
}

function loopForIndexReference(
  graph: SolidGraph,
  index: T.Identifier,
): T.ForStatement | null {
  const scope = getScopeFor(graph, index)
  const variable = getVariableByNameInScope(graph, index.name, scope)
  if (!variable) return null

  for (let i = 0; i < variable.declarations.length; i++) {
    const declaration = variable.declarations[i]
    if (!declaration) continue;
    if (declaration.type !== "Identifier") continue
    const declarator = declaration.parent
    if (!declarator || declarator.type !== "VariableDeclarator") continue
    const variableDeclaration = declarator.parent
    if (!variableDeclaration || variableDeclaration.type !== "VariableDeclaration") continue
    const maybeFor = variableDeclaration.parent
    if (!maybeFor || maybeFor.type !== "ForStatement") continue
    if (maybeFor.init !== variableDeclaration) continue
    return maybeFor
  }

  return null
}

function comparisonForIndexedRead(node: T.MemberExpression): T.BinaryExpression | null {
  const parent = node.parent
  if (!parent) return null

  const direct = asComparison(parent)
  if (direct) return direct

  if (parent.type !== "MemberExpression" || parent.object !== node) return null
  const wrapped = skipTransparentWrappers(parent.parent, 3)
  if (!wrapped) return null
  return asComparison(wrapped)
}

function skipTransparentWrappers(node: T.Node | undefined, remaining: number): T.Node | null {
  if (!node) return null
  if (remaining <= 0) return node
  if (!isTypeWrapper(node)) return node
  return skipTransparentWrappers(node.parent, remaining - 1)
}

function isTypeWrapper(node: T.Node): boolean {
  return (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression"
  )
}

function asComparison(node: T.Node): T.BinaryExpression | null {
  if (node.type !== "BinaryExpression") return null
  if (!COMPARISON_OPERATORS.has(node.operator)) return null
  return node
}

function isRangeInside(inner: readonly [number, number], outer: readonly [number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] <= outer[1]
}
