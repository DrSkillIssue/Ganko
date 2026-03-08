/**
 * String Manipulation Utilities
 *
 * Centralized string parsing and splitting utilities used throughout
 * the CSS parsing and analysis.
 */

import {
  CHAR_OPEN_PAREN,
  CHAR_CLOSE_PAREN,
  CHAR_OPEN_BRACKET,
  CHAR_CLOSE_BRACKET,
  CHAR_BACKSLASH,
  CHAR_DOUBLE_QUOTE,
  CHAR_SINGLE_QUOTE,
  CHAR_COMMA,
  CHAR_HYPHEN,
  CHAR_NEWLINE,
  isWhitespace,
  isUpperAlpha,
  toLowerCode,
} from "./chars";

/**
 * Empty string array sentinel for reuse.
 */
export const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

/**
 * Regex for kebab-case conversion.
 */
const KEBAB_REGEX = /\p{Lu}/gu;

/**
 * Vendor prefixes that should retain the leading dash when converted to kebab-case.
 */
const VENDOR_PREFIXES = ["webkit", "moz", "ms", "o"];

/**
 * Options for splitting strings.
 */
export interface SplitOptions {
  /** Whether to track bracket depth (for CSS attribute selectors) */
  readonly respectBrackets?: boolean;
  /** Whether to trim each resulting segment */
  readonly trim?: boolean;
  /** Whether to filter out empty segments */
  readonly filterEmpty?: boolean;
}

/**
 * Split a string by commas, respecting parentheses and optionally brackets.
 * This is the unified implementation for parseSelectorList, splitPseudoArgs,
 * splitParameters, and splitMediaQueries.
 *
 * @param str - The string to split
 * @param options - Optional configuration
 * @returns Array of split segments
 *
 * @example
 * splitByComma("a, b, c")
 * // Returns: ["a", "b", "c"]
 *
 * splitByComma(".a:is(.b, .c), .d")
 * // Returns: [".a:is(.b, .c)", ".d"]
 *
 * splitByComma("[data-x=','], .foo")
 * // Returns: ["[data-x=',']", ".foo"] (with respectBrackets: true)
 */
export function splitByComma(str: string, options?: SplitOptions): readonly string[] {
  const len = str.length;
  if (len === 0) return EMPTY_STRINGS;

  const respectBrackets = options?.respectBrackets ?? true;
  const trim = options?.trim ?? true;
  const filterEmpty = options?.filterEmpty ?? true;

  // No comma means single segment
  if (str.indexOf(",") === -1) {
    const segment = trim ? str.trim() : str;
    if (filterEmpty && !segment) return EMPTY_STRINGS;
    return segment ? [segment] : EMPTY_STRINGS;
  }

  const result: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < len; i++) {
    const char = str.charCodeAt(i);

    if (char === CHAR_OPEN_PAREN) {
      parenDepth++;
    } else if (char === CHAR_CLOSE_PAREN) {
      parenDepth--;
    } else if (respectBrackets && char === CHAR_OPEN_BRACKET) {
      bracketDepth++;
    } else if (respectBrackets && char === CHAR_CLOSE_BRACKET) {
      bracketDepth--;
    } else if (char === CHAR_COMMA && parenDepth === 0 && bracketDepth === 0) {
      const segment = str.substring(start, i);
      const processed = trim ? segment.trim() : segment;
      if (!filterEmpty || processed) {
        result.push(processed);
      }
      start = i + 1;
    }
  }

  // Add final segment
  const final = str.substring(start);
  const processed = trim ? final.trim() : final;
  if (!filterEmpty || processed) {
    result.push(processed);
  }

  return result;
}

/**
 * Split a parameter string by commas, respecting parentheses.
 * Alias for splitByComma with brackets disabled (for mixin/function params).
 *
 * @param params - The parameter string to split
 * @returns Array of parameter strings
 *
 * @example
 * splitParameters("$color, $size: 16px, $args...")
 * // Returns: ["$color", "$size: 16px", "$args..."]
 */
export function splitParameters(params: string): readonly string[] {
  return splitByComma(params, { respectBrackets: false });
}

