/**
 * Is-Html
 * Simple check if a String is HTML.
 *
 * Based on: https://github.com/sindresorhus/is-html#readme
 */

import {
  CHAR_GT,
  CHAR_EXCLAIM,
  CHAR_SLASH,
  CHAR_HYPHEN,
  CHAR_A_LOWER,
  CHAR_0,
  WHITESPACE_TABLE,
  toLowerCode,
  isLowerAlpha,
  isDigit as isDigitChar,
} from "./chars";

// Array-based trie for HTML tags
// Children array: 0-25 = a-z, 26-35 = 0-9
const TRIE_SIZE = 36;

interface TrieNode {
  c: (TrieNode | null)[]; // children array (36 slots)
  e: boolean; // isEnd
}

/**
 * Get trie child index for a lowercase character code.
 * Returns -1 for invalid characters.
 *
 * @param code - The character code to convert to trie index
 * @returns Trie index (0-25 for a-z, 26-35 for 0-9, -1 for invalid)
 */
function getTrieIndex(code: number): number {
  if (isLowerAlpha(code)) return code - CHAR_A_LOWER;
  if (isDigitChar(code)) return code - CHAR_0 + 26;
  return -1;
}

/**
 * Creates a trie data structure for HTML tag lookup.
 *
 * @param tags - Array of HTML tag names to insert into the trie
 * @returns Root node of the constructed trie
 */
function createTrie(tags: string[]): TrieNode {
  const root: TrieNode = { c: new Array(TRIE_SIZE).fill(null), e: false };
  for (const tag of tags) {
    let node = root;
    for (let i = 0; i < tag.length; i++) {
      const idx = getTrieIndex(tag.charCodeAt(i));
      if (idx === -1) continue; // Skip invalid chars (shouldn't happen with valid input)
      let child = node.c[idx];
      if (!child) {
        child = { c: new Array(TRIE_SIZE).fill(null), e: false };
        node.c[idx] = child;
      }
      node = child;
    }
    node.e = true;
  }
  return root;
}

