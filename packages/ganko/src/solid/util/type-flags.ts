/**
 * TypeScript Type Flag Constants
 *
 * Named constants for ts.TypeFlags values used in type analysis.
 * See: https://github.com/microsoft/TypeScript/blob/main/src/compiler/types.ts
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../impl"

/** ts.TypeFlags.Any | ts.TypeFlags.Unknown */
export const TS_ANY_OR_UNKNOWN = 1 | 2;

/** ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral (16 | 512) */
export const TS_BOOLEAN_LIKE = 528;

/** ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BigIntLiteral + enum flags */
export const TS_NUMBER_LIKE = 296;

/** ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral + enum string flags */
export const TS_STRING_LIKE = 402653316;

/** ts.TypeFlags.Object */
export const TS_OBJECT_LIKE = 524288;

/**
 * Check if a node's TypeScript type is exclusively boolean.
 * Returns false for any/unknown, union types containing non-boolean members,
 * or nodes whose type cannot be resolved.
 */
export function isBooleanType(solid: SolidGraph, node: T.Node): boolean {
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
 */
export function isDefinitelyNonBooleanType(solid: SolidGraph, node: T.Node): boolean {
  const info = solid.typeResolver.getType(node);
  if (!info) return false;

  if ((info.flags & TS_ANY_OR_UNKNOWN) !== 0) return false;
  if (isBooleanType(solid, node)) return false;
  return true;
}
