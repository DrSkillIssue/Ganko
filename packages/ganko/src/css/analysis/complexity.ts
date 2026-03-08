/**
 * Selector Complexity Metrics
 */

import type { SelectorInfo, CombinatorType, SelectorComplexity } from "../entities";
import {
  MINIMAL_COMPLEXITY, EMPTY_STRINGS, EMPTY_COMBINATORS,
  SEL_HAS_UNIVERSAL, SEL_HAS_ID, SEL_HAS_ATTRIBUTE,
  SEL_HAS_PSEUDO_CLASS, SEL_HAS_PSEUDO_ELEMENT, SEL_HAS_NESTING,
  hasFlag,
} from "../entities";

export type { SelectorComplexity };

/**
 * Thresholds for determining if a selector is overly complex.
 */
export interface ComplexityThresholds {
  readonly maxDepth?: number;       // Max combinator depth
  readonly maxBreadth?: number;     // Max compound selectors
  readonly allowIds?: boolean;      // Allow #id selectors
  readonly allowUniversal?: boolean; // Allow * selector
}

/**
 * Default complexity thresholds.
 */
const DEFAULT_THRESHOLDS: Required<ComplexityThresholds> = {
  maxDepth: 4,
  maxBreadth: 5,
  allowIds: true,
  allowUniversal: true,
};

/**
 * Build complexity from pre-parsed data.
 * Used by parseSelectorComplete to avoid duplicate parsing.
 *
 * @param combinators - Array of combinator types found in selector
 * @param hasId - Whether selector contains ID selectors
 * @param hasUniversal - Whether selector contains universal selector
 * @param hasAttribute - Whether selector contains attribute selectors
 * @param hasPseudoClass - Whether selector contains pseudo-classes
 * @param hasPseudoElement - Whether selector contains pseudo-elements
 * @param hasNesting - Whether selector contains nesting
 * @param pseudoClasses - Array of pseudo-class names
 * @param pseudoElements - Array of pseudo-element names
 * @returns Computed selector complexity
 */
export function buildComplexity(
  combinators: CombinatorType[],
  hasId: boolean,
  hasUniversal: boolean,
  hasAttribute: boolean,
  hasPseudoClass: boolean,
  hasPseudoElement: boolean,
  hasNesting: boolean,
  pseudoClasses: string[],
  pseudoElements: string[],
): SelectorComplexity {
  const breadth = combinators.length + 1;
  const depth = combinators.length;

  if (
    depth === 0 &&
    !hasId && !hasUniversal && !hasAttribute &&
    !hasPseudoClass && !hasPseudoElement && !hasNesting
  ) {
    return MINIMAL_COMPLEXITY;
  }

  const flags =
    (hasUniversal ? SEL_HAS_UNIVERSAL : 0) |
    (hasId ? SEL_HAS_ID : 0) |
    (hasAttribute ? SEL_HAS_ATTRIBUTE : 0) |
    (hasPseudoClass ? SEL_HAS_PSEUDO_CLASS : 0) |
    (hasPseudoElement ? SEL_HAS_PSEUDO_ELEMENT : 0) |
    (hasNesting ? SEL_HAS_NESTING : 0);

  if (depth === 0 && flags === 0) return MINIMAL_COMPLEXITY;

  return {
    depth,
    breadth,
    _flags: flags,
    pseudoClasses: pseudoClasses.length > 0 ? pseudoClasses : EMPTY_STRINGS,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : EMPTY_STRINGS,
    combinators: combinators.length > 0 ? combinators : EMPTY_COMBINATORS,
  };
}

/**
 * Convert complexity metrics to a single numeric score for comparison.
 * Higher score = more complex.
 *
 * @param complexity - The complexity metrics
 * @returns A single numeric score
 */
export function complexityToScore(complexity: SelectorComplexity): number {
  let score = 0;

  score += complexity.depth * 10;
  score += complexity.breadth * 5;
  score += hasFlag(complexity._flags, SEL_HAS_ID) ? 20 : 0;
  score += hasFlag(complexity._flags, SEL_HAS_UNIVERSAL) ? 15 : 0;
  score += complexity.pseudoClasses.length * 3;
  score += complexity.pseudoElements.length * 3;
  score += hasFlag(complexity._flags, SEL_HAS_ATTRIBUTE) ? 5 : 0;
  score += hasFlag(complexity._flags, SEL_HAS_NESTING) ? 2 : 0;

  return score;
}

/**
 * Check if a selector exceeds complexity thresholds.
 *
 * @param complexity - The complexity metrics
 * @param thresholds - Optional custom thresholds
 * @returns true if the selector is overly complex
 */
export function isOverlyComplex(
  complexity: SelectorComplexity,
  thresholds: ComplexityThresholds = {},
): boolean {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (complexity.depth > merged.maxDepth) {
    return true;
  }

  if (complexity.breadth > merged.maxBreadth) {
    return true;
  }

  if (!merged.allowIds && hasFlag(complexity._flags, SEL_HAS_ID)) {
    return true;
  }

  if (!merged.allowUniversal && hasFlag(complexity._flags, SEL_HAS_UNIVERSAL)) {
    return true;
  }

  return false;
}

/**
 * Get a list of human-readable reasons why a selector is complex.
 *
 * @param complexity - The complexity metrics
 * @param thresholds - Optional custom thresholds
 * @returns Array of reason strings
 */
export function getComplexityReasons(
  complexity: SelectorComplexity,
  thresholds: ComplexityThresholds = {},
): readonly string[] {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const reasons: string[] = [];

  if (complexity.depth > merged.maxDepth) {
    reasons.push(
      `Exceeds maximum depth of ${merged.maxDepth} (has ${complexity.depth} combinators)`,
    );
  }

  if (complexity.breadth > merged.maxBreadth) {
    reasons.push(
      `Exceeds maximum breadth of ${merged.maxBreadth} (has ${complexity.breadth} compound selectors)`,
    );
  }

  if (!merged.allowIds && hasFlag(complexity._flags, SEL_HAS_ID)) {
    reasons.push("Uses ID selector (not allowed)");
  }

  if (!merged.allowUniversal && hasFlag(complexity._flags, SEL_HAS_UNIVERSAL)) {
    reasons.push("Uses universal selector (not allowed)");
  }

  return reasons;
}

/**
 * Selector info with complexity metrics.
 */
interface SelectorWithComplexity extends SelectorInfo {
  readonly complexity: SelectorComplexity;
}

export function sortByComplexity<T extends SelectorWithComplexity>(
  selectors: readonly T[],
): readonly T[] {
  if (selectors.length <= 1) {
    return selectors;
  }

  const withScores = selectors.map(s => ({
    selector: s,
    score: complexityToScore(s.complexity),
  }));

  withScores.sort((a, b) => b.score - a.score);

  return withScores.map(w => w.selector);
}
