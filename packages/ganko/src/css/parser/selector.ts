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
  isIdentChar,
  isHexDigit,
  ID_STICKY,
  CLASS_STICKY,
  ATTRIBUTE_STICKY,
  PSEUDO_ELEMENT_STICKY,
  PSEUDO_CLASS_STICKY,
  ELEMENT_STICKY,
  HAS_ID_RE,
  HAS_UNIVERSAL_RE,
  HAS_ATTRIBUTE_RE,
} from "@drskillissue/ganko-shared";

import type { CombinatorType, SelectorComplexity, SelectorPart, SelectorCompound, SelectorAttributeConstraint, ParsedPseudoConstraint, NthPattern } from "../entities";
import { MINIMAL_COMPLEXITY, PseudoConstraintKind } from "../entities";
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

const CHAR_BACKSLASH = 92

function readCssIdentifier(input: string, start: number): { value: string; end: number } | null {
  const length = input.length
  let i = start
  let hasEscape = false

  while (i < length) {
    const code = input.charCodeAt(i)
    if (code === CHAR_BACKSLASH) {
      if (i + 1 >= length) break
      hasEscape = true
      i = skipCssEscape(input, i + 1)
      continue
    }
    if (!isIdentChar(code)) break
    i++
  }

  if (i === start) return null

  if (!hasEscape) {
    return { value: input.slice(start, i), end: i }
  }

  const parts: string[] = []
  let j = start
  while (j < i) {
    const code = input.charCodeAt(j)
    if (code !== CHAR_BACKSLASH) {
      parts.push(String.fromCharCode(code))
      j++
      continue
    }
    j++
    if (j >= i) break
    const first = input.charCodeAt(j)
    if (!isHexDigit(first)) {
      parts.push(String.fromCharCode(first))
      j++
      continue
    }
    const hexStart = j
    const maxHex = Math.min(j + 6, i)
    while (j < maxHex && isHexDigit(input.charCodeAt(j))) j++
    const codePoint = Number.parseInt(input.slice(hexStart, j), 16)
    if (codePoint > 0 && codePoint <= 0x10FFFF) parts.push(String.fromCodePoint(codePoint))
    if (j < i && isWhitespace(input.charCodeAt(j))) j++
  }

  return { value: parts.join(""), end: i }
}

function skipCssEscape(input: string, afterBackslash: number): number {
  const length = input.length
  if (afterBackslash >= length) return afterBackslash
  const first = input.charCodeAt(afterBackslash)
  if (!isHexDigit(first)) return afterBackslash + 1
  let end = afterBackslash + 1
  const maxHex = Math.min(afterBackslash + 6, length)
  while (end < maxHex && isHexDigit(input.charCodeAt(end))) end++
  if (end < length && isWhitespace(input.charCodeAt(end))) end++
  return end
}

const ATTRIBUTE_EXISTS_RE = /^[-_a-zA-Z][-_a-zA-Z0-9]*$/
const ATTRIBUTE_CONSTRAINT_RE = /^([-_a-zA-Z][-_a-zA-Z0-9]*)\s*(=|~=|\|=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?:\s+([iIsS]))?$/
const MAX_PSEUDO_PARSE_DEPTH = 4

/**
 * Result of complete selector parsing with specificity and complexity.
 */
export interface ParseSelectorCompleteResult {
  parts: SelectorPart[];
  compounds: readonly SelectorCompound[];
  combinators: CombinatorType[];
  specificity: Specificity;
  complexity: SelectorComplexity;
}

/**
 * Parse a selector to extract parts, compounds, combinators, and specificity.
 */
