/**
 * Solid analysis entry point.
 *
 * Builds a SolidSyntaxTree from a SolidInput by running all analysis phases
 * against a mutable SolidBuildContext, then freezing the result.
 */
import ts from "typescript"
import type { SolidInput } from "./input"
import type { SolidSyntaxTree } from "../compilation/core/solid-syntax-tree"
import { createSolidBuildContext, type SolidBuildContext } from "./build-context"
import { runPhases } from "./phases"
import type { FunctionEntity } from "./entities/function"
import type { JSXElementEntity } from "./entities/jsx"

export type { JSXElementEntity, JSXAttributeEntity } from "./entities/jsx"
export type { SolidBuildContext } from "./build-context"

/**
 * Build a SolidSyntaxTree from input.
 *
 * 1. Creates mutable SolidBuildContext
 * 2. Runs all 9 analysis phases (scopes, entities, wiring, reactivity, etc.)
 * 3. Freezes context into readonly SolidSyntaxTree
 */
export function buildSolidSyntaxTree(input: SolidInput, version: string): SolidSyntaxTree {
  const ctx = createSolidBuildContext(input)
  runPhases(ctx, input)
  return freezeToSyntaxTree(ctx, version)
}

function freezeToSyntaxTree(ctx: SolidBuildContext, version: string): SolidSyntaxTree {
  return {
    kind: "solid",
    filePath: ctx.file,
    version,
    sourceFile: ctx.sourceFile,
    comments: ctx.comments,

    scopes: ctx.scopes,
    variables: ctx.variables,
    functions: ctx.functions,
    calls: ctx.calls,
    jsxElements: ctx.jsxElements,
    imports: ctx.imports,
    exports: ctx.exports,
    classes: ctx.classes,
    properties: ctx.properties,
    propertyAssignments: ctx.propertyAssignments,
    conditionalSpreads: ctx.conditionalSpreads,
    objectSpreads: ctx.objectSpreads,
    nonNullAssertions: ctx.nonNullAssertions,
    typeAssertions: ctx.typeAssertions,
    typePredicates: ctx.typePredicates,
    unsafeGenericAssertions: ctx.unsafeGenericAssertions,
    unsafeTypeAnnotations: ctx.unsafeTypeAnnotations,
    inlineImports: ctx.inlineImports,
    computations: ctx.computations,
    dependencyEdges: ctx.dependencyEdges,
    ownershipEdges: ctx.ownershipEdges,

    variablesByName: ctx.variablesByName,
    functionsByNode: ctx.functionsByNode,
    functionsByDeclarationNode: ctx.functionsByDeclarationNode,
    functionsByName: ctx.functionsByName,
    callsByNode: ctx.callsByNode,
    callsByPrimitive: ctx.callsByPrimitive,
    callsByMethodName: ctx.callsByMethodName,
    callsByArgNode: ctx.callsByArgNode,
    jsxByNode: ctx.jsxByNode,
    jsxByTag: ctx.jsxByTag,
    jsxAttributesByElementId: ctx.jsxAttributesByElementId,
    jsxAttrsByKind: ctx.jsxAttrsByKind,
    jsxClassAttributes: ctx.jsxClassAttributes,
    jsxClassListAttributes: ctx.jsxClassListAttributes,
    jsxStyleAttributes: ctx.jsxStyleAttributes,
    fillImageElements: ctx.fillImageElements,
    staticClassTokensByElementId: ctx.staticClassTokensByElementId,
    staticClassListKeysByElementId: ctx.staticClassListKeysByElementId,
    staticStyleKeysByElementId: ctx.staticStyleKeysByElementId,
    classListProperties: ctx.classListProperties,
    styleProperties: ctx.styleProperties,
    inlineStyleClassNames: ctx.inlineStyleClassNames,
    importsBySource: ctx.importsBySource,
    exportsByName: ctx.exportsByName,
    exportsByEntityId: ctx.exportsByEntityId,
    classesByNode: ctx.classesByNode,
    classesByName: ctx.classesByName,

    unaryExpressionsByOperator: ctx.unaryExpressionsByOperator,
    spreadElements: ctx.spreadElements,
    newExpressionsByCallee: ctx.newExpressionsByCallee,
    deleteExpressions: ctx.deleteExpressions,
    identifiersByName: ctx.identifiersByName,

    firstScope: ctx.firstScope,
    componentScopes: ctx.componentScopes,
    componentFunctions: ctx.componentFunctions,
    compoundComponentParents: buildCompoundComponentParents(ctx),
    functionsWithReactiveCaptures: ctx.functionsWithReactiveCaptures,
    reactiveVariables: ctx.reactiveVariables,
    propsVariables: ctx.propsVariables,
    storeVariables: ctx.storeVariables,
    resourceVariables: ctx.resourceVariables,
    variablesWithPropertyAssignment: ctx.variablesWithPropertyAssignment,
    computationByCallId: ctx.computationByCallId,

    typeResolver: ctx.typeResolver,
    fileEntity: ctx.fileEntity,
    lineStartOffsets: ctx.lineStartOffsets,

    jsxContextCache: ctx.jsxContextCache,
    scopeForCache: ctx.scopeForCache,
    onDepsCache: ctx.onDepsCache,
    passthroughCache: ctx.passthroughCache,

    findExpressionAtOffset: ctx.findExpressionAtOffset,
  }
}

