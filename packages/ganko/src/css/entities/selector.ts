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

export interface NthPattern {
  readonly step: number
  readonly offset: number
}

export const enum PseudoConstraintKind {
  Simple = 0,
  FirstChild = 1,
  LastChild = 2,
  OnlyChild = 3,
  NthChild = 4,
  NthLastChild = 5,
  NthOfType = 6,
  NthLastOfType = 7,
  MatchesAny = 8,
  NoneOf = 9,
}

export interface ParsedPseudoConstraint {
  readonly name: string
  readonly raw: string
  readonly kind: PseudoConstraintKind
  readonly nthPattern: NthPattern | null
  readonly nestedCompounds: readonly SelectorCompound[][] | null
}

export interface SelectorCompound {
  readonly parts: readonly SelectorPart[]
  readonly tagName: string | null
  readonly idValue: string | null
  readonly classes: readonly string[]
  readonly attributes: readonly SelectorAttributeConstraint[]
  readonly pseudoClasses: readonly ParsedPseudoConstraint[]
}

export interface SelectorAnchor {
  subjectTag: string | null;
  idValue: string | null;
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
  compounds: readonly SelectorCompound[];
  combinators: readonly CombinatorType[];
  parts: SelectorPart[];
  anchor: SelectorAnchor;
  overrides: SelectorEntity[];
  overriddenBy: SelectorEntity[];
}
