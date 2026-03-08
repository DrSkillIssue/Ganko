/**
 * Selector Parsing Utilities
 *
 * Functions for parsing and analyzing CSS selectors.
 */

import {
  CHAR_HASH,
  CHAR_DOT,
  CHAR_OPEN_BRACKET,
  CHAR_CLOSE_BRACKET,
  CHAR_COLON,
  CHAR_AMPERSAND,
  CHAR_ASTERISK,
  CHAR_GT,
  CHAR_PLUS,
  CHAR_TILDE,
  CHAR_OPEN_PAREN,
  CHAR_CLOSE_PAREN,
  CHAR_COMMA,
  isWhitespace,
  isCombinator,
  isAlpha,
  isPseudoNameChar,
  ID_STICKY,
  CLASS_STICKY,
  ATTRIBUTE_STICKY,
  PSEUDO_ELEMENT_STICKY,
  PSEUDO_CLASS_STICKY,
  ELEMENT_STICKY,
  HAS_ID_RE,
  HAS_UNIVERSAL_RE,
  HAS_ATTRIBUTE_RE,
} from "@ganko/shared";

import type { CombinatorType, SelectorComplexity, SelectorPart } from "../entities";
import { MINIMAL_COMPLEXITY } from "../entities";
import { buildComplexity } from "../analysis/complexity";

export type { SelectorPart };

/**
 * Parse a selector string into its component parts.
 *
 * @param raw - The selector string to parse
 * @returns Array of selector parts
 *
 * @example
 * parseSelector("#id.class p::before")
 * // Returns: [
 * //   { type: "id", value: "id", raw: "#id" },
 * //   { type: "class", value: "class", raw: ".class" },
 * //   { type: "element", value: "p", raw: "p" },
 * //   { type: "pseudo-element", value: "before", raw: "::before" }
 * // ]
 */
export function parseSelector(raw: string): SelectorPart[] {
  let start = 0;
  let end = raw.length;
  while (start < end && isWhitespace(raw.charCodeAt(start))) start++;
  while (end > start && isWhitespace(raw.charCodeAt(end - 1))) end--;

  if (start === end) return [];

  // Only create substring if we actually trimmed
  const input = (start === 0 && end === raw.length) ? raw : raw.substring(start, end);
  const len = input.length;

  const parts: SelectorPart[] = [];
  let pos = 0;

  while (pos < len) {
    const char = input.charCodeAt(pos);

    // Skip whitespace and combinators
    if (isWhitespace(char) || isCombinator(char)) {
      pos++;
      continue;
    }

    // Nesting selector (&)
    if (char === CHAR_AMPERSAND) {
      parts.push({ type: "nesting", value: "&", raw: "&" });
      pos++;
      continue;
    }

    // Universal selector (*)
    if (char === CHAR_ASTERISK) {
      parts.push({ type: "universal", value: "*", raw: "*" });
      pos++;
      continue;
    }

    // ID selector (#id)
    if (char === CHAR_HASH) {
      ID_STICKY.lastIndex = pos;
      const match = ID_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "id", value: val, raw: match[0] });
        pos = ID_STICKY.lastIndex;
        continue;
      }
    }

    // Class selector (.class)
    if (char === CHAR_DOT) {
      CLASS_STICKY.lastIndex = pos;
      const match = CLASS_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "class", value: val, raw: match[0] });
        pos = CLASS_STICKY.lastIndex;
        continue;
      }
    }

    // Attribute selector ([attr] or [attr=value])
    if (char === CHAR_OPEN_BRACKET) {
      ATTRIBUTE_STICKY.lastIndex = pos;
      const match = ATTRIBUTE_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "attribute", value: val, raw: match[0] });
        pos = ATTRIBUTE_STICKY.lastIndex;
        continue;
      }
    }

    // Pseudo-element (::before, ::after, etc.) or Pseudo-class (:hover, etc.)
    if (char === CHAR_COLON) {
      // Check for pseudo-element first (::)
      if (pos + 1 < len && input.charCodeAt(pos + 1) === CHAR_COLON) {
        PSEUDO_ELEMENT_STICKY.lastIndex = pos;
        const match = PSEUDO_ELEMENT_STICKY.exec(input);
        if (match) {
          const val = match[1]
          if (!val) break
          parts.push({ type: "pseudo-element", value: val, raw: match[0] });
          pos = PSEUDO_ELEMENT_STICKY.lastIndex;
          continue;
        }
      }

      // Pseudo-class (:hover, :nth-child(n), etc.)
      PSEUDO_CLASS_STICKY.lastIndex = pos;
      const match = PSEUDO_CLASS_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "pseudo-class", value: val, raw: match[0] });
        pos = PSEUDO_CLASS_STICKY.lastIndex;
        continue;
      }
    }

    // Element selector (div, span, etc.) - check if it's a letter
    if (isAlpha(char)) {
      ELEMENT_STICKY.lastIndex = pos;
      const match = ELEMENT_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "element", value: val, raw: match[0] });
        pos = ELEMENT_STICKY.lastIndex;
        continue;
      }
    }

    // Skip unknown character
    pos++;
  }

  return parts;
}

