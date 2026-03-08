/**
 * CSS Rule Entity
 */

import type { Rule } from "postcss";
import type { FileEntity } from "./file";
import type { SelectorEntity } from "./selector";
import type { DeclarationEntity } from "./declaration";
import type { AtRuleEntity } from "./at-rule";

/**
 * Represents a CSS rule (selector block with declarations).
 */
export interface RuleEntity {
  kind: "rule";
  id: number;
  node: Rule;
  file: FileEntity;
  selectorText: string;
  selectors: SelectorEntity[];
  declarations: DeclarationEntity[];
  nestedRules: RuleEntity[];
  nestedAtRules: AtRuleEntity[];
  parent: RuleEntity | AtRuleEntity | null;
  depth: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
  blockStartOffset: number;
  blockEndOffset: number;
  sourceOrder: number;
  containingMedia: AtRuleEntity | null;
  containingLayer: AtRuleEntity | null;
  containingMediaStack: AtRuleEntity[];
  declarationIndex: Map<string, DeclarationEntity[]>;
  /** Pre-computed semantic element kinds derived from selector parts. */
  elementKinds: Set<RuleElementKind>;
}

/**
 * Semantic element classification for rules, derived from selector parts.
 * Used by policy rules to determine applicable thresholds.
 */
export type RuleElementKind = "heading" | "button" | "input" | "caption" | "paragraph" | "inline-formatting" | "pseudo-element";
