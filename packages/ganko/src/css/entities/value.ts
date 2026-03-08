/**
 * CSS Value Types
 */

import type { FunctionCallInfo, ParsedValue, ParsedValueNode } from "../parser/value";
import type { Specificity } from "./specificity";

export type { FunctionCallInfo, ParsedValue };
export type { ParsedValueNode as ValueNode };

/**
 * Position in the CSS cascade.
 */
export interface CascadePosition {
  layer: string | null;
  layerOrder: number;
  sourceOrder: number;
  specificity: Specificity;
  specificityScore: number;
  isImportant: boolean;
}
