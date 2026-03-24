import type ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree";
import {
  TS_ANY_OR_UNKNOWN,
  TS_BOOLEAN_LIKE,
  TS_NUMBER_LIKE,
  TS_OBJECT_LIKE,
  TS_STRING_LIKE,
} from "../typescript/type-flags";

export {
  TS_ANY_OR_UNKNOWN,
  TS_BOOLEAN_LIKE,
  TS_NUMBER_LIKE,
  TS_OBJECT_LIKE,
  TS_STRING_LIKE,
};

/**
 * Check if a node's TypeScript type is exclusively boolean.
 * Returns false for any/unknown, union types containing non-boolean members,
 * or nodes whose type cannot be resolved.
 *
 * @param solid - Solid syntax tree with a type resolver
 * @param node - Node whose type should be checked
 * @returns True when the type is exclusively boolean
 */
export function isBooleanType(solid: SolidGraph, node: ts.Node): boolean {
  const info = solid.typeResolver.getType(node);
  if (!info) return false;

  if ((info.flags & TS_ANY_OR_UNKNOWN) !== 0) return false;
  if ((info.flags & TS_BOOLEAN_LIKE) === 0) return false;
  if ((info.flags & TS_STRING_LIKE) !== 0) return false;
  if ((info.flags & TS_NUMBER_LIKE) !== 0) return false;
  if ((info.flags & TS_OBJECT_LIKE) !== 0) return false;
  return true;
}

/**
 * Check if a node's TypeScript type is definitively not boolean.
 * Returns false for any/unknown (ambiguous) or actual boolean types.
 *
 * @param solid - Solid syntax tree with a type resolver
 * @param node - Node whose type should be checked
 * @returns True when the type is definitively non-boolean
 */
export function isDefinitelyNonBooleanType(solid: SolidGraph, node: ts.Node): boolean {
  const info = solid.typeResolver.getType(node);
  if (!info) return false;

  if ((info.flags & TS_ANY_OR_UNKNOWN) !== 0) return false;
  if (isBooleanType(solid, node)) return false;
  return true;
}
