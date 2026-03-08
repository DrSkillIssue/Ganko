/**
 * HTML Utilities
 *
 * Common HTML-related constants and utilities.
 */

/**
 * HTML void elements that cannot have children per HTML specification.
 * These elements are self-closing by nature in HTML.
 *
 * @see https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
export const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * HTML heading elements (h1–h6).
 *
 * Used for nesting validation, CSS element-kind classification,
 * and layout heuristics.
 */
export const HEADING_ELEMENTS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * Check if a tag name represents a void element.
 *
 * @param tagName - The HTML tag name to check
 * @returns True if the tag is a void element
 */
export function isVoidElement(tagName: string): boolean {
  return HTML_VOID_ELEMENTS.has(tagName);
}

/**
 * Check if a tag name is a DOM element (HTML tag).
 *
 * Returns true for lowercase tag names without namespaces or member expressions.
 * Returns false for component names (PascalCase), namespaced tags (on:click),
 * and member expressions (Foo.Bar).
 *
 * @param tagName - The tag name to check, or null
 * @returns True if this is a DOM element tag, false otherwise
 */
export function isDomElement(tagName: string | null): boolean {
  if (!tagName) return false;
  if (tagName.indexOf(":") !== -1) return false;
  if (tagName.indexOf(".") !== -1) return false;
  const firstChar = tagName[0];
  if (firstChar === undefined) return false;
  return firstChar === firstChar.toLowerCase();
}
