/**
 * Animation Keyword Detection and Utilities
 *
 * Utilities for detecting animation-related keywords and parsing animation property values.
 */

import {
  CHAR_OPEN_PAREN,
  CHAR_CLOSE_PAREN,
  CHAR_COMMA,
  CHAR_FOLD_BIT,
  CHAR_A_LOWER,
  CHAR_S,
  isDigit,
  isWhitespace,
  matchesLowercase,
} from "./chars";
import { TIME_VALUE_RE, NUMBER_RE } from "./patterns";

// Keyword lookup table indexed by first character (lowercase)
// Each entry is a Set of keywords starting with that letter
const KEYWORD_TABLE: Array<Set<string> | undefined> = [];

// All animation keywords grouped by category
const ALL_KEYWORDS = [
  // Timing functions
  "ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end",
  // Fill mode
  "none", "forwards", "backwards", "both",
  // Direction
  "normal", "reverse", "alternate", "alternate-reverse",
  // Play state
  "running", "paused",
  // Other
  "infinite", "initial", "inherit", "unset", "revert",
];

// Build the lookup table at module load time
for (const kw of ALL_KEYWORDS) {
  const idx = kw.charCodeAt(0) - CHAR_A_LOWER;
  let set = KEYWORD_TABLE[idx];
  if (!set) {
    set = new Set();
    KEYWORD_TABLE[idx] = set;
  }
  set.add(kw);
}

// Bitmask for valid first characters of keywords (a-z range, offset by 'a')
// Valid: a, b, e, f, i, l, n, p, r, s, u
const VALID_KEYWORD_FIRST_CHAR =
  (1 << 0) |   // a (alternate)
  (1 << 1) |   // b (backwards, both)
  (1 << 4) |   // e (ease)
  (1 << 5) |   // f (forwards)
  (1 << 8) |   // i (infinite, initial, inherit)
  (1 << 11) |  // l (linear)
  (1 << 13) |  // n (none, normal)
  (1 << 15) |  // p (paused)
  (1 << 17) |  // r (reverse, running, revert)
  (1 << 18) |  // s (step-start, step-end)
  (1 << 20);   // u (unset)

/**
 * Check if a value is a known CSS animation keyword.
 *
 * @param value - The value to check
 * @returns True if it's a recognized animation keyword
 */
export function isAnimationKeyword(value: string): boolean {
  const len = value.length;
  // "alternate-reverse" is longest at 17 chars
  if (len === 0 || len > 17) return false;

  const first = value.charCodeAt(0);
  const firstLower = first | CHAR_FOLD_BIT;

  // Check if first char is in valid range (a-z)
  const idx = firstLower - CHAR_A_LOWER;
  if ((idx >>> 0) > 25) return false;

  if ((VALID_KEYWORD_FIRST_CHAR & (1 << idx)) === 0) return false;

  const keywords = KEYWORD_TABLE[idx];
  if (!keywords) return false;

  return keywords.has(value.toLowerCase());
}

/**
 * Check if a value looks like a time/duration (1s, 200ms, 0.5s).
 *
 * @param value - The value to check
 * @returns True if it matches a time pattern
 */
export function isTimeValue(value: string): boolean {
  return TIME_VALUE_RE.test(value);
}

/**
 * Check if a value is a plain number (iteration count).
 *
 * @param value - The value to check
 * @returns True if it's a plain number
 */
export function isIterationCount(value: string): boolean {
  return NUMBER_RE.test(value);
}

/**
 * Check if a value is a timing function (cubic-bezier(), steps()).
 * Uses character-based prefix matching.
 *
 * @param value - The value to check
 * @returns True if it starts with a timing function
 */
export function isTimingFunction(value: string): boolean {
  const len = value.length;
  if (len < 6) return false;
  // Check for "steps(" first (shorter, more common)
  if (matchesLowercase(value, 0, "steps(")) return true;
  // Check for "cubic-bezier("
  if (len >= 13 && matchesLowercase(value, 0, "cubic-bezier(")) return true;
  return false;
}

/**
 * Check if a value is any animation-related keyword or value.
 * This includes keywords, time values, numbers, and timing functions.
 *
 * @param value - The value to check
 * @returns True if it's an animation keyword/value, false if it's likely an animation name
 */
export function isAnimationValue(value: string): boolean {
  const len = value.length;
  if (len === 0) return false;

  const first = value.charCodeAt(0);

  if (isDigit(first)) {
    // Check last char to dispatch: 's'/'S' suffix means time value
    const last = value.charCodeAt(len - 1) | CHAR_FOLD_BIT;
    return last === CHAR_S ? TIME_VALUE_RE.test(value) : NUMBER_RE.test(value);
  }

  // Check for timing functions: "cubic-bezier(" or "steps("
  const firstLower = first | CHAR_FOLD_BIT;
  if (firstLower === 99 /* 'c' */ || firstLower === CHAR_S) {
    if (isTimingFunction(value)) return true;
  }

  // Check for keywords
  return isAnimationKeyword(value);
}

/**
 * Extract keyframe animation names from an animation or animation-name property value.
 *
 * @param value - The property value
 * @param property - Either "animation" or "animation-name"
 * @returns Array of keyframe names found
 */
export function extractKeyframeNames(value: string, property: string): readonly string[] {
  const len = value.length;
  if (len === 0) return [];

  const names: string[] = [];
  const isNameOnly = property === "animation-name";

  let i = 0;
  let tokenStart = -1;
  let tokenEnd = -1;
  let foundNameForAnimation = false;
  let parenDepth = 0;

  while (i <= len) {
    // At end of string, treat as if we hit a comma to flush last token
    const c = i < len ? value.charCodeAt(i) : CHAR_COMMA;

    // Track parentheses depth for function calls like cubic-bezier(), var()
    if (c === CHAR_OPEN_PAREN) {
      // Discard the pending token — it's a function name (var, env, calc, etc.), not an animation name
      tokenStart = -1;
      tokenEnd = -1;
      parenDepth++;
      i++;
      continue;
    }
    if (c === CHAR_CLOSE_PAREN) {
      parenDepth--;
      i++;
      continue;
    }

    // Skip content inside function calls
    if (parenDepth > 0) {
      i++;
      continue;
    }

    const isWs = isWhitespace(c);
    const isComma = c === CHAR_COMMA;

    // Whitespace or comma ends the current token
    if (isWs || isComma) {
      // Process completed token
      if (tokenStart >= 0 && tokenEnd >= tokenStart) {
        const token = value.slice(tokenStart, tokenEnd + 1);
        if (isNameOnly) {
          if (!isAnimationKeyword(token)) {
            names.push(token);
          }
        } else if (!foundNameForAnimation && !isAnimationValue(token)) {
          names.push(token);
          foundNameForAnimation = true;
        }
        tokenStart = -1;
        tokenEnd = -1;
      }

      // Comma resets for next animation in list
      if (isComma) {
        foundNameForAnimation = false;
      }

      i++;
      continue;
    }

    // Non-whitespace character: track token bounds
    if (tokenStart < 0) {
      tokenStart = i;
    }
    tokenEnd = i;
    i++;
  }

  return names;
}
