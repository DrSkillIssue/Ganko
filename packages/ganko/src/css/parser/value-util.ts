import { WHITESPACE_SPLIT, splitByComma } from "@drskillissue/ganko-shared"
import { splitTopLevelComma, splitTopLevelWhitespace } from "./value-tokenizer"
import { isTransitionKeywordToken } from "./animation-transition-keywords"
import { CSS_WIDE_KEYWORDS } from "./css-keywords"

const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/
const NUMERIC_VALUE = /^([0-9]*\.?[0-9]+)(px|rem|em|pt)?$/

/**
 * Parse a CSS length value to pixels.
 * Handles px, rem (assumes 16px base), em (requires context fontSize),
 * pt, and unitless numbers. Returns null for dynamic values (var, calc, %).
 * @param raw Raw CSS value string
 * @param contextFontSize Font size in px for em conversion (defaults to 16)
 */
export function parsePxValue(raw: string, contextFontSize = 16): number | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  if (trimmed.includes("var(") || trimmed.includes("%")) return null
  if (CSS_WIDE_KEYWORDS.has(trimmed)) return null

  // Attempt to evaluate constant calc() expressions before bailing
  if (trimmed.includes("calc(")) {
    return tryEvalConstantCalc(trimmed, contextFontSize)
  }

  // Evaluate min()/max()/clamp() with all-static arguments
  if (trimmed.startsWith("min(") || trimmed.startsWith("max(") || trimmed.startsWith("clamp(")) {
    return tryEvalMathFunction(trimmed, contextFontSize)
  }

  const match = NUMERIC_VALUE.exec(trimmed)
  if (!match) return null

  const num = Number(match[1])
  const unit = match[2] ?? ""

  if (unit === "px" || unit === "") return num
  if (unit === "rem") return num * 16
  if (unit === "em") return num * contextFontSize
  if (unit === "pt") return num * 1.333
  return null
}

const CALC_CONSTANT_RE = /^calc\((.+)\)$/
const CALC_TOKEN_RE = /([0-9]*\.?[0-9]+)(px|rem|em|pt)?|([+\-*/])/g

/**
 * Evaluates a `calc()` expression to a px value when all operands are constant
 * (px, rem, em, pt, unitless). Returns null if the expression contains dynamic
 * values (var, %, env) or cannot be statically reduced.
 *
 * Supports +, -, *, / operators with correct precedence via two-pass evaluation.
 */
function tryEvalConstantCalc(raw: string, contextFontSize: number): number | null {
  const match = CALC_CONSTANT_RE.exec(raw)
  if (!match || !match[1]) return null
  const inner = match[1].trim()
  if (inner.includes("var(") || inner.includes("%") || inner.includes("env(") || inner.includes("calc(")) return null

  const values: number[] = []
  const operators: string[] = []
  let lastWasValue = false

  CALC_TOKEN_RE.lastIndex = 0
  let tokenMatch: RegExpExecArray | null
  while ((tokenMatch = CALC_TOKEN_RE.exec(inner)) !== null) {
    const op = tokenMatch[3]
    if (op !== undefined) {
      if (!lastWasValue && op === "-") {
        // Unary minus — negate the next value
        const nextToken = CALC_TOKEN_RE.exec(inner)
        if (!nextToken || nextToken[3] !== undefined) return null
        const px = calcTokenToPx(nextToken, contextFontSize)
        if (px === null) return null
        values.push(-px)
        lastWasValue = true
        continue
      }
      if (!lastWasValue) return null
      operators.push(op)
      lastWasValue = false
      continue
    }
    const px = calcTokenToPx(tokenMatch, contextFontSize)
    if (px === null) return null
    values.push(px)
    lastWasValue = true
  }

  if (values.length === 0 || values.length !== operators.length + 1) return null

  // Two-pass evaluation: * and / first, then + and -
  const firstValue = values[0]
  if (firstValue === undefined) return null
  const reducedValues: number[] = [firstValue]
  const reducedOps: string[] = []

  for (let i = 0; i < operators.length; i++) {
    const op = operators[i]
    const right = values[i + 1]
    if (op === undefined || right === undefined) return null
    if (op === "*") {
      const last = reducedValues[reducedValues.length - 1]
      if (last === undefined) return null
      reducedValues[reducedValues.length - 1] = last * right
    } else if (op === "/") {
      if (right === 0) return null
      const last = reducedValues[reducedValues.length - 1]
      if (last === undefined) return null
      reducedValues[reducedValues.length - 1] = last / right
    } else {
      reducedValues.push(right)
      reducedOps.push(op)
    }
  }

  const base = reducedValues[0]
  if (base === undefined) return null
  let result = base
  for (let i = 0; i < reducedOps.length; i++) {
    const op = reducedOps[i]
    const right = reducedValues[i + 1]
    if (op === undefined || right === undefined) return null
    if (op === "+") result += right
    else if (op === "-") result -= right
    else return null
  }

  return Number.isFinite(result) ? result : null
}

