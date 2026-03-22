/**
 * Scopes Phase (Phase 2)
 *
 * Creates scope and variable entities by walking the TypeScript AST.
 * Replaces the previous ESLint ScopeManager-based implementation with
 * a native ts.forEachChild walk that creates ScopeEntity at function/block
 * boundaries and VariableEntity from declarations using the TypeChecker.
 *
 * Architecture per PHASE_1.md:
 * - Single-pass ts.forEachChild walk maintaining a scope stack
 * - Scope boundaries: SourceFile, function-like, block, class
 * - Variable declarations from var/let/const, function decls, class decls,
 *   import decls, parameters, catch clause vars
 * - Hoisting: var/function → nearest function/module scope; let/const/class → block scope
 * - Read/write reference classification via checker.getSymbolAtLocation
 */
import ts from "typescript"
import type { SolidBuildContext } from "../impl"
import type { SolidInput } from "../input"
import type { ScopeEntity } from "../entities/scope"
import type { VariableEntity } from "../entities/variable"
import type { FileEntity } from "../entities/file"
import { UNKNOWN_CONTEXT, createScope, buildScopeChain } from "../entities/scope"
import { createVariable } from "../entities/variable"
import { isInLoop, isInConditional } from "../util/expression"

/** Map from ts.Symbol to VariableEntity for read/write classification */
type SymbolVarMap = Map<ts.Symbol, VariableEntity>

export function runScopesPhase(graph: SolidBuildContext, input: SolidInput): void {
  const file = graph.fileEntity
  const sourceFile = input.sourceFile
  const checker = input.checker
  const symbolVarMap: SymbolVarMap = new Map()

  // Create program scope for the source file
  const programScope = createScope({
    id: graph.nextScopeId(),
    node: sourceFile,
    file,
    kind: "program",
    parent: null,
    trackingContext: null,
    resolvedContext: UNKNOWN_CONTEXT,
  })
  buildScopeChain(programScope)
  graph.addScope(programScope)
  graph.scopeForCache.set(sourceFile, programScope)

  // Pass 1: Walk the AST creating scopes and variables
  walkNode(sourceFile, programScope, programScope, graph, file, checker, symbolVarMap)

  // Pass 2: Classify identifier references as reads or writes
  classifyReferences(sourceFile, graph, checker, symbolVarMap, programScope)
}

/**
 * Finds the nearest function or module scope for hoisting var/function declarations.
 */
function getNearestFunctionScope(scope: ScopeEntity): ScopeEntity {
  let s: ScopeEntity | null = scope
  while (s !== null) {
    if (s.kind === "function" || s.kind === "program") return s
    s = s.parent
  }
  return scope // fallback
}

/**
 * Registers a variable in the given scope and the graph.
 */
function registerVariable(
  variable: VariableEntity,
  scope: ScopeEntity,
  graph: SolidBuildContext,
): void {
  graph.addVariable(variable)
  scope.variables.push(variable)
  if (scope._variablesByName === null) {
    scope._variablesByName = new Map()
  }
  scope._variablesByName.set(variable.name, variable)
}

/**
 * Links a variable to its ts.Symbol for later read/write classification.
 */
function linkSymbol(
  nameNode: ts.Node,
  variable: VariableEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  const sym = checker.getSymbolAtLocation(nameNode)
  if (sym) symbolVarMap.set(sym, variable)
}

/**
 * Determines the scope kind for a given TypeScript node.
 */
function getScopeKind(node: ts.Node): "function" | "block" | null {
  if (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) {
    return "function"
  }
  // Block creates a scope only when NOT a direct function body
  // (function bodies share the function scope)
  if (ts.isBlock(node)) {
    const parent = node.parent
    if (parent && (
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isConstructorDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)
    )) {
      return null // function body shares the function scope
    }
    return "block"
  }
  if (ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isCaseBlock(node) ||
      ts.isCatchClause(node)) {
    return "block"
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return "block"
  }
  return null
}

/**
 * Checks if a variable declaration uses var (hoisted) vs let/const (block-scoped).
 */
function isVarDeclaration(node: ts.VariableDeclaration): boolean {
  const declList = node.parent
  if (!ts.isVariableDeclarationList(declList)) return false
  return (declList.flags & ts.NodeFlags.Let) === 0 &&
         (declList.flags & ts.NodeFlags.Const) === 0
}

