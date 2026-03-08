/**
 * CSS Value Parsing Utilities
 *
 * Functions for parsing and analyzing CSS values using postcss-value-parser.
 */

import type { Node as ValueNode } from "postcss-value-parser";
import valueParser from "postcss-value-parser";
import {
  CHAR_HYPHEN,
  CHAR_DOT,
  CHAR_PERCENT,
  CHAR_0,
  CHAR_9,
  CHAR_OPEN_PAREN,
  CHAR_A,
  CHAR_R,
  CHAR_V_LOWER,
  CHAR_V_UPPER,
  isHexColor,
  isAlpha,
} from "@drskillissue/ganko-shared";

/**
 * Parsed CSS value with component breakdown.
 */
export interface ParsedValue {
  nodes: ParsedValueNode[];
  hasCalc: boolean;
  hasVar: boolean;
  hasUrl: boolean;
  hasFunction: boolean;
  colors: string[];
  units: string[];
}

/**
 * A node in a parsed CSS value.
 */
export interface ParsedValueNode {
  type: "word" | "string" | "function" | "space" | "div" | "comment";
  value: string;
  sourceIndex: number;
}

/**
 * A var() reference extracted from a CSS value.
 */
export interface VarReference {
  name: string;
  fallback: string | null;
  sourceIndex: number;
  raw: string;
}

/**
 * Information about a function call in a CSS value.
 */
export interface FunctionCallInfo {
  name: string;
  arguments: string[];
  raw: string;
  sourceIndex: number;
}

const CALC_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);
const NAMED_COLORS = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
  "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue",
  "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan",
  "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey",
  "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
  "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey",
  "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey",
  "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro",
  "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
  "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink",
  "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey",
  "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon",
  "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred",
  "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy",
  "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru",
  "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown",
  "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna",
  "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "transparent", "turquoise", "violet",
  "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
  "currentcolor", "inherit", "initial", "unset", "revert",
]);

const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklch", "oklab", "color", "color-mix"]);

/**
 * Extract unit from a CSS numeric value.
 * Returns null if the value doesn't have a unit.
 * Parses values like "10px", "2.5em", "100%".
 *
 * @param value - The CSS value to extract unit from
 * @returns The unit string (e.g., "px", "em", "%") or null if no unit
 *
 * @example
 * extractUnitFromValue("10px")   // "px"
 * extractUnitFromValue("2.5em")  // "em"
 * extractUnitFromValue("100")    // null
 */
function extractUnitFromValue(value: string): string | null {
  let i = 0;
  const len = value.length;
  // Skip optional negative sign
  if (i < len && value.charCodeAt(i) === CHAR_HYPHEN) i++;
  // Must have at least one digit or dot
  const start = i;
  // Skip digits and dots
  while (i < len) {
    const c = value.charCodeAt(i);
    if ((c >= CHAR_0 && c <= CHAR_9) || c === CHAR_DOT) i++;
    else break;
  }
  // Must have consumed at least one numeric char and have remaining chars for unit
  if (i === start || i === len) return null;
  // Remaining chars must be valid unit chars (letters or %)
  const unitStart = i;
  while (i < len) {
    const c = value.charCodeAt(i);
    if (isAlpha(c) || c === CHAR_PERCENT) i++;
    else return null; // Invalid char in unit
  }
  return i > unitStart ? value.slice(unitStart) : null;
}

const NODE_TYPE_MAP: Record<string, ParsedValueNode["type"]> = {
  word: "word",
  string: "string",
  function: "function",
  space: "space",
  div: "div",
  comment: "comment",
};

/**
 * Map postcss-value-parser node types to our simplified types.
 * Converts external parser types to our internal type system.
 *
 * @param type - The postcss-value-parser node type
 * @returns The corresponding ParsedValueNode type
 */
function mapNodeType(type: string): ParsedValueNode["type"] {
  return NODE_TYPE_MAP[type] ?? "word";
}

/**
 * Result of parsing a CSS value with function calls.
 */
export interface ParsedValueWithFunctions {
  parsedValue: ParsedValue;
  functionCalls: FunctionCallInfo[];
  varReferences: VarReference[];
}

const EMPTY_PARSED_VALUE: ParsedValueWithFunctions = {
  parsedValue: { nodes: [], hasCalc: false, hasVar: false, hasUrl: false, hasFunction: false, colors: [], units: [] },
  functionCalls: [],
  varReferences: [],
};

/**
 * Context object for the hoisted walk function.
 */
interface WalkContext {
  nodes: ParsedValueNode[];
  colors: string[];
  unitSet: Set<string>;
  functionCalls: FunctionCallInfo[];
  varReferences: VarReference[];
  hasCalc: boolean;
  hasVar: boolean;
  hasUrl: boolean;
  hasFunction: boolean;
}

/**
 * Walk function that operates on explicit context.
 * Traverses a value parser node tree, extracting information
 * into the provided context object (colors, units, functions, etc.).
 *
 * @param node - The postcss-value-parser node to walk
 * @param ctx - The context object to populate with extracted information
 */
