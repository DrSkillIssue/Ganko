/**
 * Variable Naming Pattern Analysis
 *
 * Functions for analyzing CSS custom property names to infer
 * theme token categories and extract semantic information.
 */

import { stripVarPrefix, endsWithCaseInsensitive, startsWithCaseInsensitive, isDigit } from "@ganko/shared";
import type { TokenCategory } from "../entities/token";

export type { TokenCategory };

/**
 * Single regex to extract token name in one pass.
 * Captures the semantic name after stripping prefix and variant suffix.
 * Requires token name to start with alphanumeric to avoid matching just dashes.
 */
const EXTRACT_NAME_REGEX = /^-*(?:color-|clr-|bg-|text-|space-|spacing-|gap-|font-size-|font-weight-|font-family-|font-|border-radius-|border-|shadow-|elevation-|radius-|rounded-|z-index-|z-|layer-|animation-|transition-|duration-|breakpoint-|screen-|bp-)?([a-z0-9][a-z0-9-]*?)(?:-(?:\d{2,3}|light|dark|hover|focus|active|disabled))?$/i;

/**
 * Known variant suffixes.
 */
const KNOWN_VARIANTS = new Set([
  "light", "lighter", "lightest",
  "dark", "darker", "darkest",
  "hover", "focus", "active", "disabled", "pressed",
  "muted", "subtle", "emphasis", "default", "base", "strong",
  "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl",
]);

/**
 * Infer the token category from a CSS variable name.
 *
 * @param name - The variable name (with or without --)
 * @returns The inferred token category, or null if no category matches
 *
 * @example
 * inferTokenCategory("--color-primary")  // "color"
 * inferTokenCategory("--spacing-md")     // "spacing"
 * inferTokenCategory("--my-custom-var")  // null
 */
export function inferTokenCategory(name: string): TokenCategory | null {
  if (!name) return null;

  const stripped = stripVarPrefix(name);
  if (!stripped) return null;

  const c0 = stripped.charCodeAt(0);

  switch (c0) {
    case 97: // 'a'
      if (startsWithCaseInsensitive(stripped, "accent-")) return "color";
      if (startsWithCaseInsensitive(stripped, "animation-")) return "animation";
      break;
    case 98: // 'b'
      if (startsWithCaseInsensitive(stripped, "bg-")) return "color";
      if (startsWithCaseInsensitive(stripped, "body-")) return "typography";
      if (startsWithCaseInsensitive(stripped, "brand")) return "color";
      if (startsWithCaseInsensitive(stripped, "border-")) return "border";
      if (startsWithCaseInsensitive(stripped, "box-shadow-")) return "shadow";
      if (startsWithCaseInsensitive(stripped, "breakpoint-")) return "breakpoint";
      if (startsWithCaseInsensitive(stripped, "bp-")) return "breakpoint";
      break;
    case 99: // 'c'
      if (startsWithCaseInsensitive(stripped, "color-")) return "color";
      if (startsWithCaseInsensitive(stripped, "clr-")) return "color";
      if (startsWithCaseInsensitive(stripped, "corner-")) return "radius";
      break;
    case 100: // 'd'
      if (startsWithCaseInsensitive(stripped, "danger")) return "color";
      if (startsWithCaseInsensitive(stripped, "delay-")) return "animation";
      if (startsWithCaseInsensitive(stripped, "divider-")) return "border";
      if (startsWithCaseInsensitive(stripped, "drop-shadow-")) return "shadow";
      if (startsWithCaseInsensitive(stripped, "duration-")) return "animation";
      break;
    case 101: // 'e'
      if (startsWithCaseInsensitive(stripped, "ease-")) return "animation";
      if (startsWithCaseInsensitive(stripped, "elevation-")) return "shadow";
      if (startsWithCaseInsensitive(stripped, "error")) return "color";
      break;
    case 102: // 'f'
      if (startsWithCaseInsensitive(stripped, "font-")) return "typography";
      break;
    case 103: // 'g'
      if (startsWithCaseInsensitive(stripped, "gap-")) return "spacing";
      break;
    case 104: // 'h'
      if (startsWithCaseInsensitive(stripped, "heading-")) return "typography";
      break;
    case 105: // 'i'
      if (startsWithCaseInsensitive(stripped, "info")) return "color";
      if (startsWithCaseInsensitive(stripped, "inset-")) return "spacing";
      break;
    case 108: // 'l'
      if (startsWithCaseInsensitive(stripped, "layer-")) return "z-index";
      if (startsWithCaseInsensitive(stripped, "letter-spacing-")) return "typography";
      if (startsWithCaseInsensitive(stripped, "line-height-")) return "typography";
      break;
    case 109: // 'm'
      if (startsWithCaseInsensitive(stripped, "margin-")) return "spacing";
      if (startsWithCaseInsensitive(stripped, "media-")) return "breakpoint";
      if (startsWithCaseInsensitive(stripped, "mono-")) return "typography";
      if (startsWithCaseInsensitive(stripped, "muted")) return "color";
      break;
    case 111: // 'o'
      if (startsWithCaseInsensitive(stripped, "outline-")) return "border";
      break;
    case 112: // 'p'
      if (startsWithCaseInsensitive(stripped, "padding-")) return "spacing";
      if (startsWithCaseInsensitive(stripped, "primary")) return "color";
      break;
    case 114: // 'r'
      if (startsWithCaseInsensitive(stripped, "radius-")) return "radius";
      if (startsWithCaseInsensitive(stripped, "rounded-")) return "radius";
      break;
    case 115: // 's'
      if (startsWithCaseInsensitive(stripped, "screen-")) return "breakpoint";
      if (startsWithCaseInsensitive(stripped, "secondary")) return "color";
      if (startsWithCaseInsensitive(stripped, "shadow-")) return "shadow";
      if (startsWithCaseInsensitive(stripped, "size-")) return "spacing";
      if (startsWithCaseInsensitive(stripped, "space-")) return "spacing";
      if (startsWithCaseInsensitive(stripped, "spacing-")) return "spacing";
      if (startsWithCaseInsensitive(stripped, "stroke-")) return "border";
      if (startsWithCaseInsensitive(stripped, "success")) return "color";
      if (startsWithCaseInsensitive(stripped, "surface")) return "color";
      break;
    case 116: // 't'
      if (startsWithCaseInsensitive(stripped, "text-size-")) return "typography";
      if (startsWithCaseInsensitive(stripped, "text-")) return "color";
      if (startsWithCaseInsensitive(stripped, "transition-")) return "animation";
      break;
    case 119: // 'w'
      if (startsWithCaseInsensitive(stripped, "warning")) return "color";
      break;
    case 122: // 'z'
      if (startsWithCaseInsensitive(stripped, "z-index-")) return "z-index";
      if (startsWithCaseInsensitive(stripped, "z-")) return "z-index";
      break;
  }

  // Suffix checks for color-related endings
  if (endsWithCaseInsensitive(name, "-fg") || endsWithCaseInsensitive(name, "-bg")) {
    return "color";
  }
  if (endsWithCaseInsensitive(name, "-foreground") || endsWithCaseInsensitive(name, "-background")) {
    return "color";
  }

  return null;
}