/**
 * Recursively walks the AST, creating scopes at boundaries
 * and collecting variable declarations within each scope.
 */
function walkNode(
  node: ts.Node,
  currentScope: ScopeEntity,
  currentFunctionScope: ScopeEntity,
  graph: SolidBuildContext,
  file: FileEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  let activeScope = currentScope
  let activeFunctionScope = currentFunctionScope

  const scopeKind = getScopeKind(node)
  if (scopeKind !== null) {
    const newScope = createScope({
      id: graph.nextScopeId(),
      node: node,
      file,
      kind: scopeKind,
      parent: currentScope,
      trackingContext: null,
      resolvedContext: currentScope._resolvedContext ?? UNKNOWN_CONTEXT,
    })
    buildScopeChain(newScope)
    graph.addScope(newScope)
    graph.scopeForCache.set(node, newScope)
    currentScope.children.push(newScope)
    activeScope = newScope

    if (scopeKind === "function") {
      activeFunctionScope = newScope
      // Collect function parameters
      collectFunctionParameters(node, newScope, graph, file, checker, symbolVarMap)
    }
  }

  // Variable declarations (var/let/const)
  if (ts.isVariableDeclaration(node)) {
    const targetScope = isVarDeclaration(node) ? getNearestFunctionScope(activeScope) : activeScope
    collectVariableDeclaration(node, targetScope, graph, file, checker, symbolVarMap)
  }

  // Function declarations — hoisted to nearest function/module scope
  if (ts.isFunctionDeclaration(node) && node.name) {
    const targetScope = getNearestFunctionScope(currentScope) // parent's function scope, not the new one
    const variable = createVariable({
      id: graph.nextVariableId(),
      name: node.name.text,
      file,
      scope: targetScope,
      declarations: [node.name],
    })
    registerVariable(variable, targetScope, graph)
    linkSymbol(node.name, variable, checker, symbolVarMap)
  }

  // Class declarations — block-scoped
  if (ts.isClassDeclaration(node) && node.name) {
    const variable = createVariable({
      id: graph.nextVariableId(),
      name: node.name.text,
      file,
      scope: currentScope, // block-scoped, registered in parent scope
      declarations: [node.name],
    })
    registerVariable(variable, currentScope, graph)
    linkSymbol(node.name, variable, checker, symbolVarMap)
  }

  // Import declarations
  if (ts.isImportDeclaration(node) && node.importClause) {
    collectImportDeclaration(node, activeScope, graph, file, checker, symbolVarMap)
  }

  // Catch clause variable
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    const catchVarName = node.variableDeclaration.name
    if (ts.isIdentifier(catchVarName)) {
      const variable = createVariable({
        id: graph.nextVariableId(),
        name: catchVarName.text,
        file,
        scope: activeScope,
        declarations: [catchVarName],
      })
      registerVariable(variable, activeScope, graph)
      linkSymbol(catchVarName, variable, checker, symbolVarMap)
    } else if (ts.isObjectBindingPattern(catchVarName) || ts.isArrayBindingPattern(catchVarName)) {
      collectDestructuredBindings(catchVarName, activeScope, graph, file, checker, symbolVarMap)
    }
  }

  // Walk children
  ts.forEachChild(node, (child) => walkNode(child, activeScope, activeFunctionScope, graph, file, checker, symbolVarMap))
}

/**
 * Collects a variable declaration (handles simple identifiers and destructuring).
 */
function collectVariableDeclaration(
  node: ts.VariableDeclaration,
  targetScope: ScopeEntity,
  graph: SolidBuildContext,
  file: FileEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  const nameNode = node.name
  if (ts.isIdentifier(nameNode)) {
    const variable = createVariable({
      id: graph.nextVariableId(),
      name: nameNode.text,
      file,
      scope: targetScope,
      declarations: [nameNode],
      initializer: node.initializer ?? null,
    })
    registerVariable(variable, targetScope, graph)
    linkSymbol(nameNode, variable, checker, symbolVarMap)
  } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    collectDestructuredBindings(nameNode, targetScope, graph, file, checker, symbolVarMap)
  }
}

/**
 * Collects function parameters as variable entities in the function scope.
 */
