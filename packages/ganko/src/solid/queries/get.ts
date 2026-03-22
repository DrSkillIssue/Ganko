/**
 * Collection getters and map/ID-based lookups
 */
import type ts from "typescript";
import typescript from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree";
import type { ScopeEntity } from "../entities/scope";
import type { VariableEntity } from "../entities/variable";
import type { FunctionEntity } from "../entities/function";
import type { CallEntity, ArgumentEntity, ArgumentSemantic, PrimitiveInfo, PrimitiveDefinition } from "../entities/call";
import { SOLID_PRIMITIVES } from "../entities/call";
import type { JSXElementEntity } from "../entities/jsx";
import type { ImportEntity } from "../entities/import";
import type { ExportEntity } from "../entities/export";
import type { PropertyAssignmentEntity } from "../entities/property-assignment";
import type { ConditionalSpreadEntity, ObjectSpreadEntity } from "../entities/spread";
import type { NonNullAssertionEntity } from "../entities/non-null-assertion";
import type { TypeAssertionEntity, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity } from "../entities/type-assertion";
import type { InlineImportEntity } from "../entities/inline-import";
import type { FileEntity } from "../entities/file";
import { getMethodName, getMethodObject } from "../util/call";

/**
 * Information about a node found at a specific position.
 */
export interface NodeAtPositionInfo {
  /** The AST node kind */
  readonly kind: ts.SyntaxKind;
  /** The node name (for identifiers) */
  readonly name: string | null;
  /** The AST node */
  readonly node: ts.Node;
}

export function getSourceFile(graph: SolidGraph): ts.SourceFile {
  return graph.sourceFile;
}

/** @deprecated Use getSourceFile instead */
export function getSourceCode(graph: SolidGraph): ts.SourceFile {
  return graph.sourceFile;
}

export function getAST(graph: SolidGraph): ts.SourceFile {
  return graph.sourceFile;
}

export function getFunctions(graph: SolidGraph): readonly FunctionEntity[] {
  return graph.functions;
}

export function getCalls(graph: SolidGraph): readonly CallEntity[] {
  return graph.calls;
}

export function getVariables(graph: SolidGraph): readonly VariableEntity[] {
  return graph.variables;
}

export function getScopes(graph: SolidGraph): readonly ScopeEntity[] {
  return graph.scopes;
}

export function getJSXElements(graph: SolidGraph): readonly JSXElementEntity[] {
  return graph.jsxElements;
}

export function getFillImageElements(graph: SolidGraph): readonly JSXElementEntity[] {
  return graph.fillImageElements;
}

export function getImports(graph: SolidGraph): readonly ImportEntity[] {
  return graph.imports;
}

export function getExports(graph: SolidGraph): readonly ExportEntity[] {
  return graph.exports;
}

export function getReactiveVariables(graph: SolidGraph): readonly VariableEntity[] {
  return graph.reactiveVariables;
}

export function getComponentFunctions(graph: SolidGraph): readonly FunctionEntity[] {
  return graph.componentFunctions;
}

export function getFunctionsWithReactiveCaptures(graph: SolidGraph): readonly FunctionEntity[] {
  return graph.functionsWithReactiveCaptures;
}

export function getPropsVariables(graph: SolidGraph): readonly VariableEntity[] {
  return graph.propsVariables;
}

export function getStoreVariables(graph: SolidGraph): readonly VariableEntity[] {
  return graph.storeVariables;
}

export function getResourceVariables(graph: SolidGraph): readonly VariableEntity[] {
  return graph.resourceVariables;
}

export function getVariablesWithPropertyAssignment(graph: SolidGraph): readonly VariableEntity[] {
  return graph.variablesWithPropertyAssignment;
}

export function getInlineImports(graph: SolidGraph): readonly InlineImportEntity[] {
  return graph.inlineImports;
}

export function getObjectSpreads(graph: SolidGraph): readonly ObjectSpreadEntity[] {
  return graph.objectSpreads;
}

export function getNonNullAssertions(graph: SolidGraph): readonly NonNullAssertionEntity[] {
  return graph.nonNullAssertions;
}

export function getTypeAssertions(graph: SolidGraph): readonly TypeAssertionEntity[] {
  return graph.typeAssertions;
}

export function getTypePredicates(graph: SolidGraph): readonly TypePredicateEntity[] {
  return graph.typePredicates;
}

export function getUnsafeGenericAssertions(graph: SolidGraph): readonly UnsafeGenericAssertionEntity[] {
  return graph.unsafeGenericAssertions;
}

export function getUnsafeTypeAnnotations(graph: SolidGraph): readonly UnsafeTypeAnnotationEntity[] {
  return graph.unsafeTypeAnnotations;
}

