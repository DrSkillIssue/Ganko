/**
 * Shared utilities for rule implementations.
 */
import ts from "typescript"
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree"
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
    return { range: [last.node.end, last.node.end], text: `, ${specifier}` }
  }

  const imports = getImports(graph)
  if (imports.length) {
    const firstImport = imports[0]
    if (!firstImport) return null
    return { range: [firstImport.node.getStart(), firstImport.node.getStart()], text: `import { ${specifier} } from "solid-js";\n` }
  }

  const text = graph.sourceFile.text
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
  signalElement: ts.Identifier
  setterName: string
  setterElement: ts.Identifier
  signalVariable: VariableEntity
  setterVariable: VariableEntity
  declarator: ts.VariableDeclaration
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
    if (!parent || !ts.isVariableDeclaration(parent)) continue

    const pattern = parent.name
    if (!ts.isArrayBindingPattern(pattern)) continue

    const elements = pattern.elements
    if (elements.length < 2) continue

    const signalElement = elements[0]
    const setterElement = elements[1]

    if (!signalElement || !ts.isBindingElement(signalElement) || !ts.isIdentifier(signalElement.name)) continue
    if (!setterElement || !ts.isBindingElement(setterElement) || !ts.isIdentifier(setterElement.name)) continue

    const signalId = signalElement.name
    const setterId = setterElement.name

    const signalVariable = getVariableByNameInScope(graph, signalId.text, call.scope)
    if (!signalVariable) continue

    const setterVariable = getVariableByNameInScope(graph, setterId.text, call.scope)
    if (!setterVariable) continue

    result.push({
      call,
      signalName: signalId.text,
      signalElement: signalId,
      setterName: setterId.text,
      setterElement: setterId,
      signalVariable,
      setterVariable,
      declarator: parent,
    })
  }

  return result
}

export function getFunctionBodyExpression(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | null {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    return fn.body
  }

  const body = fn.body
  if (!ts.isBlock(body)) return null

  for (let i = body.statements.length - 1; i >= 0; i--) {
    const stmt = body.statements[i]
    if (!stmt) continue
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      return stmt.expression
    }
  }

  return null
}

/**
 * Check if a node is a statement or declaration (analogous to ESTree type name
 * ending in "Statement" or "Declaration").
 */
function isStatementOrDeclaration(node: ts.Node): boolean {
  const k = node.kind;
  // Statement range: FirstStatement (243) to LastStatement (262)
  if (k >= ts.SyntaxKind.FirstStatement && k <= ts.SyntaxKind.LastStatement) return true;
  // Declaration kinds
  return ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isExportAssignment(node);
}

/** Cache: Node -> containing statement */
const containingStatementCache = new WeakMap<ts.Node, ts.Node | null>()

/**
 * Find the containing statement node by walking up the parent chain.
 *
 * A statement is identified by its type name ending in "Statement" or "Declaration".
 * Uses a WeakMap cache with path memoization to avoid repeated traversals.
 *
 * @param node - The AST node to find the containing statement for
 * @returns The containing statement, or null if not found
 */
export function getContainingStatement(node: ts.Node): ts.Node | null {
  const cached = containingStatementCache.get(node)
  if (cached !== undefined) return cached

  const path: ts.Node[] = []
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (isStatementOrDeclaration(n)) {
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
export function getStatementLineStart(sourceText: string, node: ts.Node): number {
  let start = node.getStart()

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
export function getStatementEndWithNewline(sourceText: string, node: ts.Node): number {
  const end = node.end

  if (sourceText[end] === "\n") {
    return end + 1
  }

  if (sourceText[end] === "\r" && sourceText[end + 1] === "\n") {
    return end + 2
  }

  return end
}
