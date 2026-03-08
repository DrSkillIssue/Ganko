/**
 * CSS Theme Token Types
 */

import type { FileEntity } from "./file";
import type { VariableEntity } from "./variable";

/**
 * Token category for design system organization.
 */
export type TokenCategory =
  | "color"
  | "spacing"
  | "typography"
  | "border"
  | "shadow"
  | "radius"
  | "z-index"
  | "animation"
  | "breakpoint"
  | "other";

/**
 * Theme token variant (e.g., "500", "light", "hover").
 */
export interface ThemeTokenVariant {
  name: string;
  variable: VariableEntity;
  value: string;
}

/**
 * Represents a theme/design system token.
 */
export interface ThemeTokenEntity {
  id: number;
  name: string;
  category: TokenCategory;
  file: FileEntity;
  variables: VariableEntity[];
  variants: ThemeTokenVariant[];
  isComplete: boolean;
  missingVariants: string[];
  namingPattern: string;
}
