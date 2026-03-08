/**
 * CSS Selector Types
 */

import type { Specificity } from "./specificity";
import type { RuleEntity } from "./rule";

/**
 * Combinator types between selector parts.
 */
export type CombinatorType = "descendant" | "child" | "adjacent" | "sibling";

/**
 * A part of a compound selector.
 */
export interface SelectorPart {
  readonly type: "element" | "id" | "class" | "attribute" | "pseudo-class" | "pseudo-element" | "universal" | "nesting";
  readonly value: string;
  readonly raw: string;
}

export interface SelectorAttributeConstraint {
  name: string;
  operator: "exists" | "equals" | "includes-word" | "dash-prefix" | "prefix" | "suffix" | "contains";
  value: string | null;
  caseInsensitive: boolean;
}

export interface SelectorAnchor {
  subjectTag: string | null;
  classes: readonly string[];
  attributes: readonly SelectorAttributeConstraint[];
  includesDescendantCombinator: boolean;
  includesPseudoSelector: boolean;
  dynamic: boolean;
  targetsCheckbox: boolean;
  targetsTableCell: boolean;
}

/**
 * Selector complexity metrics for analysis.
 */
export interface SelectorComplexity {
  depth: number;
  breadth: number;
  _flags: number;
  pseudoClasses: string[];
  pseudoElements: string[];
  combinators: CombinatorType[];
}

/**
 * Represents an individual selector within a rule.
 */
export interface SelectorEntity {
  id: number;
  raw: string;
  rule: RuleEntity;
  specificity: Specificity;
  specificityScore: number;
  complexity: SelectorComplexity;
  parts: SelectorPart[];
  anchor: SelectorAnchor;
  overrides: SelectorEntity[];
  overriddenBy: SelectorEntity[];
}