function collectFunctionParameters(
  node: ts.Node,
  scope: ScopeEntity,
  graph: SolidBuildContext,
  file: FileEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  if (!ts.isFunctionLike(node)) return

  const params = node.parameters
  for (let i = 0, len = params.length; i < len; i++) {
    const param = params[i]
    if (!param) continue
    const paramName = param.name

    if (ts.isIdentifier(paramName)) {
      const variable = createVariable({
        id: graph.nextVariableId(),
        name: paramName.text,
        file,
        scope,
        declarations: [paramName],
      })
      registerVariable(variable, scope, graph)
      linkSymbol(paramName, variable, checker, symbolVarMap)
    } else if (ts.isObjectBindingPattern(paramName) || ts.isArrayBindingPattern(paramName)) {
      collectDestructuredBindings(paramName, scope, graph, file, checker, symbolVarMap)
    }
  }
}

/**
 * Collects variable entities from destructuring patterns.
 */
function collectDestructuredBindings(
  pattern: ts.BindingPattern | ts.BindingName,
  scope: ScopeEntity,
  graph: SolidBuildContext,
  file: FileEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  if (ts.isIdentifier(pattern)) {
    const declNode = getEnclosingVariableDeclaration(pattern)
    const variable = createVariable({
      id: graph.nextVariableId(),
      name: pattern.text,
      file,
      scope,
      declarations: [pattern],
      initializer: declNode?.initializer ?? null,
    })
    registerVariable(variable, scope, graph)
    linkSymbol(pattern, variable, checker, symbolVarMap)
    return
  }

  if (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) {
    for (let i = 0; i < pattern.elements.length; i++) {
      const element = pattern.elements[i]
      if (!element) continue
      if (ts.isBindingElement(element)) {
        collectDestructuredBindings(element.name, scope, graph, file, checker, symbolVarMap)
      }
    }
  }
}

/**
 * Collects import declarations as module-scoped variables.
 */
function collectImportDeclaration(
  node: ts.ImportDeclaration,
  scope: ScopeEntity,
  graph: SolidBuildContext,
  file: FileEntity,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
): void {
  const clause = node.importClause
  if (!clause) return

  // Default import: import Foo from "mod"
  if (clause.name) {
    const variable = createVariable({
      id: graph.nextVariableId(),
      name: clause.name.text,
      file,
      scope,
      declarations: [clause.name],
    })
    registerVariable(variable, scope, graph)
    linkSymbol(clause.name, variable, checker, symbolVarMap)
  }

  // Named/namespace imports
  const bindings = clause.namedBindings
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) {
      // import * as Ns from "mod"
      const variable = createVariable({
        id: graph.nextVariableId(),
        name: bindings.name.text,
        file,
        scope,
        declarations: [bindings.name],
      })
      registerVariable(variable, scope, graph)
      linkSymbol(bindings.name, variable, checker, symbolVarMap)
    } else if (ts.isNamedImports(bindings)) {
      // import { a, b as c } from "mod"
      for (let i = 0; i < bindings.elements.length; i++) {
        const spec = bindings.elements[i]
        if (!spec) continue
        // Skip type-only imports
        if (spec.isTypeOnly) continue
        const variable = createVariable({
          id: graph.nextVariableId(),
          name: spec.name.text,
          file,
          scope,
          declarations: [spec.name],
        })
        registerVariable(variable, scope, graph)
        linkSymbol(spec.name, variable, checker, symbolVarMap)
      }
    }
  }
}

/**
 * Pass 2: Classify all identifier references as reads or writes.
 *
 * Walks the entire AST. For each ts.Identifier, resolves its symbol
 * via checker.getSymbolAtLocation. If the symbol matches a known
 * VariableEntity, classifies the reference as read or write based
 * on the parent node context.
 */
function classifyReferences(
  sourceFile: ts.SourceFile,
  graph: SolidBuildContext,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
  programScope: ScopeEntity,
): void {
  if (symbolVarMap.size === 0) return

  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      classifyIdentifier(node, graph, checker, symbolVarMap, programScope)
    }
    ts.forEachChild(node, walk)
  }
  ts.forEachChild(sourceFile, walk)
}

/**
 * Classifies a single identifier as a read or write reference.
 */