export function getPropertyAssignments(graph: SolidGraph): readonly PropertyAssignmentEntity[] {
  return graph.propertyAssignments;
}

export function getConditionalSpreads(graph: SolidGraph): readonly ConditionalSpreadEntity[] {
  return graph.conditionalSpreads;
}

export function getFiles(graph: SolidGraph): readonly FileEntity[] {
  return [graph.fileEntity];
}

export function getSpreadElements(graph: SolidGraph): readonly (ts.SpreadElement | ts.SpreadAssignment)[] {
  return graph.spreadElements;
}

export function getCallsByPrimitive(graph: SolidGraph, name: string): readonly CallEntity[] {
  return graph.callsByPrimitive.get(name) ?? [];
}

export function getCallsByMethodName(graph: SolidGraph, name: string): readonly CallEntity[] {
  return graph.callsByMethodName.get(name) ?? [];
}

export function getFunctionByNode(graph: SolidGraph, node: ts.Node): FunctionEntity | null {
  return graph.functionsByNode.get(node) ?? null;
}

export function getFunctionsByName(graph: SolidGraph, name: string): readonly FunctionEntity[] {
  return graph.functionsByName.get(name) ?? [];
}

export function getVariablesByName(graph: SolidGraph, name: string): readonly VariableEntity[] {
  return graph.variablesByName.get(name) ?? [];
}

export function getJSXElementByNode(graph: SolidGraph, node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): JSXElementEntity | null {
  return graph.jsxByNode.get(node) ?? null;
}

export function getJSXElementsByTag(graph: SolidGraph, tag: string): readonly JSXElementEntity[] {
  return graph.jsxByTag.get(tag) ?? [];
}

export function hasImportFrom(graph: SolidGraph, source: string): boolean {
  return graph.importsBySource.has(source);
}

export function getImportsBySource(graph: SolidGraph, source: string): readonly ImportEntity[] {
  return graph.importsBySource.get(source) ?? [];
}

export function hasImportSpecifier(graph: SolidGraph, source: string, specifier: string): boolean {
  const imports = graph.importsBySource.get(source);
  if (!imports) return false;
  for (let i = 0, len = imports.length; i < len; i++) {
    const imp = imports[i];
    if (!imp) continue;
    const specs = imp.specifiers;
    for (let j = 0, slen = specs.length; j < slen; j++) {
      const spec = specs[j];
      if (!spec) continue;
      if (spec.importedName === specifier || spec.localName === specifier) {
        return true;
      }
    }
  }
  return false;
}

export function getArgumentByNode(graph: SolidGraph, node: ts.Node): ArgumentEntity | null {
  return graph.callsByArgNode.get(node) ?? null;
}

export function getCallForArgument(graph: SolidGraph, node: ts.Node): CallEntity | null {
  const arg = graph.callsByArgNode.get(node);
  if (!arg) return null;
  for (let i = 0, len = graph.calls.length; i < len; i++) {
    const call = graph.calls[i];
    if (!call) continue;
    const args = call.arguments;
    for (let j = 0, alen = args.length; j < alen; j++) {
      if (args[j] === arg) return call;
    }
  }
  return null;
}

export function getCallByNode(graph: SolidGraph, node: ts.CallExpression | ts.NewExpression): CallEntity | null {
  return graph.callsByNode.get(node) ?? null;
}

export function getFunctionByDeclarationNode(graph: SolidGraph, node: ts.Node): FunctionEntity | null {
  return graph.functionsByDeclarationNode.get(node) ?? null;
}

export function getComponentScopes(graph: SolidGraph): Map<ScopeEntity, { scope: ScopeEntity; name: string }> {
  return graph.componentScopes;
}

export function getExportByName(graph: SolidGraph, name: string): ExportEntity | null {
  return graph.exportsByName.get(name) ?? null;
}

export function getExportByEntityId(graph: SolidGraph, entityId: number): ExportEntity | null {
  return graph.exportsByEntityId.get(entityId) ?? null;
}

export function getFileByPath(graph: SolidGraph, path: string): FileEntity | null {
  return path === graph.file ? graph.fileEntity : null;
}

export function getFunctionById(graph: SolidGraph, id: number): FunctionEntity | null {
  return graph.functions[id] ?? null;
}

export function getCallById(graph: SolidGraph, id: number): CallEntity | null {
  return graph.calls[id] ?? null;
}

export function getVariableById(graph: SolidGraph, id: number): VariableEntity | null {
  return graph.variables[id] ?? null;
}

export function getScopeById(graph: SolidGraph, id: number): ScopeEntity | null {
  return graph.scopes[id] ?? null;
}