/**
 * Split a comma-separated selector list into individual selectors.
 *
 * @param selectorText - The selector list text
 * @returns Array of individual selector strings
 *
 * @example
 * parseSelectorList("h1, h2, h3")
 * // Returns: ["h1", "h2", "h3"]
 *
 * parseSelectorList(".a, .b:is(.c, .d)")
 * // Returns: [".a", ".b:is(.c, .d)"]
 */
export function parseSelectorList(selectorText: string): string[] {
  const len = selectorText.length;
  if (len === 0) return [];

  // No comma means single selector - skip parsing
  if (selectorText.indexOf(",") === -1) {
    const trimmed = selectorText.trim();
    return trimmed ? [trimmed] : [];
  }

  const selectors: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < len; i++) {
    const char = selectorText.charCodeAt(i);

    if (char === CHAR_OPEN_PAREN) {
      parenDepth++;
    } else if (char === CHAR_CLOSE_PAREN) {
      parenDepth--;
    } else if (char === CHAR_OPEN_BRACKET) {
      bracketDepth++;
    } else if (char === CHAR_CLOSE_BRACKET) {
      bracketDepth--;
    } else if (char === CHAR_COMMA && parenDepth === 0 && bracketDepth === 0) {
      const trimmed = selectorText.substring(start, i).trim();
      if (trimmed) {
        selectors.push(trimmed);
      }
      start = i + 1;
    }
  }

  const trimmed = selectorText.substring(start).trim();
  if (trimmed) {
    selectors.push(trimmed);
  }

  return selectors;
}

/**
 * Normalize a selector by collapsing whitespace and trimming.
 *
 * @param selector - The selector to normalize
 * @returns Normalized selector string
 *
 * @example
 * normalizeSelector("  .foo   >   .bar  ")
 * // Returns: ".foo > .bar"
 */
export function normalizeSelector(selector: string): string {
  const len = selector.length;
  if (len === 0) return "";

  const parts: string[] = [];
  let lastWasSpace = true; // Treat start as space to trim leading whitespace
  let runStart = -1; // Start of current non-whitespace/non-combinator run

  for (let i = 0; i < len; i++) {
    const code = selector.charCodeAt(i);

    if (isWhitespace(code) || isCombinator(code)) {
      // Flush any pending run of regular characters
      if (runStart !== -1) {
        parts.push(selector.substring(runStart, i));
        runStart = -1;
      }

      if (isCombinator(code)) {
        // Normalize combinators to " > ", " + ", " ~ " format
        if (!lastWasSpace) parts.push(" ");
        parts.push(String.fromCharCode(code), " ");
        lastWasSpace = true;
      } else if (!lastWasSpace) {
        parts.push(" ");
        lastWasSpace = true;
      }
    } else {
      if (runStart === -1) runStart = i;
      lastWasSpace = false;
    }
  }

  // Flush final run
  if (runStart !== -1) {
    parts.push(selector.substring(runStart));
  }

  // Trim trailing space if present
  if (lastWasSpace && parts.length > 0) parts.pop();

  return parts.join("");
}