function classifyIdentifier(
  id: ts.Identifier,
  graph: SolidBuildContext,
  checker: ts.TypeChecker,
  symbolVarMap: SymbolVarMap,
  programScope: ScopeEntity,
): void {
  // Skip identifiers that are declarations themselves
  if (isDeclarationName(id)) return
  // Skip property names in property access (foo.bar — bar is not a reference)
  if (isPropertyAccessName(id)) return
  // Skip property names in object literals
  if (isObjectPropertyName(id)) return
  // Skip import specifier names
  if (isImportName(id)) return
  // Skip type-only positions
  if (isInTypePosition(id)) return

  const sym = checker.getSymbolAtLocation(id)
  if (!sym) return

  // Resolve aliased symbols (imports)
  let resolvedSym = sym
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      resolvedSym = checker.getAliasedSymbol(sym)
    } catch {
      // getAliasedSymbol can throw for unresolvable symbols
    }
  }

  // For shorthand property assignments `{ foo }`, getSymbolAtLocation
  // returns the *property* symbol, not the variable symbol. Resolve the
  // value symbol so the variable reference is correctly tracked.
  const idParent = id.parent
  if (idParent && ts.isShorthandPropertyAssignment(idParent) && idParent.name === id) {
    const valueSym = checker.getShorthandAssignmentValueSymbol(idParent)
    if (valueSym) resolvedSym = valueSym
  }

  // Check both original and resolved symbols
  const variable = symbolVarMap.get(sym) ?? symbolVarMap.get(resolvedSym)
  if (!variable) return

  const parent = id.parent
  const inLoop = isInLoop(id)
  const inCond = isInConditional(id)

  if (isWriteReference(id, parent)) {
    // Write reference
    const assignmentValue = getAssignmentValue(parent)
    const operator = getAssignmentOperator(parent)
    const assignment = {
      id: variable.assignments.length,
      node: parent,
      value: assignmentValue ?? id,
      operator,
      isInLoop: inLoop,
      isInConditional: inCond,
    }
    variable.assignments.push(assignment)
  } else {
    // Read reference
    const scope = findScopeForNode(id, graph, programScope)
    const read = {
      id: variable.reads.length,
      node: id,
      scope,
      isProperAccess: isProperAccess(id),
      isInLoop: inLoop,
      isInConditional: inCond,
    }
    variable.reads.push(read)
  }
}

/**
 * Checks if an identifier is a declaration name (being declared, not referenced).
 */
function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent
  if (!parent) return false

  // Variable declaration: const x = ...
  if (ts.isVariableDeclaration(parent) && parent.name === id) return true
  // Function declaration: function x() {}
  if (ts.isFunctionDeclaration(parent) && parent.name === id) return true
  // Class declaration: class X {}
  if (ts.isClassDeclaration(parent) && parent.name === id) return true
  // Parameter: (x) => ...
  if (ts.isParameter(parent) && parent.name === id) return true
  // Binding element: const { x } = ...
  if (ts.isBindingElement(parent) && parent.name === id) return true
  // Import specifier: import { x } from ...
  if (ts.isImportSpecifier(parent) && parent.name === id) return true
  // Import clause (default): import x from ...
  if (ts.isImportClause(parent) && parent.name === id) return true
  // Namespace import: import * as x from ...
  if (ts.isNamespaceImport(parent) && parent.name === id) return true
  // Catch clause variable
  if (ts.isCatchClause(parent) && parent.variableDeclaration?.name === id) return true
  // Function expression name: const x = function y() {} — y is a declaration
  if (ts.isFunctionExpression(parent) && parent.name === id) return true
  // Class expression name
  if (ts.isClassExpression(parent) && parent.name === id) return true
  // Enum declaration
  if (ts.isEnumDeclaration(parent) && parent.name === id) return true
  // Type alias, interface (type-only, but guard anyway)
  if (ts.isTypeAliasDeclaration(parent) && parent.name === id) return true
  if (ts.isInterfaceDeclaration(parent) && parent.name === id) return true

  return false
}

/**
 * Checks if an identifier is the property name part of a property access.
 * In `foo.bar`, `bar` is the property name and should not be treated as a reference.
 */
function isPropertyAccessName(id: ts.Identifier): boolean {
  const parent = id.parent
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true
  // JSX attribute name
  if (ts.isJsxAttribute(parent) && parent.name === id) return true
  return false
}

/**
 * Checks if identifier is a key in an object literal (not a shorthand value).
 */
