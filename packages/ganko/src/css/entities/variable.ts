/**
 * CSS Variable Types
 */

import type { Specificity } from "./specificity";
import type { DeclarationEntity } from "./declaration";
import type { FileEntity } from "./file";
import type { SelectorEntity } from "./selector";
import type { ThemeTokenEntity } from "./token";
import type { ParsedValue } from "./value";

/**
 * Variable scope information.
 */
export interface VariableScope {
  type: "global" | "selector" | "media" | "supports" | "layer";
  condition: string | null;
  specificity: Specificity | null;
}

/**
 * Represents a CSS custom property definition (--name: value).
 */
export interface VariableEntity {
  id: number;
  name: string;
  declaration: DeclarationEntity;
  file: FileEntity;
  scope: VariableScope;
  scopeSelector: SelectorEntity | null;
  _flags: number;
  value: string;
  parsedValue: ParsedValue;
  computedValue: string | null;
  references: VariableReferenceEntity[];
  shadows: VariableEntity[];
  shadowedBy: VariableEntity[];
  themeToken: ThemeTokenEntity | null;
  scssName: string | null;
}

/**
 * Represents a var(--name) usage.
 */
export interface VariableReferenceEntity {
  id: number;
  name: string;
  declaration: DeclarationEntity;
  file: FileEntity;
  resolvedVariable: VariableEntity | null;
  _flags: number;
  fallback: string | null;
  fallbackReferences: VariableReferenceEntity[];
  fallbackChainDepth: number;
  sourceIndex: number;
  raw: string;
}