function calcTokenToPx(tokenMatch: RegExpExecArray, contextFontSize: number): number | null {
  const num = Number(tokenMatch[1])
  if (Number.isNaN(num)) return null
  const unit = tokenMatch[2] ?? ""
  if (unit === "px" || unit === "") return num
  if (unit === "rem") return num * 16
  if (unit === "em") return num * contextFontSize
  if (unit === "pt") return num * 1.333
  return null
}

const MATH_FN_RE = /^(min|max|clamp)\((.+)\)$/

/**
 * Evaluates CSS math functions (min, max, clamp) when all arguments are
 * statically resolvable to px values.
 *
 * - `min(a, b, ...)` → smallest value (guaranteed rendered size)
 * - `max(a, b, ...)` → largest value (guaranteed minimum)
 * - `clamp(min, val, max)` → val clamped to [min, max]
 *
 * Returns null if any argument contains dynamic values (%, var, env, vw, vh).
 */
function tryEvalMathFunction(raw: string, contextFontSize: number): number | null {
  const match = MATH_FN_RE.exec(raw)
  if (!match || !match[1] || !match[2]) return null
  const fn = match[1]
  const inner = match[2]

  // Split arguments on top-level commas (respecting nested parentheses)
  const args = splitMathArgs(inner)
  if (args === null) return null

  // Recursively parse each argument — supports nested calc(), min(), max()
  const values: number[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) return null
    const px = parsePxValue(arg.trim(), contextFontSize)
    if (px === null) return null
    values.push(px)
  }

  if (values.length === 0) return null

  if (fn === "min") return Math.min(...values)
  if (fn === "max") return Math.max(...values)
  if (fn === "clamp") {
    if (values.length !== 3) return null
    const [lo, val, hi] = values as [number, number, number]
    return Math.max(lo, Math.min(val, hi))
  }

  return null
}

function splitMathArgs(inner: string): string[] | null {
  const args: string[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === "(") depth++
    else if (ch === ")") { if (depth > 0) depth--; else return null }
    else if (ch === "," && depth === 0) {
      const arg = inner.slice(start, i).trim()
      if (arg.length === 0) return null
      args.push(arg)
      start = i + 1
    }
  }

  if (depth !== 0) return null
  const tail = inner.slice(start).trim()
  if (tail.length === 0) return null
  args.push(tail)
  return args
}

/**
 * Parse a unitless CSS number (line-height, spacing multipliers).
 * Returns null for values with units, var(), calc(), or keywords.
 */
export function parseUnitlessValue(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  if (trimmed.includes("var(") || trimmed.includes("calc(")) return null
  if (CSS_WIDE_KEYWORDS.has(trimmed)) return null

  const num = Number(trimmed)
  if (Number.isNaN(num)) return null
  return num
}

/**
 * Parse a CSS em value. Returns null for non-em values.
 */
export function parseEmValue(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed.endsWith("em")) return null
  if (trimmed.endsWith("rem")) return null
  const num = Number(trimmed.slice(0, -2))
  if (Number.isNaN(num)) return null
  return num
}
export { CSS_WIDE_KEYWORDS }
const RESERVED_CONTAINER_NAMES = new Set(["normal", "none"])
const CONTAINER_TYPE_KEYWORDS = new Set(["normal", "size", "inline-size"])

