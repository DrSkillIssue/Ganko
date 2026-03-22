/**
 * Solid analysis entry point.
 *
 * Builds a SolidSyntaxTree from a SolidInput by running all analysis phases
 * against a mutable SolidBuildContext, then freezing the result.
 */
import type { SolidInput } from "./input"
import type { SolidSyntaxTree } from "../compilation/core/solid-syntax-tree"
import { createSolidBuildContext, type SolidBuildContext } from "./build-context"
import { runPhases } from "./phases"

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
