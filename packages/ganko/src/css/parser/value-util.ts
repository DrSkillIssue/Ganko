import { WHITESPACE_SPLIT, splitByComma } from "@ganko/shared"
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
  if (trimmed.includes("var(") || trimmed.includes("calc(") || trimmed.includes("%")) return null
  if (CSS_WIDE_KEYWORDS.has(trimmed)) return null

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


