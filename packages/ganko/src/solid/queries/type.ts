/**
 * Type system query functions (delegates to TypeResolver)
 */
import ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree";
import type { TypeInfo, ObjectPropertyInfo } from "../typescript";
import {
  TS_NUMBER_LIKE,
  TS_OBJECT_LIKE,
  TS_POSSIBLY_FALSY_FLAGS,
  TS_PRIMITIVE_FLAGS,
  TS_STRING_LIKE,
} from "../typescript/type-flags";

/**
 * Check whether the graph exposes TypeScript type information.
 *
 * @param graph - Solid syntax tree
 * @returns True when type information is available
 */
export function hasTypeInfo(graph: SolidGraph): boolean {
  return graph.typeResolver.hasTypeInfo();
}

/**
 * Resolve TypeScript type information for a node.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be resolved
 * @returns Resolved type info, or null when unavailable
 */
export function getTypeInfo(graph: SolidGraph, node: ts.Node): TypeInfo | null {
  return graph.typeResolver.getType(node);
}

/**
 * Check whether a node resolves to a Solid accessor type.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be checked
 * @returns True when the node is an accessor
 */
export function isAccessorType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isAccessorType(node);
}

/**
 * Check whether a node resolves to a Solid signal type.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be checked
 * @returns True when the node is a signal
 */
export function isSignalType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isSignalType(node);
}

/**
 * Check whether a node resolves to a Solid store type.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be checked
 * @returns True when the node is a store
 */
export function isStoreType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isStoreType(node);
}

/**
 * Extract expandable object properties for a node's type.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @param maxProperties - Maximum properties to include
 * @param includeCallable - Whether callable properties should be included
 * @returns Expandable object properties, or null when expansion is unsafe
 */
export function getObjectProperties(graph: SolidGraph, node: ts.Node, maxProperties?: number, includeCallable?: boolean): readonly ObjectPropertyInfo[] | null {
  return graph.typeResolver.getObjectProperties(node, maxProperties, includeCallable);
}

/**
 * Check whether a node's resolved type includes a specific flag.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @param flag - TypeScript flag mask to check
 * @returns True when the flag is present
 */
export function typeHasFlag(graph: SolidGraph, node: ts.Node, flag: number): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & flag) !== 0;
}

/**
 * Check whether a node's type includes a numeric constituent.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type includes number-like flags
 */
export function typeIncludesNumber(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & TS_NUMBER_LIKE) !== 0;
}

/**
 * Check whether a node's type includes a string constituent.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type includes string-like flags
 */
export function typeIncludesString(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & TS_STRING_LIKE) !== 0;
}

/**
 * Check whether a node's type may be falsy.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type may be falsy
 */
export function isPossiblyFalsy(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return true; // Conservative default
  return (info.flags & TS_POSSIBLY_FALSY_FLAGS) !== 0;
}

/**
 * Check whether a node's type includes undefined.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type includes undefined
 */
export function typeIncludesUndefined(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & ts.TypeFlags.Undefined) !== 0;
}

/**
 * Check whether a node's type includes null.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type includes null
 */
export function typeIncludesNull(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & ts.TypeFlags.Null) !== 0;
}

/**
 * Check whether a node's type includes object-like flags.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type is object-like
 */
export function typeIsObject(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & TS_OBJECT_LIKE) !== 0;
}

/**
 * Check whether a node's type is primitive rather than object-like.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type is primitive
 */
export function typeIsPrimitive(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & TS_PRIMITIVE_FLAGS) !== 0 && (info.flags & TS_OBJECT_LIKE) === 0;
}

/**
 * Check whether a node's type is array-like.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type is array-like
 */
export function typeIsArray(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isArrayType(node);
}

/**
 * Check whether a node's type is strictly an array or tuple.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type is strictly array-like
 */
export function typeIsStrictArray(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isStrictArrayType(node);
}

/**
 * Check whether a node's type is callable.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose type should be inspected
 * @returns True when the type has call signatures
 */
export function typeIsCallable(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isCallableType(node);
}

/**
 * Classify the element kind of an array-like node.
 *
 * @param graph - Solid syntax tree
 * @param node - Node whose element type should be inspected
 * @returns Primitive, object, or unknown element classification
 */
export function getArrayElementKind(graph: SolidGraph, node: ts.Node): "primitive" | "object" | "unknown" {
  return graph.typeResolver.getArrayElementKind(node);
}