/**
 * Split a selector list by commas, respecting parentheses and brackets.
 * This handles cases like `.a, .b:is(.c, .d)` correctly.
 *
 * @param selectorText - The selector list to split
 * @returns Array of individual selectors
 *
 * @example
 * splitSelectorList("h1, h2, h3")
 * // Returns: ["h1", "h2", "h3"]
 *
 * splitSelectorList(".a, .b:is(.c, .d)")
 * // Returns: [".a", ".b:is(.c, .d)"]
 */
export function splitSelectorList(selectorText: string): readonly string[] {
  return splitByComma(selectorText, { respectBrackets: true });
}

/**
 * Split pseudo-class arguments by commas.
 * Used for parsing :is(), :not(), :has() arguments.
 *
 * @param content - The content inside the pseudo-class parentheses
 * @returns Array of argument strings
 *
 * @example
 * splitPseudoArgs(".a, .b, .c")
 * // Returns: [".a", ".b", ".c"]
 */
export function splitPseudoArgs(content: string): readonly string[] {
  return splitByComma(content, { respectBrackets: true });
}

/**
 * Split media queries by commas, respecting parentheses.
 *
 * @param query - The media query string
 * @returns Array of individual media queries
 *
 * @example
 * splitMediaQueries("screen and (min-width: 600px), print")
 * // Returns: ["screen and (min-width: 600px)", "print"]
 */
export function splitMediaQueries(query: string): readonly string[] {
  if (!query || query.indexOf(",") === -1) return query ? [query] : [];
  return splitByComma(query, { respectBrackets: false });
}

/**
 * Trim whitespace from both ends of a string using charCodeAt.
 *
 * @param str - The string to trim
 * @returns Trimmed string
 */
export function trimFast(str: string): string {
  let start = 0;
  let end = str.length;

  while (start < end && isWhitespace(str.charCodeAt(start))) start++;
  while (end > start && isWhitespace(str.charCodeAt(end - 1))) end--;

  if (start === 0 && end === str.length) return str;
  return str.substring(start, end);
}

/**
 * Get the start and end indices after trimming whitespace.
 * Useful when you need the bounds without creating a new string.
 *
 * @param str - The string to analyze
 * @param start - Starting index (default 0)
 * @param end - Ending index (default str.length)
 * @returns Tuple of [trimmedStart, trimmedEnd]
 */
export function getTrimBounds(str: string, start = 0, end = str.length): [number, number] {
  while (start < end && isWhitespace(str.charCodeAt(start))) start++;
  while (end > start && isWhitespace(str.charCodeAt(end - 1))) end--;
  return [start, end];
}

/**
 * Convert a string to lowercase.
 * Returns the same reference if already lowercase.
 *
 * @param str - The string to convert
 * @returns Lowercase string
 */
export function toLowerString(str: string): string {
  const len = str.length;
  for (let i = 0; i < len; i++) {
    if (isUpperAlpha(str.charCodeAt(i))) {
      // Has uppercase, need to convert
      let result = str.slice(0, i);
      for (let j = i; j < len; j++) {
        result += String.fromCharCode(toLowerCode(str.charCodeAt(j)));
      }
      return result;
    }
  }
  return str;
}

/**
 * Check if a string contains only whitespace.
 *
 * @param str - The string to check
 * @returns True if the string is empty or contains only whitespace
 */
