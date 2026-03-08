/**
 * Shared utilities for rule implementations.
 */
import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../impl"
import type { FixOperation } from "../../diagnostic"
import type { CallEntity, VariableEntity } from "../entities"
import { hasImportSpecifier, getImportsBySource, getImports, getVariableByNameInScope } from "../queries"

/**
 * Build fix to add import specifier to solid-js.
 * Returns null if specifier already imported.
 */
export function buildSolidImportFix(graph: SolidGraph, specifier: string): FixOperation | null {
  if (hasImportSpecifier(graph, "solid-js", specifier)) return null

  const solidImport = getImportsBySource(graph, "solid-js")[0]
  const specifiers = solidImport?.specifiers
  if (specifiers?.length) {
    const last = specifiers[specifiers.length - 1]
    if (!last) return null
    return { range: [last.node.range[1], last.node.range[1]], text: `, ${specifier}` }
  }

  const imports = getImports(graph)
  if (imports.length) {
    const firstImport = imports[0]
    if (!firstImport) return null
    return { range: [firstImport.node.range[0], firstImport.node.range[0]], text: `import { ${specifier} } from "solid-js";\n` }
  }

  const text = graph.sourceCode.text
  return { range: [0, 0], text: `import { ${specifier} } from "solid-js";\n${text.length > 0 && text.charCodeAt(0) !== 10 ? "\n" : ""}` }
}

/**
 * Result of extracting a createSignal array destructuring.
 *
 * Represents: `const [signalName, setterName] = createSignal(...)`
 */
export interface SignalDestructure {
  call: CallEntity
  signalName: string
  signalElement: T.Identifier
  setterName: string
  setterElement: T.Identifier
  signalVariable: VariableEntity
  setterVariable: VariableEntity
  declarator: T.VariableDeclarator
}

/**
 * Extract signal destructures from createSignal calls.
 *
 * For each call matching `const [value, setValue] = createSignal(...)`,
 * extracts both the signal and setter identifiers with their resolved variables.
 *
 * @param signalCalls - All createSignal calls from the graph
 * @param graph - The program graph for variable lookup
 * @returns Array of successfully resolved signal destructures
 */
export function extractSignalDestructures(
  signalCalls: readonly CallEntity[],
  graph: SolidGraph,
): SignalDestructure[] {
  const result: SignalDestructure[] = []

  for (let i = 0, len = signalCalls.length; i < len; i++) {
    const call = signalCalls[i]
    if (!call) continue

    const parent = call.node.parent
    if (parent?.type !== "VariableDeclarator") continue

    const pattern = parent.id
    if (pattern.type !== "ArrayPattern") continue

    const elements = pattern.elements
    if (elements.length < 2) continue

    const signalElement = elements[0]
    const setterElement = elements[1]

    if (!signalElement || signalElement.type !== "Identifier") continue
    if (!setterElement || setterElement.type !== "Identifier") continue

    const signalVariable = getVariableByNameInScope(graph, signalElement.name, call.scope)
    if (!signalVariable) continue

    const setterVariable = getVariableByNameInScope(graph, setterElement.name, call.scope)
    if (!setterVariable) continue

    result.push({
      call,
      signalName: signalElement.name,
      signalElement,
      setterName: setterElement.name,
      setterElement,
      signalVariable,
      setterVariable,
      declarator: parent,
    })
  }

  return result
}

/** Cache: Node -> containing statement */
const containingStatementCache = new WeakMap<T.Node, T.Node | null>()

/**
 * Find the containing statement node by walking up the parent chain.
 *
 * A statement is identified by its type name ending in "Statement" or "Declaration".
 * Uses a WeakMap cache with path memoization to avoid repeated traversals.
 *
 * @param node - The AST node to find the containing statement for
 * @returns The containing statement, or null if not found
 */
export function getContainingStatement(node: T.Node): T.Node | null {
  const cached = containingStatementCache.get(node)
  if (cached !== undefined) return cached

  const path: T.Node[] = []
  for (let n: T.Node | undefined = node; n; n = n.parent) {
    if (n.type.endsWith("Statement") || n.type.endsWith("Declaration")) {
      containingStatementCache.set(node, n)
      for (let i = 0, len = path.length; i < len; i++) {
        const pathNode = path[i]
        if (!pathNode) continue
        containingStatementCache.set(pathNode, n)
      }
      return n
    }
    path.push(n)
  }

  containingStatementCache.set(node, null)
  for (let i = 0, len = path.length; i < len; i++) {
    const pathNode = path[i]
    if (!pathNode) continue
    containingStatementCache.set(pathNode, null)
  }
  return null
}

/**
 * Get the start position of the line containing a node.
 *
 * Walks backward from the node to include all leading whitespace
 * but stops before the newline (for clean multi-line removal).
 *
 * @param sourceText - The full source text
 * @param node - The node to find the line start for
 * @returns Character position at the start of the line (after newline)
 */
export function getStatementLineStart(sourceText: string, node: T.Node): number {
  let start = node.range[0]

  while (start > 0) {
    const prevChar = sourceText[start - 1]
    if (prevChar === " " || prevChar === "\t") {
      start--
    } else {
      break
    }
  }

  return start
}

/**
 * Get the end position of a node, including trailing newline if present.
 *
 * When removing statements, we want to include the newline that follows
 * to avoid leaving blank lines. Handles both Unix (\n) and Windows (\r\n).
 *
 * @param sourceText - The full source text
 * @param node - The node to find the end for
 * @returns Character position after the node and its trailing newline
 */
export function getStatementEndWithNewline(sourceText: string, node: T.Node): number {
  const end = node.range[1]

  if (sourceText[end] === "\n") {
    return end + 1
  }

  if (sourceText[end] === "\r" && sourceText[end + 1] === "\n") {
    return end + 2
  }

  return end
}