/**
 * Build compound component parent map from Object.assign patterns.
 *
 * Detects `const X = Object.assign(BaseComponent, { Member1, Member2, ... })`
 * and maps each member component's scope ID to the base component's
 * children-forwarding root JSX element ID.
 *
 * This data is stored on the SolidSyntaxTree so the element builder can
 * query it to wire cross-component parent chains within the same file —
 * following Roslyn's pattern of storing containment on the syntax tree
 * at construction time.
 */
function buildCompoundComponentParents(ctx: SolidBuildContext): ReadonlyMap<number, number> {
  const componentsByName = new Map<string, FunctionEntity>()
  for (let i = 0; i < ctx.componentFunctions.length; i++) {
    const fn = ctx.componentFunctions[i]
    if (fn && fn.name !== null) componentsByName.set(fn.name, fn)
  }
  if (componentsByName.size === 0) return new Map()

  const out = new Map<number, number>()

  for (let i = 0; i < ctx.variables.length; i++) {
    const variable = ctx.variables[i]
    if (!variable || variable.scope.kind !== "program") continue
    const init = variable.initializer
    if (init === null || !ts.isCallExpression(init)) continue
    if (!isObjectAssignCall(init) || init.arguments.length < 2) continue

    const firstArg = init.arguments[0]
    if (!firstArg || !ts.isIdentifier(firstArg)) continue
    const baseFn = componentsByName.get(firstArg.text)
    if (!baseFn) continue

    const baseRootElement = findFunctionRootJSXElement(baseFn, ctx)
    if (baseRootElement === null) continue
    const childrenSlot = findChildrenForwardingElement(baseRootElement)
    if (childrenSlot === null) continue

    const baseRootTag = baseRootElement.tag

    for (let j = 1; j < init.arguments.length; j++) {
      const arg = init.arguments[j]
      if (!arg || !ts.isObjectLiteralExpression(arg)) continue
      for (let k = 0; k < arg.properties.length; k++) {
        const prop = arg.properties[k]
        if (!prop || !ts.isPropertyAssignment(prop)) continue
        const value = prop.initializer
        if (!ts.isIdentifier(value)) continue
        const memberFn = componentsByName.get(value.text)
        if (!memberFn) continue
        const memberRoot = findFunctionRootJSXElement(memberFn, ctx)
        if (memberRoot !== null && memberRoot.tag === baseRootTag) continue
        out.set(memberFn.scope.id, childrenSlot.id)
      }
    }
  }

  return out
}

function isObjectAssignCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.expression)) return false
  if (callee.expression.text !== "Object") return false
  return callee.name.text === "assign"
}

function findFunctionRootJSXElement(fn: FunctionEntity, ctx: SolidBuildContext): JSXElementEntity | null {
  if (fn.body === null || fn.body === undefined) return null

  if (!ts.isBlock(fn.body)) {
    return findJSXElementFromExpression(fn.body, ctx)
  }

  for (let i = 0; i < fn.returnStatements.length; i++) {
    const ret = fn.returnStatements[i]
    if (!ret) continue
    const expr = ret.node.expression
    if (!expr) continue
    return findJSXElementFromExpression(expr, ctx)
  }

  return null
}

function findJSXElementFromExpression(expr: ts.Expression, ctx: SolidBuildContext): JSXElementEntity | null {
  let current: ts.Expression = expr
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression
  }

  if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
    return ctx.jsxByNode.get(current) ?? null
  }

  // Context.Provider wrapping — look inside the children
  if (ts.isJsxElement(current)) {
    const entity = ctx.jsxByNode.get(current)
    if (entity && entity.tag && entity.tag.endsWith(".Provider")) {
      for (let i = 0; i < current.children.length; i++) {
        const child = current.children[i]
        if (!child) continue
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          return ctx.jsxByNode.get(child) ?? null
        }
      }
    }
  }

  return null
}

function findChildrenForwardingElement(root: JSXElementEntity): JSXElementEntity | null {
  const queue: JSXElementEntity[] = [root]
  const seen = new Set<number>()

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    if (!current) continue
    if (seen.has(current.id)) continue
    seen.add(current.id)

    if (current.children.length === 0) {
      for (let j = 0; j < current.attributes.length; j++) {
        const attr = current.attributes[j]
        if (attr && ts.isJsxSpreadAttribute(attr.node)) return current
      }
    } else {
      for (let j = 0; j < current.children.length; j++) {
        const child = current.children[j]
        if (!child || child.kind !== "expression") continue
        if (!ts.isJsxExpression(child.node) || !child.node.expression) continue
        if (containsChildrenReference(child.node.expression)) return current
      }
      for (let j = 0; j < current.childElements.length; j++) {
        const childElement = current.childElements[j]
        if (childElement) queue.push(childElement)
      }
    }
  }

  return null
}

function containsChildrenReference(expression: ts.Expression): boolean {
  const queue: ts.Node[] = [expression]
  for (let i = 0; i < queue.length && i < 512; i++) {
    const current = queue[i]
    if (!current) continue
    if (ts.isIdentifier(current) && current.text === "children") return true
    if (ts.isPropertyAccessExpression(current)) {
      if (ts.isIdentifier(current.name) && current.name.text === "children") return true
      queue.push(current.expression)
      continue
    }
    if (ts.isCallExpression(current)) {
      if (ts.isIdentifier(current.expression) && current.expression.text === "children") return true
      queue.push(current.expression)
      for (let j = 0; j < current.arguments.length; j++) { const a = current.arguments[j]; if (a) queue.push(a) }
      continue
    }
    const children = current.getChildren()
    for (let j = 0; j < children.length; j++) {
      const child = children[j]
      if (child) queue.push(child)
    }
  }
  return false
}