/**
 * Extract the base token name from a variable name.
 * Strips common prefixes and suffixes to get the semantic name.
 *
 * @param variableName - The variable name to analyze
 * @returns The extracted token name, or null if not determinable
 *
 * @example
 * extractTokenName("--color-primary-500")  // "primary"
 * extractTokenName("--spacing-md")         // "md"
 * extractTokenName("--font-size-lg")       // "lg"
 */
export function extractTokenName(variableName: string): string | null {
  if (!variableName) return null;

  // Single regex extracts the token name in one pass
  const match = EXTRACT_NAME_REGEX.exec(variableName);
  return match?.[1] || null;
}

/**
 * Extract the variant from a variable name.
 * Variants are typically numeric scales (100-900) or state modifiers.
 *
 * @param variableName - The variable name to analyze
 * @returns The extracted variant, or null if not determinable
 *
 * @example
 * extractTokenVariant("--color-primary-500")  // "500"
 * extractTokenVariant("--button-hover")       // "hover"
 * extractTokenVariant("--color-primary")      // null
 */
export function extractTokenVariant(variableName: string): string | null {
  if (!variableName) return null;

  const lastHyphen = variableName.lastIndexOf("-");
  if (lastHyphen === -1 || lastHyphen === variableName.length - 1) return null;

  const suffix = variableName.slice(lastHyphen + 1).toLowerCase();

  // Check for 2-3 digit numeric variant (e.g., 50, 100, 500, 900)
  if (suffix.length >= 2 && suffix.length <= 3) {
    let allDigits = true;
    for (let i = 0; i < suffix.length; i++) {
      if (!isDigit(suffix.charCodeAt(i))) {
        allDigits = false;
        break;
      }
    }
    if (allDigits) return suffix;
  }

  // Check for known named variants
  if (KNOWN_VARIANTS.has(suffix)) return suffix;

  return null;
}
