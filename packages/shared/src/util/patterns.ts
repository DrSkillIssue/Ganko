/**
 * Regex Patterns
 *
 * Centralized regex patterns for parsing and analyzing CSS selectors,
 * media queries, and Solid.js naming conventions.
 */

// Solid.js Naming Patterns

/** Pattern for custom hook names (useFoo, createFoo) */
export const HOOK_PATTERN = /^(use|create)[A-Z]/;

/** Pattern for component names (PascalCase) */
export const COMPONENT_PATTERN = /^[A-Z]/;

/** Pattern for event handler properties: onClick, onMouseEnter, etc. */
export const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

/** Pattern for event handler variables: handleClick, onSubmit, etc. */
export const EVENT_HANDLER_VAR_PATTERN = /^(handle|on)[A-Z]/;

// CSS Selector Patterns - Sticky (for sequential parsing)

/**
 * Matches an ID selector: #identifier
 * Capture group 1: the identifier without the #
 */
export const ID_STICKY = /#([a-zA-Z_-][a-zA-Z0-9_-]*)/y;

/**
 * Matches a class selector: .identifier
 * Capture group 1: the identifier without the .
 */
export const CLASS_STICKY = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/y;

/**
 * Matches an attribute selector: [attr] or [attr=value]
 * Capture group 1: the content inside brackets
 */
export const ATTRIBUTE_STICKY = /\[([^\]]+)\]/y;

/**
 * Matches a pseudo-element: ::name or ::name(args)
 * Capture group 1: the pseudo-element name
 */
export const PSEUDO_ELEMENT_STICKY = /::([a-zA-Z-]+)(?:\([^)]*\))?/y;

/**
 * Matches a pseudo-class: :name or :name(args)
 * Capture group 1: the pseudo-class name
 */
export const PSEUDO_CLASS_STICKY = /:([a-zA-Z-]+)(?:\([^)]*\))?/y;

/**
 * Matches an element selector: tagname
 * Capture group 1: the element name
 */
export const ELEMENT_STICKY = /([a-zA-Z][a-zA-Z0-9-]*)/y;

// CSS Selector Patterns - Non-Sticky (for detection)

/**
 * Matches an ID selector in a string.
 * Non-global for simple detection.
 */
export const HAS_ID_RE = /#[a-zA-Z_-][a-zA-Z0-9_-]*/;

/**
 * Matches a universal selector in context.
 * Detects * that's not part of an identifier.
 */
export const HAS_UNIVERSAL_RE = /(?:^|[\s>+~])\*(?:$|[\s>+~.#:[])/ ;

/**
 * Matches an attribute selector.
 */
export const HAS_ATTRIBUTE_RE = /\[[^\]]+\]/;

// CSS Selector Patterns - Global (for counting/matching all)

/**
 * Matches all ID selectors in a string.
 */
export const ID_GLOBAL = /#[a-zA-Z_-][a-zA-Z0-9_-]*/g;

/**
 * Matches all class selectors in a string.
 */
export const CLASS_GLOBAL = /\.[a-zA-Z_-][a-zA-Z0-9_-]*/g;

/**
 * Matches all attribute selectors in a string.
 */
export const ATTRIBUTE_GLOBAL = /\[[^\]]+\]/g;

/**
 * Matches all pseudo-elements in a string.
 */
export const PSEUDO_ELEMENT_GLOBAL = /::[a-zA-Z-]+/g;

/**
 * Matches all simple pseudo-classes (non-functional).
 */