const htmlTagsTrie = createTrie([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "math",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "selectedcontent",
  "slot",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

// "doctype" and "html" as char code arrays
const DOCTYPE_CODES = [100, 111, 99, 116, 121, 112, 101]; // "doctype"
const HTML_CODES = [104, 116, 109, 108]; // "html"

/**
 * Check if string contains "doctype html" pattern (case-insensitive)
 * Starting from position after "<!".
 *
 * @param str - The string to search within
 * @param pos - Starting position after "<!" in the string
 * @param limit - Upper bound for scanning (exclusive)
 * @returns true if "doctype html" is found, false otherwise
 */
function isDoctypeHtml(str: string, pos: number, limit: number): boolean {
  // Need at least "doctype" (7) + 1 whitespace + "html" (4) = 12 chars
  if (pos + 12 > limit) return false;

  // Check "doctype" (case-insensitive)
  for (let i = 0; i < 7; i++) {
    if (toLowerCode(str.charCodeAt(pos + i)) !== DOCTYPE_CODES[i]) return false;
  }

  // Skip whitespace after "doctype"
  let p = pos + 7;
  if (!WHITESPACE_TABLE[str.charCodeAt(p)]) return false; // Must have at least one space
  while (p < limit && WHITESPACE_TABLE[str.charCodeAt(p)]) p++;

  // Check "html" (case-insensitive)
  if (p + 4 > limit) return false;
  for (let i = 0; i < 4; i++) {
    if (toLowerCode(str.charCodeAt(p + i)) !== HTML_CODES[i]) return false;
  }

  return true;
}

/**
 * Check if a tag starting at pos is a valid HTML tag or custom element.
 *
 * Custom elements must:
 * - Start with an ASCII letter
 * - Contain at least one hyphen
 * - Have at least 3 characters (e.g., "a-b")
 *
 * @param str - The string containing the potential tag
 * @param pos - Starting position of the tag (after '<')
 * @param limit - Upper bound for scanning (exclusive)
 * @param hasClosingBracket - Whether a closing bracket '>' exists in the string
 * @returns true if a valid HTML or custom element tag is found, false otherwise
 */
function isValidHtmlTag(
  str: string,
  pos: number,
  limit: number,
  hasClosingBracket: boolean,
): boolean {
  if (pos >= limit) return false;

  const firstCode = str.charCodeAt(pos);
  const firstLower = toLowerCode(firstCode);

  // Must start with a-z or A-Z
  if (!isLowerAlpha(firstLower)) return false;

  // Track if we've seen a hyphen (needed for custom element detection)
  let sawHyphen = false;

  const firstIdx = firstLower - CHAR_A_LOWER;
  let node: TrieNode | null = htmlTagsTrie.c[firstIdx] ?? null;
  let i = pos + 1;

  while (i < limit) {
    const code = str.charCodeAt(i);

    // Check for '>' - immediate valid termination
    if (code === CHAR_GT) {
      if (node?.e) return true;
      // Custom element: starts with letter, has hyphen, length >= 3
      if (sawHyphen && i > pos + 2) return true;
      return false;
    }

    // Check for '/' - valid if followed by '>' eventually (self-closing)
    if (code === CHAR_SLASH) {
      if (!hasClosingBracket) return false;
      if (node?.e) return true;
      if (sawHyphen && i > pos + 2) return true;
      return false;
    }

    // Check for whitespace terminator - need '>' somewhere after
    if (WHITESPACE_TABLE[code]) {
      if (!hasClosingBracket) return false;
      if (node?.e) return true;
      if (sawHyphen && i > pos + 2) return true;
      return false;
    }

    // Valid tag name continuation char?
    const lower = toLowerCode(code);
    const isLetter = isLowerAlpha(lower);
    const isDigit = isDigitChar(code);
    const isHyphen = code === CHAR_HYPHEN;

    if (!isLetter && !isDigit && !isHyphen) {
      return false;
    }

    if (isHyphen) {
      sawHyphen = true;
      // Hyphens break trie matching (no HTML tag has hyphens)
      node = null;
    } else if (node) {
      const idx = getTrieIndex(lower);
      node = idx >= 0 ? (node.c[idx] ?? null) : null;
    }

    i++;
  }

  // Reached limit without a valid terminator - not a valid tag
  return false;
}

/**
 * Checks if a string contains HTML content.
 *
 * Scans the first 1000 characters for valid HTML tags, DOCTYPE declarations,
 * or custom elements. Returns false for binary data (containing null bytes).
 *
 * @param str - The string to check for HTML content
 * @returns true if HTML content is detected, false otherwise
 */
export default function isHtml(str: string): boolean {
  const len = str.length;

  // Empty or very short strings can't be HTML
  if (len < 3) return false;

  const scanLimit = len < 1000 ? len : 1000;

  let pos = str.indexOf("<");

  // No '<' found or beyond scan limit
  if (pos < 0 || pos >= scanLimit) return false;

  // Check for null bytes (binary content detection)
  const nullPos = str.indexOf("\0");
  if (nullPos !== -1 && nullPos < scanLimit) return false;

  // Check if there's a '>' anywhere after '<'
  const hasClosingBracket = str.indexOf(">", pos) !== -1;

  // Process all '<' characters within scan limit
  while (pos >= 0 && pos < scanLimit) {
    const nextPos = pos + 1;
    if (nextPos >= scanLimit) break;

    const nextCode = str.charCodeAt(nextPos);

    // Check for <!doctype html>
    if (nextCode === CHAR_EXCLAIM) {
      if (isDoctypeHtml(str, nextPos + 1, scanLimit)) {
        return true;
      }
    } else if (isValidHtmlTag(str, nextPos, scanLimit, hasClosingBracket)) {
      return true;
    }

    pos = str.indexOf("<", nextPos);
  }

  return false;
}
