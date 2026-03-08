/**
 * Character Code Constants and Utilities
 *
 * Centralized character codes and predicates used throughout
 * CSS parsing, string manipulation, and analysis.
 */

export const CHAR_FOLD_BIT = 32;

// Whitespace
export const CHAR_SPACE = 32;       // ' '
export const CHAR_TAB = 9;          // '\t'
export const CHAR_NEWLINE = 10;     // '\n'
export const CHAR_CR = 13;          // '\r'
export const CHAR_FORM_FEED = 12;   // '\f'

// Selector Characters
export const CHAR_HASH = 35;        // '#'
export const CHAR_DOT = 46;         // '.'
export const CHAR_COLON = 58;       // ':'
export const CHAR_AMPERSAND = 38;   // '&'
export const CHAR_ASTERISK = 42;    // '*'
export const CHAR_PERCENT = 37;     // '%'

// Brackets and Parentheses
export const CHAR_OPEN_PAREN = 40;      // '('
export const CHAR_CLOSE_PAREN = 41;     // ')'
export const CHAR_OPEN_BRACKET = 91;    // '['
export const CHAR_CLOSE_BRACKET = 93;   // ']'
export const CHAR_OPEN_BRACE = 123;     // '{'
export const CHAR_CLOSE_BRACE = 125;    // '}'

// Combinators
export const CHAR_GT = 62;          // '>'
export const CHAR_PLUS = 43;        // '+'
export const CHAR_TILDE = 126;      // '~'

// Punctuation
export const CHAR_COMMA = 44;       // ','
export const CHAR_HYPHEN = 45;      // '-'
export const CHAR_UNDERSCORE = 95;  // '_'
export const CHAR_SEMICOLON = 59;   // ';'
export const CHAR_EXCLAIM = 33;     // '!'

// Special Characters
export const CHAR_DOLLAR = 36;      // '$'
export const CHAR_AT = 64;          // '@'
export const CHAR_BACKSLASH = 92;   // '\\'
export const CHAR_SLASH = 47;       // '/'

// Quotes
export const CHAR_DOUBLE_QUOTE = 34;  // '"'
export const CHAR_SINGLE_QUOTE = 39;  // '\''

// Letters for keyword detection
export const CHAR_A = 97;           // 'a'
export const CHAR_E = 101;          // 'e'
export const CHAR_H = 104;          // 'h'
export const CHAR_I = 105;          // 'i'
export const CHAR_M = 109;          // 'm'
export const CHAR_N = 110;          // 'n'
export const CHAR_O = 111;          // 'o'
export const CHAR_P = 112;          // 'p'
export const CHAR_R = 114;          // 'r'
export const CHAR_S = 115;          // 's'
export const CHAR_T = 116;          // 't'
export const CHAR_U = 117;          // 'u'
export const CHAR_V_LOWER = 118;    // 'v'
export const CHAR_V_UPPER = 86;     // 'V'

// Digit range
export const CHAR_0 = 48;           // '0'
export const CHAR_9 = 57;           // '9'

// Letter ranges
export const CHAR_A_UPPER = 65;     // 'A'
export const CHAR_F_UPPER = 70;     // 'F'
export const CHAR_Z_UPPER = 90;     // 'Z'
export const CHAR_A_LOWER = 97;     // 'a'
export const CHAR_F_LOWER = 102;    // 'f'
export const CHAR_Z_LOWER = 122;    // 'z'

// Additional operators
export const CHAR_PIPE = 124;       // '|'
export const CHAR_QUESTION = 63;    // '?'

/**
 * Lookup table for whitespace detection.
 * Use as: WHITESPACE_TABLE[charCode] === 1
 */
export const WHITESPACE_TABLE = new Uint8Array(256);
WHITESPACE_TABLE[CHAR_SPACE] = 1;
WHITESPACE_TABLE[CHAR_TAB] = 1;
WHITESPACE_TABLE[CHAR_NEWLINE] = 1;
WHITESPACE_TABLE[CHAR_CR] = 1;
WHITESPACE_TABLE[CHAR_FORM_FEED] = 1;

/**
 * Lookup table for semicolon or whitespace detection.
 * Use as: SEMICOLON_OR_WHITESPACE_TABLE[charCode] === 1
 */