function walkNodeWithContext(node: ValueNode, ctx: WalkContext): void {
  const mappedType = mapNodeType(node.type);
  ctx.nodes.push({
    type: mappedType,
    value: node.value,
    sourceIndex: node.sourceIndex ?? 0,
  });

  if (node.type === "function") {
    ctx.hasFunction = true;
    const funcNode = node;
    const funcName = node.value.toLowerCase();
    const raw = valueParser.stringify(node);

    if (CALC_FUNCTIONS.has(funcName)) ctx.hasCalc = true;
    else if (funcName === "var") ctx.hasVar = true;
    else if (funcName === "url") ctx.hasUrl = true;

    if (COLOR_FUNCTIONS.has(funcName)) {
      ctx.colors.push(raw);
    }

    const childNodes = funcNode.nodes;
    if (!childNodes) return;

    const argParts: string[] = [];
    const args: string[] = [];
    const isVar = funcName === "var";

    // For var() functions, track name and fallback in the same loop
    let varName = "";
    let foundComma = false;
    const fallbackParts: string[] = [];

    for (const child of childNodes) {
      if (child.type === "div" && child.value === ",") {
        const trimmed = argParts.join("").trim();
        if (trimmed) args.push(trimmed);
        argParts.length = 0;
        if (isVar) foundComma = true;
      } else {
        const childStr = valueParser.stringify(child);
        argParts.push(childStr);
        // For var(), extract name and fallback in the same pass
        if (isVar) {
          if (!foundComma) {
            if (child.type === "word") varName = child.value;
          } else {
            fallbackParts.push(childStr);
          }
        }
      }
    }

    const trimmedFinal = argParts.join("").trim();
    if (trimmedFinal) args.push(trimmedFinal);

    ctx.functionCalls.push({
      name: node.value,
      arguments: args,
      raw,
      sourceIndex: node.sourceIndex ?? 0,
    });

    // Push var reference if this was a var() function
    if (isVar && varName) {
      ctx.varReferences.push({
        name: varName,
        fallback: fallbackParts.length > 0 ? fallbackParts.join("").trim() : null,
        sourceIndex: node.sourceIndex ?? 0,
        raw,
      });
    }

    for (const child of childNodes) {
      walkNodeWithContext(child, ctx);
    }
    return;
  }

  if (node.type !== "word") return;

  const val = node.value.toLowerCase();
  const valLen = val.length;
  // Hex color check uses charCode-based validation
  // Named color check uses length bounds (min 3 "red", max 20 "lightgoldenrodyellow")
  if (isHexColor(val) || (valLen >= 3 && valLen <= 20 && NAMED_COLORS.has(val))) {
    ctx.colors.push(node.value);
  }

  const unit = extractUnitFromValue(node.value);
  if (unit) {
    ctx.unitSet.add(unit);
  }
}

/**
 * Parse a CSS value string and extract function calls together.
 *
 * @param value - The CSS value to parse
 * @returns Parsed value with component breakdown and function calls
 *
 * @example
 * parseValueWithFunctions("calc(100% - var(--spacing))")
 * // Returns: { parsedValue: {...}, functionCalls: [...], varReferences: [...] }
 */
export function parseValueWithFunctions(value: string): ParsedValueWithFunctions {
  if (!value) return EMPTY_PARSED_VALUE;

  const parsed = valueParser(value);

  // Create context object for the hoisted walk function
  const ctx: WalkContext = {
    nodes: [],
    colors: [],
    unitSet: new Set<string>(),
    functionCalls: [],
    varReferences: [],
    hasCalc: false,
    hasVar: false,
    hasUrl: false,
    hasFunction: false,
  };

  for (const node of parsed.nodes) {
    walkNodeWithContext(node, ctx);
  }

  return {
    parsedValue: {
      nodes: ctx.nodes,
      hasCalc: ctx.hasCalc,
      hasVar: ctx.hasVar,
      hasUrl: ctx.hasUrl,
      hasFunction: ctx.hasFunction,
      colors: ctx.colors,
      units: Array.from(ctx.unitSet),
    },
    functionCalls: ctx.functionCalls,
    varReferences: ctx.varReferences,
  };
}

/**
 * Check if a string contains "var(" (case-insensitive).
 * Scans charCodes directly for the pattern.
 *
 * @param s - The string to search
 * @returns True if the string contains "var("
 *
 * @example
 * hasVarParen("var(--color)")     // true
 * hasVarParen("VAR(--color)")     // true
 * hasVarParen("10px solid red")   // false
 */
function hasVarParen(s: string): boolean {
  const len = s.length;
  if (len < 4) return false;
  const end = len - 3;
  for (let i = 0; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c !== CHAR_V_LOWER && c !== CHAR_V_UPPER) continue;
    if ((s.charCodeAt(i + 1) | 32) !== CHAR_A) continue;
    if ((s.charCodeAt(i + 2) | 32) !== CHAR_R) continue;
    if (s.charCodeAt(i + 3) !== CHAR_OPEN_PAREN) continue;
    return true;
  }
  return false;
}

/**
 * Extract var() references from a CSS value.
 * Delegates to parseValueWithFunctions for a single parse pass.
 *
 * @param value - The CSS value to analyze
 * @returns Array of var() references with names and fallbacks
 *
 * @example
 * extractVarReferences("var(--color, red)")
 * // Returns: [{ name: "--color", fallback: "red", raw: "var(--color, red)", sourceIndex: 0 }]
 */
export function extractVarReferences(value: string): readonly VarReference[] {
  if (!value || !hasVarParen(value)) return [];
  return parseValueWithFunctions(value).varReferences;
}