function isContainerCustomIdent(token: string): boolean {
  if (!IDENT.test(token)) return false
  const lower = token.toLowerCase()
  if (CSS_WIDE_KEYWORDS.has(lower)) return false
  if (RESERVED_CONTAINER_NAMES.has(lower)) return false
  return true
}

/**
 * Split a comma-separated value list into trimmed tokens.
 * @param v Raw CSS value
 * @returns Non-empty tokens
 */
export function splitComma(v: string): readonly string[] {
  return splitByComma(v, { respectBrackets: false })
}

export function normalizeAnimationName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null

  if (trimmed[0] === "\"" && trimmed[trimmed.length - 1] === "\"") {
    const unquoted = trimmed.slice(1, -1).trim()
    if (unquoted.length === 0) return null
    return unquoted
  }

  if (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
    const unquoted = trimmed.slice(1, -1).trim()
    if (unquoted.length === 0) return null
    return unquoted
  }

  return trimmed
}

/**
 * Parse named containers from a container-name declaration.
 * @param value Declaration value
 * @returns Declared container names excluding "normal"
 */
export function parseContainerNames(value: string): readonly string[] {
  const parts = value.trim().split(WHITESPACE_SPLIT)
  const out: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    if (!raw) continue
    const token = raw.trim()
    if (token.length === 0) continue
    if (!isContainerCustomIdent(token)) continue
    out.push(token)
  }
  return out
}

/**
 * Parse optional named container prefix from `@container` params.
 * @param params Container at-rule params
 * @returns Named container or null when query is unnamed/unsupported
 */
export function parseContainerQueryName(params: string): string | null {
  const open = params.indexOf("(")
  const prefix = open === -1 ? params.trim() : params.slice(0, open).trim()
  if (prefix.length === 0) return null

  const lower = prefix.toLowerCase()
  if (lower === "style" || lower === "scroll-state") return null

  const names = parseContainerNames(prefix)
  if (names.length !== 1) return null
  return names[0] ?? null
}

/**
 * Parse container names from shorthand `container: <name-list> / <type>`.
 * @param value Declaration value
 * @returns Statically known named containers from shorthand head
 */
export function parseContainerNamesFromShorthand(value: string): readonly string[] {
  const trimmed = value.trim()
  if (trimmed.length === 0) return []

  const slash = trimmed.indexOf("/")
  const head = (slash === -1 ? trimmed : trimmed.slice(0, slash)).trim()
  if (head.length === 0) return []

  const names = parseContainerNames(head)
  const out: string[] = []

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!name) continue
    if (CONTAINER_TYPE_KEYWORDS.has(name.toLowerCase())) continue
    out.push(name)
  }

  return out
}

/**
 * Parse container name from shorthand `container: <name> / <type>`.
 * @param value Declaration value
 * @returns Container name or null when not statically known
 */
export function parseContainerNameFromShorthand(value: string): string | null {
  const names = parseContainerNamesFromShorthand(value)
  if (names.length !== 1) return null
  return names[0] ?? null
}

/**
 * Find the first transition shorthand token whose property name is in the given set.
 * Parses `transition: <property> <duration> ...` comma-separated layers.
 * @param value Raw transition value
 * @param properties Set of property names to match
 * @returns Matched property or null
 */
export function findTransitionProperty(value: string, properties: Set<string>): string | null {
  const layers = splitTopLevelComma(value.toLowerCase())

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!layer) continue
    const tokens = splitTopLevelWhitespace(layer)
    for (let j = 0; j < tokens.length; j++) {
      const token = tokens[j]
      if (!token) continue
      if (isTransitionKeywordToken(token)) continue
      if (!properties.has(token)) break
      return token
    }
  }

  return null
}

/**
 * Find the first value in a `transition-property` list that is in the given set.
 * @param value Raw transition-property value
 * @param properties Set of property names to match
 * @returns Matched property or null
 */
export function findPropertyInList(value: string, properties: Set<string>): string | null {
  const parts = splitComma(value.toLowerCase())
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    if (properties.has(part)) return part
  }
  return null
}


