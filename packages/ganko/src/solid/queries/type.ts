/**
 * Type system query functions (delegates to TypeResolver)
 */
import type ts from "typescript";
import type { SolidGraph } from "../impl";
import type { TypeInfo, ObjectPropertyInfo } from "../typescript";

export function hasTypeInfo(graph: SolidGraph): boolean {
  return graph.typeResolver.hasTypeInfo();
}

export function getTypeInfo(graph: SolidGraph, node: ts.Node): TypeInfo | null {
  return graph.typeResolver.getType(node);
}

export function isAccessorType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isAccessorType(node);
}

export function isSignalType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isSignalType(node);
}

export function isStoreType(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isStoreType(node);
}

export function getObjectProperties(graph: SolidGraph, node: ts.Node, maxProperties?: number, includeCallable?: boolean): readonly ObjectPropertyInfo[] | null {
  return graph.typeResolver.getObjectProperties(node, maxProperties, includeCallable);
}

export function typeHasFlag(graph: SolidGraph, node: ts.Node, flag: number): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & flag) !== 0;
}

export function typeIncludesNumber(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & 296) !== 0; // Number | NumberLiteral
}

export function typeIncludesString(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & 402653316) !== 0; // String | StringLiteral | TemplateLiteral
}

export function isPossiblyFalsy(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return true; // Conservative default
  // PossiblyFalsy includes String, Number, Boolean, Void, Undefined, Null
  const falsyFlags = 402653316 | 296 | 528 | 16384 | 32768 | 65536;
  return (info.flags & falsyFlags) !== 0;
}

export function typeIncludesUndefined(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & 32768) !== 0; // Undefined
}

export function typeIncludesNull(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & 65536) !== 0; // Null
}

export function typeIsObject(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  return (info.flags & 524288) !== 0; // Object
}

export function typeIsPrimitive(graph: SolidGraph, node: ts.Node): boolean {
  const info = graph.typeResolver.getType(node);
  if (!info) return false;
  const primitiveFlags = 402653316 | 296 | 2112 | 528 | 12288 | 16384 | 32768 | 65536 | 131072;
  return (info.flags & primitiveFlags) !== 0 && (info.flags & 524288) === 0;
}

export function typeIsArray(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isArrayType(node);
}

export function typeIsStrictArray(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isStrictArrayType(node);
}

export function typeIsCallable(graph: SolidGraph, node: ts.Node): boolean {
  return graph.typeResolver.isCallableType(node);
}

export function getArrayElementKind(graph: SolidGraph, node: ts.Node): "primitive" | "object" | "unknown" {
  return graph.typeResolver.getArrayElementKind(node);
}