export const SEMICOLON_OR_WHITESPACE_TABLE = new Uint8Array(256);
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_SEMICOLON] = 1;
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_SPACE] = 1;
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_TAB] = 1;
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_NEWLINE] = 1;
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_CR] = 1;
SEMICOLON_OR_WHITESPACE_TABLE[CHAR_FORM_FEED] = 1;


const COMBINATOR_TABLE = new Uint8Array(256);
COMBINATOR_TABLE[CHAR_GT] = 1;
COMBINATOR_TABLE[CHAR_PLUS] = 1;
COMBINATOR_TABLE[CHAR_TILDE] = 1;

/**
 * Check if a character code is a digit (0-9).
 *
 * @param code - The character code to check
 * @returns True if the code represents a digit (48-57)
 */
export function isDigit(code: number): boolean {
  return (code - CHAR_0) >>> 0 <= 9;
}

/**
 * Check if a character code is an uppercase letter (A-Z).
 *
 * @param code - The character code to check
 * @returns True if the code represents an uppercase letter (65-90)
 */
export function isUpperAlpha(code: number): boolean {
  return (code - CHAR_A_UPPER) >>> 0 <= 25;
}

/**
 * Check if a character code is a lowercase letter (a-z).
 *
 * @param code - The character code to check
 * @returns True if the code represents a lowercase letter (97-122)
 */
export function isLowerAlpha(code: number): boolean {
  return (code - CHAR_A_LOWER) >>> 0 <= 25;
}

/**
 * Check if a character code is a letter (A-Z or a-z).
 *
 * @param code - The character code to check
 * @returns True if the code represents a letter (uppercase or lowercase)
 */
export function isAlpha(code: number): boolean {
  return ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 25;
}

/**
 * Check if a character code is alphanumeric (A-Z, a-z, 0-9).
 *
 * @param code - The character code to check
 * @returns True if the code represents a letter or digit
 */
export function isAlphaNumeric(code: number): boolean {
  return ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 25 || (code - CHAR_0) >>> 0 <= 9;
}

/**
 * Check if a character code is a hexadecimal digit (0-9, a-f, A-F).
 *
 * @param code - The character code to check
 * @returns True if the code represents a hex digit
 */
export function isHexDigit(code: number): boolean {
  return (code - CHAR_0) >>> 0 <= 9 || ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 5;
}

/**
 * Check if a character code is whitespace (space, tab, newline, carriage return, form feed).
 *
 * @param code - The character code to check
 * @returns True if the code represents whitespace
 */
export function isWhitespace(code: number): boolean {
  return WHITESPACE_TABLE[code] === 1;
}

/**
 * Check if a character code is a CSS combinator (>, +, ~).
 *
 * @param code - The character code to check
 * @returns True if the code represents a CSS combinator
 */
export function isCombinator(code: number): boolean {
  return COMBINATOR_TABLE[code] === 1;
}

/**
 * Check if a character code is valid for a CSS identifier start (letter, underscore, hyphen).
 *
 * @param code - The character code to check
 * @returns True if the code can start a CSS identifier
 */
export function isIdentStart(code: number): boolean {
  return ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 25 || code === CHAR_UNDERSCORE || code === CHAR_HYPHEN;
}

/**
 * Check if a character code is valid within a CSS identifier (letter, digit, underscore, hyphen).
 *
 * @param code - The character code to check
 * @returns True if the code can appear within a CSS identifier
 */
export function isIdentChar(code: number): boolean {
  return ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 25 || (code - CHAR_0) >>> 0 <= 9 || code === CHAR_UNDERSCORE || code === CHAR_HYPHEN;
}

/**
 * Check if a character code is valid for a pseudo-class/element name (letter, hyphen).
 *
 * @param code - The character code to check
 * @returns True if the code can appear in a pseudo-class/element name
 */
export function isPseudoNameChar(code: number): boolean {
  return ((code | CHAR_FOLD_BIT) - CHAR_A_LOWER) >>> 0 <= 25 || code === CHAR_HYPHEN;
}

