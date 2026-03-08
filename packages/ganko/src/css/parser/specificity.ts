/**
 * CSS Specificity Calculator
 *
 * Calculates specificity for CSS selectors.
 */

import {
  CHAR_HASH,
  CHAR_DOT,
  CHAR_OPEN_BRACKET,
  CHAR_COLON,
  CHAR_OPEN_PAREN,
  CHAR_ASTERISK,
  isIdentStart,
  isIdentChar,
  isWhitespaceOrCombinator,
  findClosingParenRobust,
  findClosingBracketRobust,
  extractParenContent,
  splitByCommaRobust,
  matchesLowercase,
} from "@ganko/shared";
import type { Specificity, SelectorInfo } from "../entities/specificity";

export type { Specificity };

/**
 * Skip past an identifier, returning the new position.
 * An identifier consists of characters that match isIdentChar.
 *
 * @param selector - The selector string to parse
 * @param start - The starting position in the string
 * @returns The position after the identifier ends
 */
function skipIdentifier(selector: string, start: number): number {
  const len = selector.length;
  let i = start;
  while (i < len && isIdentChar(selector.charCodeAt(i))) {
    i++;
  }
  return i;
}

/**
 * Calculate CSS specificity for a selector.
 * Returns [inline, id, class, element] tuple.
 *
 * @example
 * calculateSpecificity("#id")          // [0, 1, 0, 0]
 * calculateSpecificity(".class")       // [0, 0, 1, 0]
 * calculateSpecificity("div")          // [0, 0, 0, 1]
 * calculateSpecificity("#id .class p") // [0, 1, 1, 1]
 * calculateSpecificity(":where(.x)")   // [0, 0, 0, 0] - :where has 0 specificity
 * calculateSpecificity(":is(.x, #y)")  // [0, 1, 0, 0] - :is takes highest
 *
 * @param selector - CSS selector string to calculate specificity for
 * @returns Specificity tuple [inline, ids, classes, elements]
 */
export function calculateSpecificity(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let elements = 0;

  const len = selector.length;
  let i = 0;

  while (i < len) {
    const ch = selector.charCodeAt(i);

    // Skip whitespace and combinators
    if (isWhitespaceOrCombinator(ch)) {
      i++;
      continue;
    }

    // ID selector: #name
    if (ch === CHAR_HASH) {
      ids++;
      i = skipIdentifier(selector, i + 1);
      continue;
    }

    // Class selector: .name
    if (ch === CHAR_DOT) {
      classes++;
      i = skipIdentifier(selector, i + 1);
      continue;
    }

    // Attribute selector: [...]
    if (ch === CHAR_OPEN_BRACKET) {
      classes++;
      i = findClosingBracketRobust(selector, i + 1);
      continue;
    }

    // Universal selector: *
    if (ch === CHAR_ASTERISK) {
      i++;
      continue;
    }

    // Pseudo: : or ::
    if (ch === CHAR_COLON) {
      // Check for pseudo-element ::
      if (i + 1 < len && selector.charCodeAt(i + 1) === CHAR_COLON) {
        elements++;
        i = skipIdentifier(selector, i + 2);
        continue;
      }

      // Pseudo-class - read the name
      const nameStart = i + 1;
      const nameEnd = skipIdentifier(selector, nameStart);
      const nameLen = nameEnd - nameStart;

      // Check for special pseudo-classes: where, is, not, has
      if (nameLen === 5 && matchesLowercase(selector, nameStart, "where")) {
        // :where(...) - 0 specificity, skip the content
        if (nameEnd < len && selector.charCodeAt(nameEnd) === CHAR_OPEN_PAREN) {
          i = findClosingParenRobust(selector, nameEnd + 1);
        } else {
          i = nameEnd;
        }
        continue;
      }

      if (
        (nameLen === 2 && matchesLowercase(selector, nameStart, "is")) ||
        (nameLen === 3 && (matchesLowercase(selector, nameStart, "not") || matchesLowercase(selector, nameStart, "has")))
      ) {
        // :is(), :not(), :has() - take the highest specificity argument
        if (nameEnd < len && selector.charCodeAt(nameEnd) === CHAR_OPEN_PAREN) {
          const [content, endPos] = extractParenContent(selector, nameEnd + 1);
          const args = splitByCommaRobust(content);

          let maxIds = 0;
          let maxClasses = 0;
          let maxElements = 0;

          for (let j = 0; j < args.length; j++) {
            const arg = args[j];
            if (!arg) continue;
            const [, argIds, argClasses, argElements] = calculateSpecificity(arg);
            // Compare specificity tuples
            if (
              argIds > maxIds ||
              (argIds === maxIds && argClasses > maxClasses) ||
              (argIds === maxIds && argClasses === maxClasses && argElements > maxElements)
            ) {
              maxIds = argIds;
              maxClasses = argClasses;
              maxElements = argElements;
            }
          }

          ids += maxIds;
          classes += maxClasses;
          elements += maxElements;
          i = endPos;
        } else {
          i = nameEnd;
        }
        continue;
      }

      // Regular pseudo-class (e.g., :hover, :first-child, :nth-child(2n+1))
      classes++;
      i = nameEnd;

      // Skip function arguments if present
      if (i < len && selector.charCodeAt(i) === CHAR_OPEN_PAREN) {
        i = findClosingParenRobust(selector, i + 1);
      }
      continue;
    }

    // Element name (starts with letter or hyphen/underscore for custom elements)
    if (isIdentStart(ch)) {
      elements++;
      i = skipIdentifier(selector, i);
      continue;
    }

    // Unknown character, skip
    i++;
  }

  return [0, ids, classes, elements] as const;
}