/**
 * Extract combinator types from a selector.
 *
 * @param selector - The selector to analyze
 * @returns Array of combinator types in order
 *
 * @example
 * getSelectorCombinators(".a > .b + .c ~ .d .e")
 * // Returns: ["child", "adjacent", "sibling", "descendant"]
 */
export function getSelectorCombinators(selector: string): CombinatorType[] {
  const len = selector.length;
  if (len === 0) return [];

  const combinators: CombinatorType[] = [];
  let i = 0;
  let inCompound = false; // Track if we've seen non-whitespace/combinator chars

  while (i < len) {
    const code = selector.charCodeAt(i);

    // Skip over compound selector parts (non-whitespace, non-combinator)
    if (!isWhitespace(code) && !isCombinator(code)) {
      inCompound = true;
      i++;
      continue;
    }

    // Only process combinators after we've seen a compound selector
    if (!inCompound) {
      i++;
      continue;
    }

    // Found whitespace or combinator - scan to find what type
    let sawCombinator: CombinatorType | null = null;
    while (i < len) {
      const c = selector.charCodeAt(i);
      if (c === CHAR_GT) {
        sawCombinator = "child";
      } else if (c === CHAR_PLUS) {
        sawCombinator = "adjacent";
      } else if (c === CHAR_TILDE) {
        sawCombinator = "sibling";
      } else if (!isWhitespace(c)) {
        // Hit the next compound selector
        break;
      }
      i++;
    }

    // Only add combinator if there's another compound selector after it
    if (i < len) {
      combinators.push(sawCombinator ?? "descendant");
      inCompound = false; // Reset for next compound
    }
  }

  return combinators;
}

/**
 * Check if a selector contains a pseudo-class (single colon, not double).
 *
 * @param selector - The selector to check
 * @returns True if the selector contains a pseudo-class
 */