function isObjectPropertyName(id: ts.Identifier): boolean {
  const parent = id.parent
  if (!parent) return false
  // Property assignment key: { foo: bar } — foo is property name
  if (ts.isPropertyAssignment(parent) && parent.name === id) return true
  // Method declaration name
  if (ts.isMethodDeclaration(parent) && parent.name === id) return true
  if (ts.isPropertyDeclaration(parent) && parent.name === id) return true
  // Note: ShorthandPropertyAssignment `{ foo }` — foo IS a reference, don't skip
  return false
}

/**
 * Checks if identifier is part of an import declaration (already handled as declaration).
 */
function isImportName(id: ts.Identifier): boolean {
  const parent = id.parent
  if (!parent) return false
  // The "imported name" part of: import { orig as local } — orig
  if (ts.isImportSpecifier(parent) && parent.propertyName === id) return true
  // Export specifier names
  if (ts.isExportSpecifier(parent)) return true
  return false
}

/**
 * Checks if the identifier is in a type-only position.
 */
function isInTypePosition(id: ts.Identifier): boolean {
  let node: ts.Node = id
  while (node.parent) {
    const p = node.parent
    // Type reference, type query, etc.
    if (ts.isTypeNode(p)) return true
    if (ts.isTypeReferenceNode(p)) return true
    // Heritage clause (extends/implements)
    if (ts.isHeritageClause(p)) return true
    // Type parameters
    if (ts.isTypeParameterDeclaration(p)) return true
    // Stop walking at statement/expression boundaries
    if (ts.isStatement(p) || ts.isExpression(p) || ts.isBlock(p) || ts.isSourceFile(p)) break
    node = p
  }
  return false
}

/**
 * Walks up from a binding name to find the enclosing VariableDeclaration.
 */
function getEnclosingVariableDeclaration(node: ts.Node): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isVariableDeclaration(current)) return current
    if (ts.isStatement(current) || ts.isSourceFile(current)) return null
    current = current.parent
  }
  return null
}

/**
 * Determines if an identifier reference is a write (assignment target).
 */
function isWriteReference(id: ts.Identifier, parent: ts.Node): boolean {
  // LHS of assignment: x = ...
  if (ts.isBinaryExpression(parent) && parent.left === id && isAssignmentOperatorKind(parent.operatorToken.kind)) {
    return true
  }
  // Prefix/postfix ++/--
  if (ts.isPrefixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return true
  }
  if (ts.isPostfixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return true
  }
  // For-in/for-of variable: for (x of ...)
  if (ts.isForInStatement(parent) && parent.initializer === id) return true
  if (ts.isForOfStatement(parent) && parent.initializer === id) return true

  return false
}

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
}

/**
 * Gets the value expression of an assignment.
 */
function getAssignmentValue(parent: ts.Node): ts.Expression | null {
  if (ts.isBinaryExpression(parent)) return parent.right
  return null
}

/**
 * Gets the assignment operator kind.
 */
function getAssignmentOperator(parent: ts.Node): ts.SyntaxKind | null {
  if (ts.isBinaryExpression(parent)) return parent.operatorToken.kind
  if (ts.isPrefixUnaryExpression(parent)) return parent.operator
  if (ts.isPostfixUnaryExpression(parent)) return parent.operator
  return null
}

/**
 * Checks if a read reference is a "proper access" (called as a function).
 * For signal reads like `count()`, the identifier `count` is properly accessed.
 */
function isProperAccess(id: ts.Identifier): boolean {
  const parent = id.parent
  if (!parent) return false
  // Direct call: count()
  if (ts.isCallExpression(parent) && parent.expression === id) return true
  // Tagged template: tag`...`
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === id) return true
  return false
}

/**
 * Finds the enclosing scope for a node by walking up the parent chain.
 * Uses the scopeForCache WeakMap populated during Pass 1 for O(depth)
 * lookup instead of O(depth × scopes) linear scan.
 */
function findScopeForNode(
  node: ts.Node,
  graph: SolidBuildContext,
  fallback: ScopeEntity,
): ScopeEntity {
  let current: ts.Node | undefined = node.parent
  while (current) {
    const cached = graph.scopeForCache.get(current)
    if (cached) return cached
    current = current.parent
  }
  return fallback
}