/**
 * Compare two specificities.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Compares each component in order: inline, ids, classes, elements.
 *
 * @param a - The first specificity tuple
 * @param b - The second specificity tuple
 * @returns Negative if a < b, positive if a > b, 0 if equal
 *
 * @example
 * compareSpecificity([0, 1, 0, 0], [0, 0, 1, 0])  // > 0 (id beats class)
 * compareSpecificity([0, 0, 1, 0], [0, 0, 1, 0])  // 0 (equal)
 */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  return a[3] - b[3];
}

/**
 * Format specificity as a string in the form (inline,id,class,element).
 *
 * @param spec - The specificity tuple to format
 * @returns Formatted string representation
 *
 * @example
 * formatSpecificity([0, 1, 2, 3])  // "(0,1,2,3)"
 * formatSpecificity([0, 0, 1, 0])  // "(0,0,1,0)"
 */
export function formatSpecificity(spec: Specificity): string {
  return `(${spec[0]},${spec[1]},${spec[2]},${spec[3]})`;
}

/**
 * Convert specificity to a single numeric score for sorting/comparison.
 * Higher score = higher specificity.
 *
 * Uses weighted formula to ensure each column doesn't overflow into the next.
 * The weights are chosen to handle reasonable selector specificity values
 * (up to 99 in each column except inline).
 *
 * Formula: inline * 1,000,000 + ids * 10,000 + classes * 100 + elements
 *
 * @param specificity - The specificity tuple [inline, ids, classes, elements]
 * @returns A single numeric score
 *
 * @example
 * specificityToScore([0, 1, 0, 0])    // 10000
 * specificityToScore([0, 0, 1, 0])    // 100
 * specificityToScore([0, 0, 0, 1])    // 1
 * specificityToScore([0, 1, 2, 3])    // 10203
 * specificityToScore([1, 0, 0, 0])    // 1000000 (inline style)
 */
export function specificityToScore(specificity: Specificity): number {
  return (
    specificity[0] * 1_000_000 +
    specificity[1] * 10_000 +
    specificity[2] * 100 +
    specificity[3]
  );
}

export function isHigherSpecificity(a: Specificity, b: Specificity): boolean {
  return compareSpecificity(a, b) > 0;
}

export function sortBySpecificity<T extends SelectorInfo>(selectors: readonly T[]): readonly T[] {
  return selectors.toSorted((a, b) => compareSpecificity(b.specificity, a.specificity));
}
