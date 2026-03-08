/**
 * CSS Specificity Types
 */

/**
 * CSS specificity tuple [inline, id, class, element].
 * Inline is always 0 in stylesheets (only 1 for inline styles).
 */
export type Specificity = readonly [number, number, number, number];

/**
 * CSS specificity as a named object.
 */
export interface SpecificityObject {
  inline: number;
  ids: number;
  classes: number;
  elements: number;
}

/**
 * Parsed selector with specificity info (legacy).
 */
export interface SelectorInfo {
  raw: string;
  specificity: Specificity;
}