export function hasPseudoClass(selector: string): boolean {
  const len = selector.length;
  for (let i = 0; i < len; i++) {
    if (selector.charCodeAt(i) === CHAR_COLON) {
      // Check it's not a pseudo-element (::)
      if (i + 1 >= len || selector.charCodeAt(i + 1) !== CHAR_COLON) {
        // Check it's not preceded by another colon (part of ::)
        if (i === 0 || selector.charCodeAt(i - 1) !== CHAR_COLON) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if a selector contains a pseudo-element.
 *
 * @param selector - The selector to check
 * @returns True if the selector contains a pseudo-element
 */
export function hasPseudoElement(selector: string): boolean {
  for (let i = 0, len = selector.length - 1; i < len; i++) {
    if (selector.charCodeAt(i) === CHAR_COLON && selector.charCodeAt(i + 1) === CHAR_COLON) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a selector contains an ID selector.
 *
 * @param selector - The selector to check
 * @returns True if the selector contains an ID selector
 */
export function hasIdSelector(selector: string): boolean {
  if (selector.indexOf("#") === -1) return false;
  return HAS_ID_RE.test(selector);
}

/**
 * Check if a selector contains a universal selector.
 *
 * @param selector - The selector to check
 * @returns True if the selector contains a universal selector
 */
export function hasUniversalSelector(selector: string): boolean {
  if (selector.indexOf("*") === -1) return false;
  return selector === "*" || HAS_UNIVERSAL_RE.test(selector);
}

/**
 * Check if a selector contains an attribute selector.
 *
 * @param selector - The selector to check
 * @returns True if the selector contains an attribute selector
 */
export function hasAttributeSelector(selector: string): boolean {
  if (selector.indexOf("[") === -1) return false;
  return HAS_ATTRIBUTE_RE.test(selector);
}

/**
 * Check if a selector contains a nesting selector (&).
 *
 * @param selector - The selector to check
 * @returns True if the selector contains a nesting selector
 */
export function hasNestingSelector(selector: string): boolean {
  return selector.indexOf("&") !== -1;
}

/**
 * Extract all pseudo-classes from a selector.
 *
 * @param selector - The selector to analyze
 * @returns Array of pseudo-class names (without the colon)
 *
 * @example
 * extractPseudoClasses(":hover:focus:not(.disabled)")
 * // Returns: ["hover", "focus", "not"]
 */
export function extractPseudoClasses(selector: string): string[] {
  const len = selector.length;
  const pseudoClasses: string[] = [];

  for (let i = 0; i < len; i++) {
    if (selector.charCodeAt(i) === CHAR_COLON) {
      // Skip if preceded by colon (it's the second colon of ::)
      if (i > 0 && selector.charCodeAt(i - 1) === CHAR_COLON) continue;
      // Skip if followed by colon (it's the first colon of ::)
      if (i + 1 < len && selector.charCodeAt(i + 1) === CHAR_COLON) continue;

      // Extract the pseudo-class name (a-z, A-Z, -)
      let j = i + 1;
      while (j < len) {
        const c = selector.charCodeAt(j);
        if (!isPseudoNameChar(c)) break;
        j++;
      }
      if (j > i + 1) {
        pseudoClasses.push(selector.substring(i + 1, j));
      }
    }
  }

  return pseudoClasses;
}

/**
 * Extract all pseudo-elements from a selector.
 *
 * @param selector - The selector to analyze
 * @returns Array of pseudo-element names (without the colons)
 *
 * @example
 * extractPseudoElements("::before::after")
 * // Returns: ["before", "after"]
 */
export function extractPseudoElements(selector: string): string[] {
  const len = selector.length;
  const pseudoElements: string[] = [];

  for (let i = 0; i < len - 1; i++) {
    // Look for ::
    if (selector.charCodeAt(i) === CHAR_COLON && selector.charCodeAt(i + 1) === CHAR_COLON) {
      // Extract the pseudo-element name (a-z, A-Z, -)
      let j = i + 2;
      while (j < len) {
        const c = selector.charCodeAt(j);
        if (!isPseudoNameChar(c)) break;
        j++;
      }
      if (j > i + 2) {
        pseudoElements.push(selector.substring(i + 2, j));
        i = j - 1; // Skip past this pseudo-element
      }
    }
  }

  return pseudoElements;
}



import type { Specificity } from "../entities";

/**
 * Result of complete selector parsing with specificity and complexity.
 */
export interface ParseSelectorCompleteResult {
  parts: SelectorPart[];
  combinators: CombinatorType[];
  specificity: Specificity;
  complexity: SelectorComplexity;
}

/**
 * Parse a selector to extract parts, combinators, and specificity.
 *
 * @param raw - The selector string to parse
 * @returns Object containing parts, combinators, and specificity
 */
export function parseSelectorComplete(raw: string): ParseSelectorCompleteResult {
  let start = 0;
  let end = raw.length;
  while (start < end && isWhitespace(raw.charCodeAt(start))) start++;
  while (end > start && isWhitespace(raw.charCodeAt(end - 1))) end--;

  if (start === end) {
    return { parts: [], combinators: [], specificity: [0, 0, 0, 0] as const, complexity: MINIMAL_COMPLEXITY };
  }

  // Only create substring if we actually trimmed
  const input = (start === 0 && end === raw.length) ? raw : raw.substring(start, end);
  const len = input.length;

  const parts: SelectorPart[] = [];
  const combinators: CombinatorType[] = [];

  // Specificity counters
  let ids = 0;
  let classes = 0;
  let elements = 0;

  // Complexity tracking
  let hasId = false;
  let hasUniversal = false;
  let hasAttribute = false;
  let hasPseudoClassFlag = false;
  let hasPseudoElementFlag = false;
  let hasNesting = false;
  const pseudoClasses: string[] = [];
  const pseudoElements: string[] = [];

  let pos = 0;
  let inCompound = false;

  while (pos < len) {
    const char = input.charCodeAt(pos);

    // Handle whitespace and combinators
    if (isWhitespace(char) || isCombinator(char)) {
      if (inCompound) {
        let sawCombinator: CombinatorType | null = null;
        let scanPos = pos;

        while (scanPos < len) {
          const c = input.charCodeAt(scanPos);
          if (c === CHAR_GT) {
            sawCombinator = "child";
            scanPos++;
          } else if (c === CHAR_PLUS) {
            sawCombinator = "adjacent";
            scanPos++;
          } else if (c === CHAR_TILDE) {
            sawCombinator = "sibling";
            scanPos++;
          } else if (isWhitespace(c)) {
            scanPos++;
          } else {
            break;
          }
        }

        if (scanPos < len) {
          combinators.push(sawCombinator ?? "descendant");
          inCompound = false;
        }
        pos = scanPos;
        continue;
      }
      pos++;
      continue;
    }

    inCompound = true;

    // Nesting selector (&)
    if (char === CHAR_AMPERSAND) {
      parts.push({ type: "nesting", value: "&", raw: "&" });
      hasNesting = true;
      pos++;
      continue;
    }

    // Universal selector (*) - no specificity contribution
    if (char === CHAR_ASTERISK) {
      parts.push({ type: "universal", value: "*", raw: "*" });
      hasUniversal = true;
      pos++;
      continue;
    }

    // ID selector (#id)
    if (char === CHAR_HASH) {
      ID_STICKY.lastIndex = pos;
      const match = ID_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "id", value: val, raw: match[0] });
        ids++;
        hasId = true;
        pos = ID_STICKY.lastIndex;
        continue;
      }
    }

    // Class selector (.class)
    if (char === CHAR_DOT) {
      CLASS_STICKY.lastIndex = pos;
      const match = CLASS_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "class", value: val, raw: match[0] });
        classes++;
        pos = CLASS_STICKY.lastIndex;
        continue;
      }
    }

    // Attribute selector ([attr])
    if (char === CHAR_OPEN_BRACKET) {
      ATTRIBUTE_STICKY.lastIndex = pos;
      const match = ATTRIBUTE_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "attribute", value: val, raw: match[0] });
        classes++; // Attributes count as class-level specificity
        hasAttribute = true;
        pos = ATTRIBUTE_STICKY.lastIndex;
        continue;
      }
    }

    // Pseudo-element (::before) or Pseudo-class (:hover)
    if (char === CHAR_COLON) {
      // Check for pseudo-element first (::)
      if (pos + 1 < len && input.charCodeAt(pos + 1) === CHAR_COLON) {
        PSEUDO_ELEMENT_STICKY.lastIndex = pos;
        const match = PSEUDO_ELEMENT_STICKY.exec(input);
        if (match) {
          const val = match[1]
          if (!val) break
          parts.push({ type: "pseudo-element", value: val, raw: match[0] });
          elements++; // Pseudo-elements count as element-level
          hasPseudoElementFlag = true;
          pseudoElements.push(val);
          pos = PSEUDO_ELEMENT_STICKY.lastIndex;
          continue;
        }
      }

      // Pseudo-class - need to handle :is/:not/:has specially for specificity
      // Also need to handle functional pseudo-classes with parentheses
      const pseudoStart = pos;

      // Extract the pseudo-class name first
      let nameEnd = pos + 1;
      while (nameEnd < len) {
        const c = input.charCodeAt(nameEnd);
        if (!isPseudoNameChar(c)) break;
        nameEnd++;
      }

      if (nameEnd > pos + 1) {
        const pseudoName = input.substring(pos + 1, nameEnd).toLowerCase();

        // Check if this is a functional pseudo-class with parentheses
        if (nameEnd < len && input.charCodeAt(nameEnd) === CHAR_OPEN_PAREN) {
          // Find matching closing paren
          let parenDepth = 1;
          let argEnd = nameEnd + 1;
          while (argEnd < len && parenDepth > 0) {
            const c = input.charCodeAt(argEnd);
            if (c === CHAR_OPEN_PAREN) parenDepth++;
            else if (c === CHAR_CLOSE_PAREN) parenDepth--;
            argEnd++;
          }

          const fullMatch = input.substring(pseudoStart, argEnd);
          const argContent = input.substring(nameEnd + 1, argEnd - 1);

          // Handle :where() - 0 specificity
          if (pseudoName === "where") {
            parts.push({ type: "pseudo-class", value: pseudoName, raw: fullMatch });
            hasPseudoClassFlag = true;
            pseudoClasses.push(pseudoName);
          } else if (pseudoName === "is" || pseudoName === "not" || pseudoName === "has") {
            // Handle :is(), :not(), :has() - takes highest specificity of arguments
            parts.push({ type: "pseudo-class", value: pseudoName, raw: fullMatch });
            hasPseudoClassFlag = true;
            pseudoClasses.push(pseudoName);

            // Split arguments by comma (respecting nesting) and find highest specificity
            const args = splitPseudoArgs(argContent);
            let maxIds = 0, maxClasses = 0, maxElements = 0;

            for (const arg of args) {
              const trimmed = arg.trim();
              if (trimmed) {
                const { specificity: argSpec } = parseSelectorComplete(trimmed);
                if (argSpec[1] > maxIds ||
                    (argSpec[1] === maxIds && argSpec[2] > maxClasses) ||
                    (argSpec[1] === maxIds && argSpec[2] === maxClasses && argSpec[3] > maxElements)) {
                  maxIds = argSpec[1];
                  maxClasses = argSpec[2];
                  maxElements = argSpec[3];
                }
              }
            }

            ids += maxIds;
            classes += maxClasses;
            elements += maxElements;
          } else {
            // Other functional pseudo-classes (e.g., :nth-child) count as class-level
            parts.push({ type: "pseudo-class", value: pseudoName, raw: fullMatch });
            hasPseudoClassFlag = true;
            pseudoClasses.push(pseudoName);
            classes++;
          }

          pos = argEnd;
          continue;
        }

        // Non-functional pseudo-class
        const rawMatch = input.substring(pseudoStart, nameEnd);
        parts.push({ type: "pseudo-class", value: pseudoName, raw: rawMatch });
        hasPseudoClassFlag = true;
        pseudoClasses.push(pseudoName);
        classes++; // Regular pseudo-classes count as class-level
        pos = nameEnd;
        continue;
      }
    }

    // Element selector (div, span)
    if (isAlpha(char)) {
      ELEMENT_STICKY.lastIndex = pos;
      const match = ELEMENT_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        parts.push({ type: "element", value: val, raw: match[0] });
        elements++;
        pos = ELEMENT_STICKY.lastIndex;
        continue;
      }
    }

    pos++;
  }

  const complexity = buildComplexity(
    combinators,
    hasId,
    hasUniversal,
    hasAttribute,
    hasPseudoClassFlag,
    hasPseudoElementFlag,
    hasNesting,
    pseudoClasses,
    pseudoElements,
  );

  return {
    parts,
    combinators,
    specificity: [0, ids, classes, elements] as const,
    complexity,
  };
}

/**
 * Split pseudo-class arguments by comma, respecting nesting.
 * Handles nested parentheses and brackets within arguments.
 *
 * @param content - The argument content to split
 * @returns Array of individual arguments
 *
 * @example
 * splitPseudoArgs(".a, .b")  // Returns: [".a", ".b"]
 * splitPseudoArgs(":is(.a, .b), .c")  // Returns: [":is(.a, .b)", ".c"]
 */
function splitPseudoArgs(content: string): string[] {
  const result: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    if (c === CHAR_OPEN_PAREN) parenDepth++;
    else if (c === CHAR_CLOSE_PAREN) parenDepth--;
    else if (c === CHAR_OPEN_BRACKET) bracketDepth++;
    else if (c === CHAR_CLOSE_BRACKET) bracketDepth--;
    else if (c === CHAR_COMMA && parenDepth === 0 && bracketDepth === 0) {
      result.push(content.substring(start, i));
      start = i + 1;
    }
  }

  result.push(content.substring(start));
  return result;
}


