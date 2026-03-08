/**
 * CSS File Entity
 */

import type { Root, AtRule } from "postcss";
import type { RuleEntity } from "./rule";
import type { AtRuleEntity } from "./at-rule";
import type { VariableEntity } from "./variable";

/**
 * Import information for @import/@use directives.
 */
export interface ImportInfo {
  path: string;
  node: AtRule;
  isPartial: boolean;
  resolvedFile: FileEntity | null;
  mediaQuery: string | null;
  layer: string | null;
}

/**
 * Represents a CSS/SCSS source file.
 */
export interface FileEntity {
  id: number;
  path: string;
  content: string;
  syntax: "css" | "scss" | "sass" | "less";
  node: Root;
  lineCount: number;
  lineStartOffsets: readonly number[];
  _flags: number;
  imports: ImportInfo[];
  importedBy: FileEntity[];
  rules: RuleEntity[];
  atRules: AtRuleEntity[];
  variables: VariableEntity[];
}