export function parseSelectorComplete(raw: string, _depth?: number): ParseSelectorCompleteResult {
  let start = 0;
  let end = raw.length;
  while (start < end && isWhitespace(raw.charCodeAt(start))) start++;
  while (end > start && isWhitespace(raw.charCodeAt(end - 1))) end--;

  if (start === end) {
    return { parts: [], compounds: [], combinators: [], specificity: [0, 0, 0, 0] as const, complexity: MINIMAL_COMPLEXITY };
  }

  const input = (start === 0 && end === raw.length) ? raw : raw.substring(start, end);
  const len = input.length;

  const allParts: SelectorPart[] = [];
  let currentCompoundParts: SelectorPart[] = [];
  const combinators: CombinatorType[] = [];
  const compounds: SelectorCompound[] = [];

  let ids = 0;
  let classes = 0;
  let elements = 0;

  let hasId = false;
  let hasUniversal = false;
  let hasAttribute = false;
  let hasPseudoClassFlag = false;
  let hasPseudoElementFlag = false;
  let hasNesting = false;
  const pseudoClassNames: string[] = [];
  const pseudoElementNames: string[] = [];

  let pos = 0;
  let inCompound = false;
  const depth = _depth ?? 0;

  while (pos < len) {
    const char = input.charCodeAt(pos);

    if (isWhitespace(char) || isCombinator(char)) {
      if (inCompound) {
        let sawCombinator: CombinatorType | null = null;
        let scanPos = pos;

        while (scanPos < len) {
          const c = input.charCodeAt(scanPos);
          if (c === CHAR_GT) { sawCombinator = "child"; scanPos++; }
          else if (c === CHAR_PLUS) { sawCombinator = "adjacent"; scanPos++; }
          else if (c === CHAR_TILDE) { sawCombinator = "sibling"; scanPos++; }
          else if (isWhitespace(c)) { scanPos++; }
          else { break; }
        }

        if (scanPos < len) {
          compounds.push(finalizeCompound(currentCompoundParts, depth));
          currentCompoundParts = [];
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

    if (char === CHAR_AMPERSAND) {
      const part: SelectorPart = { type: "nesting", value: "&", raw: "&" };
      allParts.push(part);
      currentCompoundParts.push(part);
      hasNesting = true;
      pos++;
      continue;
    }

    if (char === CHAR_ASTERISK) {
      const part: SelectorPart = { type: "universal", value: "*", raw: "*" };
      allParts.push(part);
      currentCompoundParts.push(part);
      hasUniversal = true;
      pos++;
      continue;
    }

    if (char === CHAR_HASH) {
      ID_STICKY.lastIndex = pos;
      const match = ID_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        const ident = readCssIdentifier(input, pos + 1)
        const idVal = ident ? ident.value : val
        const idRaw = ident ? input.slice(pos, ident.end) : match[0]
        const idEnd = ident ? ident.end : ID_STICKY.lastIndex
        const part: SelectorPart = { type: "id", value: idVal, raw: idRaw };
        allParts.push(part);
        currentCompoundParts.push(part);
        ids++;
        hasId = true;
        pos = idEnd;
        continue;
      }
      const ident = readCssIdentifier(input, pos + 1)
      if (ident) {
        const part: SelectorPart = { type: "id", value: ident.value, raw: input.slice(pos, ident.end) };
        allParts.push(part);
        currentCompoundParts.push(part);
        ids++;
        hasId = true;
        pos = ident.end;
        continue;
      }
    }

    if (char === CHAR_DOT) {
      CLASS_STICKY.lastIndex = pos;
      const match = CLASS_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        const ident = readCssIdentifier(input, pos + 1)
        const clsVal = ident ? ident.value : val
        const clsRaw = ident ? input.slice(pos, ident.end) : match[0]
        const clsEnd = ident ? ident.end : CLASS_STICKY.lastIndex
        const part: SelectorPart = { type: "class", value: clsVal, raw: clsRaw };
        allParts.push(part);
        currentCompoundParts.push(part);
        classes++;
        pos = clsEnd;
        continue;
      }
      const ident = readCssIdentifier(input, pos + 1)
      if (ident) {
        const part: SelectorPart = { type: "class", value: ident.value, raw: input.slice(pos, ident.end) };
        allParts.push(part);
        currentCompoundParts.push(part);
        classes++;
        pos = ident.end;
        continue;
      }
    }

    if (char === CHAR_OPEN_BRACKET) {
      ATTRIBUTE_STICKY.lastIndex = pos;
      const match = ATTRIBUTE_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        const part: SelectorPart = { type: "attribute", value: val, raw: match[0] };
        allParts.push(part);
        currentCompoundParts.push(part);
        classes++;
        hasAttribute = true;
        pos = ATTRIBUTE_STICKY.lastIndex;
        continue;
      }
    }

    if (char === CHAR_COLON) {
      if (pos + 1 < len && input.charCodeAt(pos + 1) === CHAR_COLON) {
        PSEUDO_ELEMENT_STICKY.lastIndex = pos;
        const match = PSEUDO_ELEMENT_STICKY.exec(input);
        if (match) {
          const val = match[1]
          if (!val) break
          const part: SelectorPart = { type: "pseudo-element", value: val, raw: match[0] };
          allParts.push(part);
          currentCompoundParts.push(part);
          elements++;
          hasPseudoElementFlag = true;
          pseudoElementNames.push(val);
          pos = PSEUDO_ELEMENT_STICKY.lastIndex;
          continue;
        }
      }

      const pseudoStart = pos;
      let nameEnd = pos + 1;
      while (nameEnd < len) {
        const c = input.charCodeAt(nameEnd);
        if (!isPseudoNameChar(c)) break;
        nameEnd++;
      }

      if (nameEnd > pos + 1) {
        const pseudoName = input.substring(pos + 1, nameEnd).toLowerCase();

        if (nameEnd < len && input.charCodeAt(nameEnd) === CHAR_OPEN_PAREN) {
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

          if (pseudoName === "where") {
            const part: SelectorPart = { type: "pseudo-class", value: pseudoName, raw: fullMatch };
            allParts.push(part);
            currentCompoundParts.push(part);
            hasPseudoClassFlag = true;
            pseudoClassNames.push(pseudoName);
          } else if (pseudoName === "is" || pseudoName === "not" || pseudoName === "has") {
            const part: SelectorPart = { type: "pseudo-class", value: pseudoName, raw: fullMatch };
            allParts.push(part);
            currentCompoundParts.push(part);
            hasPseudoClassFlag = true;
            pseudoClassNames.push(pseudoName);

            const args = splitPseudoArgs(argContent);
            let maxIds = 0, maxClasses = 0, maxElements = 0;

            for (let ai = 0; ai < args.length; ai++) {
              const arg = args[ai];
              if (!arg) continue;
              const trimmed = arg.trim();
              if (trimmed) {
                const { specificity: argSpec } = parseSelectorComplete(trimmed, depth + 1);
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
            const part: SelectorPart = { type: "pseudo-class", value: pseudoName, raw: fullMatch };
            allParts.push(part);
            currentCompoundParts.push(part);
            hasPseudoClassFlag = true;
            pseudoClassNames.push(pseudoName);
            classes++;
          }

          pos = argEnd;
          continue;
        }

        const rawMatch = input.substring(pseudoStart, nameEnd);
        const part: SelectorPart = { type: "pseudo-class", value: pseudoName, raw: rawMatch };
        allParts.push(part);
        currentCompoundParts.push(part);
        hasPseudoClassFlag = true;
        pseudoClassNames.push(pseudoName);
        classes++;
        pos = nameEnd;
        continue;
      }
    }

    if (isAlpha(char)) {
      ELEMENT_STICKY.lastIndex = pos;
      const match = ELEMENT_STICKY.exec(input);
      if (match) {
        const val = match[1]
        if (!val) break
        const part: SelectorPart = { type: "element", value: val, raw: match[0] };
        allParts.push(part);
        currentCompoundParts.push(part);
        elements++;
        pos = ELEMENT_STICKY.lastIndex;
        continue;
      }
    }

    pos++;
  }

  if (currentCompoundParts.length > 0) {
    compounds.push(finalizeCompound(currentCompoundParts, depth));
  }

  const complexity = buildComplexity(
    combinators,
    hasId,
    hasUniversal,
    hasAttribute,
    hasPseudoClassFlag,
    hasPseudoElementFlag,
    hasNesting,
    pseudoClassNames,
    pseudoElementNames,
  );

  return {
    parts: allParts,
    compounds,
    combinators,
    specificity: [0, ids, classes, elements] as const,
    complexity,
  };
}

function finalizeCompound(parts: readonly SelectorPart[], depth: number): SelectorCompound {
  let tagName: string | null = null;
  let idValue: string | null = null;
  const classes: string[] = [];
  const seenClasses = new Set<string>();
  const attributes: SelectorAttributeConstraint[] = [];
  const pseudoClasses: ParsedPseudoConstraint[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.type === "element") {
      tagName = part.value.toLowerCase();
    } else if (part.type === "id") {
      idValue = part.value;
    } else if (part.type === "class") {
      if (!seenClasses.has(part.value)) {
        seenClasses.add(part.value);
        classes.push(part.value);
      }
    } else if (part.type === "attribute") {
      const constraint = parseAttributeConstraintFromRaw(part.value);
      if (constraint) attributes.push(constraint);
    } else if (part.type === "pseudo-class") {
      const parsed = parsePseudoToParsedConstraint(part.value, part.raw, depth);
      if (parsed) pseudoClasses.push(parsed);
    }
  }

  return { parts, tagName, idValue, classes, attributes, pseudoClasses };
}

function parseAttributeConstraintFromRaw(raw: string): SelectorAttributeConstraint | null {
  const trimmed = raw.trim();
  const constrained = ATTRIBUTE_CONSTRAINT_RE.exec(trimmed);

  if (constrained) {
    const operatorToken = constrained[2];
    if (!operatorToken) return null;
    const operator = mapAttrOperator(operatorToken);
    if (operator === null) return null;
    const value = constrained[3] ?? constrained[4] ?? constrained[5] ?? null;
    if (value === null) return null;
    const nameToken = constrained[1];
    if (!nameToken) return null;
    return {
      name: nameToken.toLowerCase(),
      operator,
      value,
      caseInsensitive: (constrained[6] ?? "").toLowerCase() === "i",
    };
  }

  if (!ATTRIBUTE_EXISTS_RE.test(trimmed)) return null;
  return { name: trimmed.toLowerCase(), operator: "exists", value: null, caseInsensitive: false };
}

function mapAttrOperator(op: string): SelectorAttributeConstraint["operator"] | null {
  if (op === "=") return "equals";
  if (op === "~=") return "includes-word";
  if (op === "|=") return "dash-prefix";
  if (op === "^=") return "prefix";
  if (op === "$=") return "suffix";
  if (op === "*=") return "contains";
  return null;
}

function parsePseudoToParsedConstraint(name: string, raw: string, depth: number): ParsedPseudoConstraint | null {
  const lowerName = name.toLowerCase();

  if (lowerName === "first-child") return { name: lowerName, raw, kind: PseudoConstraintKind.FirstChild, nthPattern: null, nestedCompounds: null };
  if (lowerName === "last-child") return { name: lowerName, raw, kind: PseudoConstraintKind.LastChild, nthPattern: null, nestedCompounds: null };
  if (lowerName === "only-child") return { name: lowerName, raw, kind: PseudoConstraintKind.OnlyChild, nthPattern: null, nestedCompounds: null };

  const parenIdx = raw.indexOf("(");
  if (parenIdx === -1) {
    return { name: lowerName, raw, kind: PseudoConstraintKind.Simple, nthPattern: null, nestedCompounds: null };
  }

  const argContent = raw.substring(parenIdx + 1, raw.length - 1);

  if (lowerName === "nth-child") {
    const pattern = parseNthPatternFromArg(argContent);
    return pattern ? { name: lowerName, raw, kind: PseudoConstraintKind.NthChild, nthPattern: pattern, nestedCompounds: null } : null;
  }
  if (lowerName === "nth-last-child") {
    const pattern = parseNthPatternFromArg(argContent);
    return pattern ? { name: lowerName, raw, kind: PseudoConstraintKind.NthLastChild, nthPattern: pattern, nestedCompounds: null } : null;
  }
  if (lowerName === "nth-of-type") {
    const pattern = parseNthPatternFromArg(argContent);
    return pattern ? { name: lowerName, raw, kind: PseudoConstraintKind.NthOfType, nthPattern: pattern, nestedCompounds: null } : null;
  }
  if (lowerName === "nth-last-of-type") {
    const pattern = parseNthPatternFromArg(argContent);
    return pattern ? { name: lowerName, raw, kind: PseudoConstraintKind.NthLastOfType, nthPattern: pattern, nestedCompounds: null } : null;
  }

  if (lowerName === "is" || lowerName === "where") {
    if (depth >= MAX_PSEUDO_PARSE_DEPTH) return { name: lowerName, raw, kind: PseudoConstraintKind.MatchesAny, nthPattern: null, nestedCompounds: null };
    const nested = parseNestedCompoundGroups(argContent, depth + 1);
    return { name: lowerName, raw, kind: PseudoConstraintKind.MatchesAny, nthPattern: null, nestedCompounds: nested };
  }

  if (lowerName === "not") {
    if (depth >= MAX_PSEUDO_PARSE_DEPTH) return { name: lowerName, raw, kind: PseudoConstraintKind.NoneOf, nthPattern: null, nestedCompounds: null };
    const nested = parseNestedCompoundGroups(argContent, depth + 1);
    return { name: lowerName, raw, kind: PseudoConstraintKind.NoneOf, nthPattern: null, nestedCompounds: nested };
  }

  return { name: lowerName, raw, kind: PseudoConstraintKind.Simple, nthPattern: null, nestedCompounds: null };
}

function parseNestedCompoundGroups(argContent: string, depth: number): SelectorCompound[][] {
  const args = splitPseudoArgs(argContent);
  const groups: SelectorCompound[][] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const trimmed = arg.trim();
    if (!trimmed) continue;
    const result = parseSelectorComplete(trimmed, depth);
    if (result.compounds.length > 0) {
      groups.push(result.compounds.slice());
    }
  }

  return groups;
}

export function parseNthPatternFromArg(raw: string): NthPattern | null {
  const normalized = raw.trim().toLowerCase().replaceAll(" ", "");
  if (normalized.length === 0) return null;

  if (normalized === "odd") return { step: 2, offset: 1 };
  if (normalized === "even") return { step: 2, offset: 0 };

  const nIndex = normalized.indexOf("n");
  if (nIndex === -1) {
    const value = Number.parseInt(normalized, 10);
    if (Number.isNaN(value)) return null;
    return { step: 0, offset: value };
  }

  const stepPart = normalized.slice(0, nIndex);
  const offsetPart = normalized.slice(nIndex + 1);

  let step: number;
  if (stepPart.length === 0 || stepPart === "+") step = 1;
  else if (stepPart === "-") step = -1;
  else {
    step = Number.parseInt(stepPart, 10);
    if (Number.isNaN(step)) return null;
  }

  let offset = 0;
  if (offsetPart.length > 0) {
    offset = Number.parseInt(offsetPart, 10);
    if (Number.isNaN(offset)) return null;
  }

  return { step, offset };
}

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


