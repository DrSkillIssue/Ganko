/**
 * Flags nested for-loops where both iterate the same collection variable
 * and compare elements, creating O(n²) pair comparison.
 * Suggests grouping by key first.
 */

import ts from "typescript"
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
function forLoopIndex(node: ts.ForStatement): string | null {
  const init = node.initializer
  if (!init) return null
  if (!ts.isVariableDeclarationList(init)) return null
  if (init.declarations.length !== 1) return null
  const decl = init.declarations[0]
  if (!decl) return null
  if (!ts.isIdentifier(decl.name)) return null
  return decl.name.text
}

/**
 * Checks if a for-loop's test bounds against the outer's index variable
 * (j < i pattern) or the same collection's .length.
 */
function boundsAgainst(inner: ts.ForStatement, outerIndex: string, collection: string): boolean {
  const test = inner.condition
  if (!test) return false
  if (!ts.isBinaryExpression(test)) return false
  if (test.operatorToken.kind !== ts.SyntaxKind.LessThanToken && test.operatorToken.kind !== ts.SyntaxKind.LessThanEqualsToken) return false

  const right = test.right
  if (ts.isIdentifier(right) && right.text === outerIndex) return true

  if (
    ts.isPropertyAccessExpression(right) &&
    right.name.text === "length" &&
    ts.isIdentifier(right.expression) &&
    right.expression.text === collection
  ) {
    return true
  }

  return false
}

interface IndexedRead {
  readonly forLoop: ts.ForStatement
  readonly indexName: string
  readonly readNode: ts.ElementAccessExpression
  readonly comparison: ts.BinaryExpression
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

        const index = readNode.argumentExpression
        if (!ts.isIdentifier(index)) continue

        const forLoop = loopForIndexReference(graph, index)
        if (!forLoop) continue

        const loopIndex = forLoopIndex(forLoop)
        if (!loopIndex || loopIndex !== index.text) continue

        const comparison = comparisonForIndexedRead(readNode)
        if (!comparison) continue

        const fn = getContainingFunction(graph, forLoop)
        indexed.push({
          forLoop,
          indexName: index.text,
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

          const raStart = ra.forLoop.getStart()
          const raEnd = ra.forLoop.end
          const rbStart = rb.forLoop.getStart()
          const rbEnd = rb.forLoop.end

          if (rbStart >= raStart && rbEnd <= raEnd) {
            outer = ra
            inner = rb
          } else if (raStart >= rbStart && raEnd <= rbEnd) {
            outer = rb
            inner = ra
          } else {
            continue
          }

          if (!boundsAgainst(inner.forLoop, outer.indexName, variable.name)) continue
          if (!outer.isInConditional || !inner.isInConditional) continue
          if (outer.comparison !== inner.comparison) continue

          const outerStart = outer.forLoop.getStart()
          const innerStart = inner.forLoop.getStart()
          const key = `${outerStart}:${innerStart}:${variable.id}`
          if (reported.has(key)) continue
          reported.add(key)

          emit(
            createDiagnostic(
              graph.file,
              inner.forLoop,
              graph.sourceFile,
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

function asIndexedRead(node: ts.Node): ts.ElementAccessExpression | null {
  const parent = node.parent
  if (!parent || !ts.isElementAccessExpression(parent)) return null
  if (parent.expression !== node) return null
  return parent
}

function loopForIndexReference(
  graph: SolidGraph,
  index: ts.Identifier,
): ts.ForStatement | null {
  const scope = getScopeFor(graph, index)
  const variable = getVariableByNameInScope(graph, index.text, scope)
  if (!variable) return null

  for (let i = 0; i < variable.declarations.length; i++) {
    const declaration = variable.declarations[i]
    if (!declaration) continue;
    if (!ts.isIdentifier(declaration)) continue
    const declarator = declaration.parent
    if (!declarator || !ts.isVariableDeclaration(declarator)) continue
    const variableDeclarationList = declarator.parent
    if (!variableDeclarationList || !ts.isVariableDeclarationList(variableDeclarationList)) continue
    const maybeFor = variableDeclarationList.parent
    if (!maybeFor || !ts.isForStatement(maybeFor)) continue
    if (maybeFor.initializer !== variableDeclarationList) continue
    return maybeFor
  }

  return null
}

function comparisonForIndexedRead(node: ts.ElementAccessExpression): ts.BinaryExpression | null {
  const parent = node.parent
  if (!parent) return null

  const direct = asComparison(parent)
  if (direct) return direct

  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) return null
  const wrapped = skipTransparentWrappers(parent.parent, 3)
  if (!wrapped) return null
  return asComparison(wrapped)
}

function skipTransparentWrappers(node: ts.Node | undefined, remaining: number): ts.Node | null {
  if (!node) return null
  if (remaining <= 0) return node
  if (!isTypeWrapper(node)) return node
  return skipTransparentWrappers(node.parent, remaining - 1)
}

function isTypeWrapper(node: ts.Node): boolean {
  return (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
}

function asComparison(node: ts.Node): ts.BinaryExpression | null {
  if (!ts.isBinaryExpression(node)) return null
  if (!COMPARISON_OPERATORS.has(node.operatorToken.getText())) return null
  return node
}