export function isBlank(str: string): boolean {
  const len = str.length;
  for (let i = 0; i < len; i++) {
    if (!isWhitespace(str.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

/**
 * Find the index of a character, respecting parenthesis depth.
 * Returns -1 if not found at depth 0.
 *
 * @param str - The string to search
 * @param char - The character code to find
 * @param startIndex - Starting index (default 0)
 * @returns Index of the character at depth 0, or -1
 */
export function indexOfAtDepthZero(str: string, char: number, startIndex = 0): number {
  const len = str.length;
  let depth = 0;

  for (let i = startIndex; i < len; i++) {
    const c = str.charCodeAt(i);
    if (c === CHAR_OPEN_PAREN) {
      depth++;
    } else if (c === CHAR_CLOSE_PAREN) {
      depth--;
    } else if (c === char && depth === 0) {
      return i;
    }
  }

  return -1;
}

/**
 * Find the matching closing parenthesis for an opening one.
 *
 * @param str - The string to search
 * @param openIndex - Index of the opening parenthesis
 * @returns Index of the matching closing parenthesis, or -1
 */
export function findMatchingParen(str: string, openIndex: number): number {
  const len = str.length;
  let depth = 1;

  for (let i = openIndex + 1; i < len; i++) {
    const c = str.charCodeAt(i);
    if (c === CHAR_OPEN_PAREN) {
      depth++;
    } else if (c === CHAR_CLOSE_PAREN) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Skip past a quoted string (starting at the opening quote).
 * Handles backslash escape sequences.
 *
 * @param str - The string to search
 * @param start - Index of the opening quote
 * @returns Position after the closing quote
 */
export function skipQuotedString(str: string, start: number): number {
  const quote = str.charCodeAt(start);
  const len = str.length;
  let i = start + 1;

  while (i < len) {
    const ch = str.charCodeAt(i);
    if (ch === CHAR_BACKSLASH && i + 1 < len) {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Find the matching closing parenthesis, respecting quoted strings and escapes.
 * More robust than findMatchingParen for CSS selector parsing.
 *
 * @param str - The string to search
 * @param start - Position after the opening parenthesis
 * @returns Position after the closing parenthesis
 */
export function findClosingParenRobust(str: string, start: number): number {
  const len = str.length;
  let i = start;
  let depth = 1;

  while (i < len && depth > 0) {
    const ch = str.charCodeAt(i);

    if (ch === CHAR_BACKSLASH && i + 1 < len) {
      i += 2;
      continue;
    }

    if (ch === CHAR_DOUBLE_QUOTE || ch === CHAR_SINGLE_QUOTE) {
      i = skipQuotedString(str, i);
      continue;
    }

    if (ch === CHAR_OPEN_PAREN) {
      depth++;
    } else if (ch === CHAR_CLOSE_PAREN) {
      depth--;
    }
    i++;
  }
  return i;
}

/**
 * Find the matching closing bracket, respecting quoted strings and escapes.
 * Used for CSS attribute selectors like [data-value="test"].
 *
 * @param str - The string to search
 * @param start - Position after the opening bracket
 * @returns Position after the closing bracket
 */
export function findClosingBracketRobust(str: string, start: number): number {
  const len = str.length;
  let i = start;

  while (i < len) {
    const ch = str.charCodeAt(i);

    if (ch === CHAR_BACKSLASH && i + 1 < len) {
      i += 2;
      continue;
    }

    if (ch === CHAR_DOUBLE_QUOTE || ch === CHAR_SINGLE_QUOTE) {
      i = skipQuotedString(str, i);
      continue;
    }

    if (ch === CHAR_CLOSE_BRACKET) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Strip leading CSS variable dashes and lowercase.
 * Handles CSS custom property names like "--my-var" or "-webkit-var".
 *
 * @param name - The variable name to normalize
 * @returns Normalized name with leading dashes removed and lowercased
 *
 * @example
 * stripVarPrefix("--color-primary")  // "color-primary"
 * stripVarPrefix("-webkit-transform") // "webkit-transform"
 * stripVarPrefix("MyVar")             // "myvar"
 */
export function stripVarPrefix(name: string): string {
  const len = name.length;
  if (len === 0) return name;

  let start = 0;

  // Skip leading hyphens (max 2 for CSS custom properties)
  if (name.charCodeAt(0) === CHAR_HYPHEN) {
    start = 1;
    if (len > 1 && name.charCodeAt(1) === CHAR_HYPHEN) {
      start = 2;
    }
  }

  // Scan to detect uppercase
  let hasUpper = false;
  for (let i = start; i < len; i++) {
    if (isUpperAlpha(name.charCodeAt(i))) {
      hasUpper = true;
      break;
    }
  }

  if (start === 0 && !hasUpper) return name;
  if (start > 0 && !hasUpper) return name.slice(start);
  if (start === 0) return name.toLowerCase();
  return name.slice(start).toLowerCase();
}

/**
 * Case-insensitive endsWith check.
 * Performs character-by-character comparison with inline case conversion.
 *
 * @param str - The string to check
 * @param suffix - The suffix to match (case-insensitive)
 * @returns True if str ends with suffix (case-insensitive)
 *
 * @example
 * endsWithCaseInsensitive("--text-FG", "-fg")  // true
 * endsWithCaseInsensitive("Button", "ton")     // true
 */
export function endsWithCaseInsensitive(str: string, suffix: string): boolean {
  const strLen = str.length;
  const suffixLen = suffix.length;
  if (strLen < suffixLen) return false;

  const offset = strLen - suffixLen;
  for (let i = 0; i < suffixLen; i++) {
    const c = str.charCodeAt(offset + i) | 0x20;
    const s = suffix.charCodeAt(i) | 0x20;
    if (c !== s) return false;
  }

  return true;
}

/**
 * Case-insensitive startsWith check.
 * Performs character-by-character comparison with inline case conversion.
 *
 * @param str - The string to check
 * @param prefix - The prefix to match (case-insensitive)
 * @returns True if str starts with prefix (case-insensitive)
 *
 * @example
 * startsWithCaseInsensitive("TEXT-SIZE-lg", "text-size-")  // true
 * startsWithCaseInsensitive("Button", "but")               // true
 */
export function startsWithCaseInsensitive(str: string, prefix: string): boolean {
  const strLen = str.length;
  const prefixLen = prefix.length;
  if (strLen < prefixLen) return false;

  for (let i = 0; i < prefixLen; i++) {
    const c = str.charCodeAt(i) | 0x20;
    const p = prefix.charCodeAt(i) | 0x20;
    if (c !== p) return false;
  }

  return true;
}

/**
 * Extract parenthesized content and return [content, endPosition].
 * Handles nested parentheses and quoted strings properly.
 *
 * @param str - The string to search
 * @param start - Position after the opening parenthesis
 * @returns Tuple of [content inside parens, position after closing paren]
 */
export function extractParenContent(str: string, start: number): [string, number] {
  const len = str.length;
  let i = start;
  let depth = 1;
  const contentStart = start;

  while (i < len && depth > 0) {
    const ch = str.charCodeAt(i);

    if (ch === CHAR_BACKSLASH && i + 1 < len) {
      i += 2;
      continue;
    }

    if (ch === CHAR_DOUBLE_QUOTE || ch === CHAR_SINGLE_QUOTE) {
      i = skipQuotedString(str, i);
      continue;
    }

    if (ch === CHAR_OPEN_PAREN) {
      depth++;
      i++;
    } else if (ch === CHAR_CLOSE_PAREN) {
      depth--;
      if (depth === 0) {
        return [str.slice(contentStart, i), i + 1];
      }
      i++;
    } else {
      i++;
    }
  }

  return [str.slice(contentStart, i), i];
}

/**
 * Split a string by commas, respecting parentheses, brackets, and quoted strings.
 * This is the most robust version for CSS selector parsing.
 *
 * @param content - The string to split
 * @returns Array of split segments (trimmed, non-empty)
 */
export function splitByCommaRobust(content: string): string[] {
  const result: string[] = [];
  const len = content.length;
  let i = 0;
  let start = 0;
  let depth = 0;

  while (i < len) {
    const ch = content.charCodeAt(i);

    if (ch === CHAR_BACKSLASH && i + 1 < len) {
      i += 2;
      continue;
    }

    if (ch === CHAR_DOUBLE_QUOTE || ch === CHAR_SINGLE_QUOTE) {
      i = skipQuotedString(content, i);
      continue;
    }

    if (ch === CHAR_OPEN_PAREN || ch === CHAR_OPEN_BRACKET) {
      depth++;
      i++;
    } else if (ch === CHAR_CLOSE_PAREN || ch === CHAR_CLOSE_BRACKET) {
      depth--;
      i++;
    } else if (ch === CHAR_COMMA && depth === 0) {
      const segment = content.slice(start, i).trim();
      if (segment) {
        result.push(segment);
      }
      start = i + 1;
      i++;
    } else {
      i++;
    }
  }

  const lastSegment = content.slice(start).trim();
  if (lastSegment) {
    result.push(lastSegment);
  }

  return result;
}

/**
 * Check if a string is already in kebab-case or is a CSS custom property (--prefixed).
 * @param s - The string to check
 * @returns True if the string is kebab-case or starts with --
 */
export function isKebabCase(s: string): boolean {
  if (s.charCodeAt(0) === CHAR_HYPHEN && s.charCodeAt(1) === CHAR_HYPHEN) return true;
  const len = s.length;
  if (len === 0) return false;
  const first = s.charCodeAt(0);
  if (first < 97 || first > 122) return false;
  for (let i = 1; i < len; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === CHAR_HYPHEN) continue;
    return false;
  }
  return true;
}

/**
 * Transforms a string into kebab-case.
 *
 * Handles CSS vendor prefixes specially:
 * - WebkitTransform -> -webkit-transform
 * - MozAppearance -> -moz-appearance
 * - msTransform -> -ms-transform
 *
 * @example
 * toKebabCase("helloWorld"); // "hello-world"
 * toKebabCase("HelloWorld"); // "hello-world"
 * toKebabCase("WebkitTransform"); // "-webkit-transform"
 *
 * @param str The string to transform
 * @returns The kebab-cased string
 */
export function toKebabCase(str: string): string {
  /**
   * Replace uppercase letters with hyphen followed by lowercase.
   *
   * @param match - The matched uppercase character
   * @returns Hyphen followed by lowercase version
   */
  const replacer = (match: string): string => `-${match.toLowerCase()}`;

  const result = str.replace(KEBAB_REGEX, replacer);

  const normalized = result.charCodeAt(0) === CHAR_HYPHEN ? result.slice(1) : result;

  for (const prefix of VENDOR_PREFIXES) {
    if (startsWithCaseInsensitive(normalized, prefix + "-") || normalized === prefix) {
      return "-" + normalized;
    }
  }

  return normalized;
}

/**
 * Check if a file path ends with .css (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .css
 */
export function isCSSFile(path: string): boolean {
  const len = path.length;
  if (len < 5) return false;
  return (
    path.charCodeAt(len - 4) === 46 &&  // .
    (path.charCodeAt(len - 3) | 32) === 99 &&  // c
    (path.charCodeAt(len - 2) | 32) === 115 && // s
    (path.charCodeAt(len - 1) | 32) === 115    // s
  );
}

/**
 * Check if a file path ends with .scss (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .scss
 */
export function isSCSSFile(path: string): boolean {
  const len = path.length;
  if (len < 6) return false;
  return (
    path.charCodeAt(len - 5) === 46 &&  // .
    (path.charCodeAt(len - 4) | 32) === 115 && // s
    (path.charCodeAt(len - 3) | 32) === 99 &&  // c
    (path.charCodeAt(len - 2) | 32) === 115 && // s
    (path.charCodeAt(len - 1) | 32) === 115    // s
  );
}

/**
 * Check if a file path ends with .ts (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .ts
 */
export function isTypeScriptFile(path: string): boolean {
  const len = path.length;
  if (len < 4) return false;
  return (
    path.charCodeAt(len - 3) === 46 &&  // .
    (path.charCodeAt(len - 2) | 32) === 116 && // t
    (path.charCodeAt(len - 1) | 32) === 115    // s
  );
}

/**
 * Check if a file path ends with .tsx (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .tsx
 */
export function isTSXFile(path: string): boolean {
  const len = path.length;
  if (len < 5) return false;
  return (
    path.charCodeAt(len - 4) === 46 &&  // .
    (path.charCodeAt(len - 3) | 32) === 116 && // t
    (path.charCodeAt(len - 2) | 32) === 115 && // s
    (path.charCodeAt(len - 1) | 32) === 120    // x
  );
}

/**
 * Check if a file path ends with .jsx (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .jsx
 */
export function isJSXFile(path: string): boolean {
  const len = path.length;
  if (len < 5) return false;
  return (
    path.charCodeAt(len - 4) === 46 &&  // .
    (path.charCodeAt(len - 3) | 32) === 106 && // j
    (path.charCodeAt(len - 2) | 32) === 115 && // s
    (path.charCodeAt(len - 1) | 32) === 120    // x
  );
}

/**
 * Check if a file path ends with .js (case-insensitive).
 * @param path - File path to check
 * @returns True if path ends with .js
 */
export function isJSFile(path: string): boolean {
  const len = path.length;
  if (len < 4) return false;
  return (
    path.charCodeAt(len - 3) === 46 &&  // .
    (path.charCodeAt(len - 2) | 32) === 106 && // j
    (path.charCodeAt(len - 1) | 32) === 115    // s
  );
}

/**
 * Count the number of lines in content.
 *
 * @param content - The string content to count lines in
 * @returns The number of lines (minimum 1 for non-empty content)
 */
export function countLines(content: string): number {
  if (!content) return 0;

  const len = content.length;
  if (len === 0) return 0;

  let count = 1;
  for (let i = 0; i < len; i++) {
    if (content.charCodeAt(i) === CHAR_NEWLINE) {
      count++;
    }
  }
  return count;
}