export function getUnaryExpressionsByOperator(graph: SolidGraph, op: ts.SyntaxKind): readonly ts.PrefixUnaryExpression[] {
  return graph.unaryExpressionsByOperator.get(op) ?? [];
}

export function getNewExpressionsByCallee(graph: SolidGraph, name: string): readonly ts.NewExpression[] {
  return graph.newExpressionsByCallee.get(name) ?? [];
}

export function getIdentifierReferences(graph: SolidGraph, name: string): readonly ts.Identifier[] {
  return graph.identifiersByName.get(name) ?? [];
}

export function getNodeAtPosition(graph: SolidGraph, line: number, column: number): NodeAtPositionInfo | null {
  const lineStarts = graph.lineStartOffsets;
  if (line < 1 || line > lineStarts.length) return null;
  const lineStart = lineStarts[line - 1];
  if (lineStart === undefined) return null;
  const offset = lineStart + column;
  const node = graph.findExpressionAtOffset(offset);
  if (!node) return null;
  return {
    kind: node.kind,
    name: typescript.isIdentifier(node) ? node.text : null,
    node,
  };
}

export function getNodeAtPositionInFile(graph: SolidGraph, path: string, line: number, column: number): NodeAtPositionInfo | null {
  if (path !== graph.file) return null;
  return getNodeAtPosition(graph, line, column);
}

/**
 * Result of walking up a method call chain.
 * Arrays ordered from root to leaf (first call in chain to last).
 */
export interface MethodChain {
  /** All CallEntity nodes in the chain, root-to-leaf order */
  readonly calls: readonly CallEntity[];
  /** Method names corresponding to each call */
  readonly methods: readonly string[];
  /** The root object the chain is called on (null if chain starts with bare call) */
  readonly root: ts.Node | null;
}

/**
 * Walks up the call chain to collect all chained method calls.
 *
 * @example
 * // For: foo.bar().baz().qux()
 * // Starting from qux() call:
 * // returns { calls: [bar, baz, qux], methods: ["bar", "baz", "qux"], root: foo }
 */
export function getMethodChain(graph: SolidGraph, call: CallEntity): MethodChain {
  const calls: CallEntity[] = [];
  const methods: string[] = [];
  let root: ts.Node | null = null;
  let current: CallEntity | null = call;

  while (current) {
    const method = getMethodName(current.node);
    if (!method) break;

    calls.unshift(current);
    methods.unshift(method);

    const obj = getMethodObject(current.node);
    if (!obj) break;

    if (!typescript.isCallExpression(obj)) {
      root = obj;
      break;
    }

    current = getCallByNode(graph, obj);
  }

  return { calls, methods, root };
}

// Primitive Index (constant time lookup by name)
// eslint-disable-next-line solid/unbounded-collection -- bounded by SOLID_PRIMITIVES count (~30)
const primitivesByName = new Map<string, PrimitiveDefinition>();
for (const primitive of SOLID_PRIMITIVES) {
  primitivesByName.set(primitive.name, primitive);
}

// Since there are only ~30 primitives, these objects are created once and reused
// eslint-disable-next-line solid/unbounded-collection -- bounded by SOLID_PRIMITIVES count (~30)
const primitiveInfoCache = new Map<PrimitiveDefinition, PrimitiveInfo>();

/**
 * Get a primitive definition by name.
 * Constant time lookup.
 *
 * @param name - Primitive function name
 * @returns Primitive definition or null
 */
export function getPrimitiveByName(name: string): PrimitiveDefinition | null {
  return primitivesByName.get(name) ?? null;
}

/**
 * Check if a name is a known Solid primitive.
 *
 * @param name - Function name to check
 * @returns True if name is a Solid primitive
 */
export function isSolidPrimitive(name: string): boolean {
  return primitivesByName.has(name);
}

/**
 * Get the argument semantics for a primitive call.
 * Returns an empty array if not a known primitive.
 *
 * @param primitiveName - Name of the primitive
 * @returns Array of argument semantics
 */
export function getArgumentSemantics(primitiveName: string): ArgumentSemantic[] {
  const def = primitivesByName.get(primitiveName);
  return def?.argumentSemantics ?? [];
}

/**
 * Convert a PrimitiveDefinition to PrimitiveInfo for the graph.
 * Results are cached and frozen for reuse.
 *
 * @param def - Primitive definition
 * @returns Primitive info for graph
 */
export function toPrimitiveInfo(def: PrimitiveDefinition): PrimitiveInfo {
  let cached = primitiveInfoCache.get(def);
  if (!cached) {
    cached = Object.freeze({
      name: def.name,
      module: def.module,
      returns: def.returns,
    });
    primitiveInfoCache.set(def, cached);
  }
  return cached;
}