/**
 * Check if a string is a valid CSS hex color (#RGB, #RRGGBB, #RGBA, #RRGGBBAA).
 * Validates format: # followed by 3, 4, 6, or 8 hex digits.
 *
 * @param value - The string to check (should already be lowercased)
 * @returns True if the value is a valid hex color
 *
 * @example
 * isHexColor("#fff")       // true
 * isHexColor("#ff0000")    // true
 * isHexColor("#ff000080")  // true (with alpha)
 * isHexColor("#gg0000")    // false
 * isHexColor("red")        // false
 */
export function isHexColor(value: string): boolean {
  const len = value.length;
  // Valid lengths: #RGB(4), #RGBA(5), #RRGGBB(7), #RRGGBBAA(9)
  if (len !== 4 && len !== 5 && len !== 7 && len !== 9) return false;
  if (value.charCodeAt(0) !== CHAR_HASH) return false;

  for (let i = 1; i < len; i++) {
    if (!isHexDigit(value.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Check if a selector string starts with :root (case-insensitive).
 * Skips leading whitespace and verifies the next character is valid.
 *
 * @param selector - The selector string to check
 * @returns True if the selector starts with :root
 *
 * @example
 * isRootSelector(":root")        // true
 * isRootSelector("  :root ")     // true
 * isRootSelector(":ROOT")        // true (case-insensitive)
 * isRootSelector(".root")        // false
 */
export function isRootSelector(selector: string): boolean {
  const len = selector.length;
  if (len < 5) return false;

  // Skip leading whitespace
  let i = 0;
  while (i < len) {
    const c = selector.charCodeAt(i);
    if (!isWhitespace(c)) break;
    i++;
  }

  // Need at least 5 chars for ":root"
  if (len - i < 5) return false;

  // Check for ":root" (case-insensitive for "root")
  if (selector.charCodeAt(i) !== CHAR_COLON) return false;
  if ((selector.charCodeAt(i + 1) | CHAR_FOLD_BIT) !== CHAR_R) return false;
  if ((selector.charCodeAt(i + 2) | CHAR_FOLD_BIT) !== CHAR_O) return false;
  if ((selector.charCodeAt(i + 3) | CHAR_FOLD_BIT) !== CHAR_O) return false;
  if ((selector.charCodeAt(i + 4) | CHAR_FOLD_BIT) !== CHAR_T) return false;

  // Check next char is end or whitespace
  const next = i + 5;
  if (next >= len) return true;
  return isWhitespace(selector.charCodeAt(next));
}

/**
 * Convert a character code to lowercase if uppercase.
 *
 * @param code - The ASCII character code to convert
 * @returns The lowercase character code (or original if already lowercase/not a letter)
 */
export function toLowerCode(code: number): number {
  return (code - CHAR_A_UPPER) >>> 0 <= 25 ? code | CHAR_FOLD_BIT : code;
}

/**
 * Check if a character code is whitespace or a CSS combinator.
 * Whitespace: space, tab, newline, carriage return, form feed
 * Combinators: >, +, ~
 *
 * @param code - The character code to check
 * @returns True if the code represents whitespace or a combinator
 */
export function isWhitespaceOrCombinator(code: number): boolean {
  return WHITESPACE_TABLE[code] === 1 || COMBINATOR_TABLE[code] === 1;
}

/**
 * Check if substring matches a lowercase target (case-insensitive).
 * Performs inline case conversion without allocating new strings.
 * The target MUST be lowercase for this to work correctly.
 *
 * @param str - The string to search in
 * @param start - The starting position in the string
 * @param target - The lowercase target string to match against
 * @returns True if the substring matches the target (case-insensitive)
 *
 * @example
 * matchesLowercase("HELLO", 0, "hello")  // true
 * matchesLowercase("World", 0, "wor")    // true
 * matchesLowercase("test", 0, "TEST")    // false (target must be lowercase!)
 */
export function matchesLowercase(str: string, start: number, target: string): boolean {
  const targetLen = target.length;
  if (start + targetLen > str.length) return false;
  for (let i = 0; i < targetLen; i++) {
    let ch = str.charCodeAt(start + i);
    // Convert to lowercase if uppercase (A-Z -> a-z)
    if (ch >= CHAR_A_UPPER && ch <= CHAR_Z_UPPER) {
      ch |= CHAR_FOLD_BIT;
    }
    if (ch !== target.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