export const PSEUDO_CLASS_GLOBAL = /:[a-zA-Z-]+(?!\()/g;

/**
 * Matches functional pseudo-classes like :is(), :not(), :where(), etc.
 */
export const FUNCTIONAL_PSEUDO_GLOBAL = /:(is|not|has|where|nth-child|nth-of-type|nth-last-child|nth-last-of-type)\(/g;

// CSS Utility Patterns

/**
 * Pattern for detecting universal selector.
 * Slightly different from HAS_UNIVERSAL_RE - used in complexity analysis.
 */
export const UNIVERSAL_SELECTOR_RE = /(?:^|\s|>|\+|~)\*(?:\s|$|>|\+|~|:|\.|\[|#)/;

/**
 * Pattern for splitting selectors on combinators while preserving them.
 */
export const COMBINATOR_SPLIT_RE = /(\s*>\s*|\s*\+\s*|\s*~\s*|\s+)/;

/**
 * Pattern for splitting on whitespace runs. Used for tokenizing
 * class name strings, CSS value lists, etc.
 */
export const WHITESPACE_SPLIT = /\s+/;

/**
 * Pattern to test if a string is only whitespace.
 */
export const WHITESPACE_ONLY_RE = /^\s+$/;

/**
 * Pattern for matching :where() content (0 specificity).
 */
export const WHERE_CONTENT_RE = /:where\([^)]*\)/gi;

/**
 * Pattern for matching :is(), :not(), :has() with content.
 */
export const SPECIFICITY_PSEUDO_RE = /:(is|not|has)\(([^)]+)\)/gi;

/**
 * Pattern for matching CSS function calls.
 */
export const FUNCTION_CALL_RE = /([a-zA-Z_][\w-]*)\s*\(/g;

// Media Query Patterns

/**
 * Pattern for container queries: name? (condition)
 */
export const CONTAINER_RE = /^(\S+)?\s*\((.+)\)$/;

/**
 * Pattern for media type: all | screen | print | speech
 */
export const MEDIA_TYPE_RE = /^(all|screen|print|speech)\b/i;

/**
 * Pattern for extracting media features in parentheses.
 */
export const MEDIA_FEATURE_RE = /\(([^)]+)\)/g;

/**
 * Pattern for range media feature: width >= 100px
 */
export const MEDIA_RANGE_RE = /^([a-z-]+)\s*([<>]=?)\s*(.+)$/i;

/**
 * Pattern for colon media feature: min-width: 100px
 */
export const MEDIA_COLON_RE = /^([a-z-]+)\s*:\s*(.+)$/i;

// CSS Value Patterns

/**
 * Pattern for !important suffix.
 */
export const IMPORTANT_SUFFIX_RE = /\s*!important\s*$/i;

/**
 * Pattern for time values (1s, 200ms, 0.5s).
 */
export const TIME_VALUE_RE = /^\d+(?:\.\d+)?(?:s|ms)$/i;

/**
 * Pattern for plain numbers.
 */
export const NUMBER_RE = /^\d+(?:\.\d+)?$/;

/**
 * Pattern for duration with s or ms unit.
 */
export const DURATION_RE = /^\d+(?:\.\d+)?(?:s|ms)$/;

/**
 * Pattern for integer (iteration count).
 */
export const INTEGER_RE = /^\d+$/;

/**
 * Pattern for cubic-bezier() and steps() functions.
 */
export const TIMING_FUNCTION_RE = /^(?:cubic-bezier|steps)\(/i;

/**
 * Cache for compiled glob-style regex patterns.
 */
// eslint-disable-next-line solid/unbounded-collection -- bounded by finite set of pattern strings
const globPatternCache = new Map<string, RegExp>();
const GLOB_STAR_G = /\*/g;

/**
 * Convert a glob-style pattern to a RegExp.
 * Only supports * wildcard (matches any characters).
 *
 * @param pattern - The glob pattern (e.g., "props*")
 * @returns A compiled RegExp for the pattern
 */
function globToRegex(pattern: string): RegExp {
  let regex = globPatternCache.get(pattern);
  if (!regex) {
    regex = new RegExp("^" + pattern.replace(GLOB_STAR_G, ".*") + "$");
    globPatternCache.set(pattern, regex);
  }
  return regex;
}

/**
 * Check if a name matches a glob-style pattern.
 *
 * @param name - The name to check
 * @param pattern - The pattern to match (supports * wildcard)
 * @returns True if the name matches the pattern
 *
 * @example
 * matchesGlobPattern("propsLocal", "props*")  // true
 * matchesGlobPattern("myProps", "*Props")     // true
 * matchesGlobPattern("other", "props*")       // false
 */
export function matchesGlobPattern(name: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    return globToRegex(pattern).test(name);
  }
  return pattern === name;
}

/**
 * Check if a name matches any of the provided glob-style patterns.
 *
 * @param name - The name to check
 * @param patterns - Array of patterns to match (supports * wildcard)
 * @returns True if the name matches any pattern
 *
 * @example
 * matchesAnyGlobPattern("propsLocal", ["props*", "local*"])  // true
 * matchesAnyGlobPattern("other", ["props*", "local*"])       // false
 */
export function matchesAnyGlobPattern(name: string, patterns: readonly string[]): boolean {
  for (let i = 0, len = patterns.length; i < len; i++) {
    const pat = patterns[i];
    if (pat !== undefined && matchesGlobPattern(name, pat)) return true;
  }
  return false;
}
