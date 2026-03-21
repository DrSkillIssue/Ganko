import { parseBlockShorthand, parseQuadShorthand, splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import type { LayoutSignalName } from "./signal-model"

export interface ShorthandExpansionResult {
  readonly name: string
  readonly value: string
}

const QUAD_EXPANSIONS: ReadonlyMap<
  string,
  readonly [string, string, string, string]
> = new Map([
  ["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
  ["border-width", ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]],
  ["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
  ["inset", ["top", "right", "bottom", "left"]],
])

const BLOCK_EXPANSIONS: ReadonlyMap<string, readonly [LayoutSignalName, LayoutSignalName]> = new Map([
  ["margin-block", ["margin-top", "margin-bottom"]],
  ["padding-block", ["padding-top", "padding-bottom"]],
  ["inset-block", ["inset-block-start", "inset-block-end"]],
])

const INLINE_EXPANSIONS: ReadonlyMap<string, readonly [LayoutSignalName, LayoutSignalName]> = new Map([
  ["padding-inline", ["padding-left", "padding-right"]],
])

/**
 * Expand a CSS shorthand property into its longhand components.
 * Returns null if the property is not a recognized shorthand or the value cannot be parsed.
 * Returns undefined if the property is not a shorthand at all.
 */
export function expandShorthand(
  property: string,
  value: string,
): readonly ShorthandExpansionResult[] | null | undefined {
  const quadTarget = QUAD_EXPANSIONS.get(property)
  if (quadTarget !== undefined) {
    const parsed = parseQuadShorthand(value)
    if (parsed === null) return null
    return [
      { name: quadTarget[0], value: parsed.top },
      { name: quadTarget[1], value: parsed.right },
      { name: quadTarget[2], value: parsed.bottom },
      { name: quadTarget[3], value: parsed.left },
    ]
  }

  const blockTarget = BLOCK_EXPANSIONS.get(property)
  if (blockTarget !== undefined) {
    const parsed = parseBlockShorthand(value)
    if (parsed === null) return null
    return [
      { name: blockTarget[0], value: parsed.start },
      { name: blockTarget[1], value: parsed.end },
    ]
  }

  const inlineTarget = INLINE_EXPANSIONS.get(property)
  if (inlineTarget !== undefined) {
    const parsed = parseBlockShorthand(value)
    if (parsed === null) return null
    return [
      { name: inlineTarget[0], value: parsed.start },
      { name: inlineTarget[1], value: parsed.end },
    ]
  }

  if (property === "flex-flow") {
    return expandFlexFlow(value)
  }

  return undefined
}

const FLEX_DIRECTION_VALUES = new Set(["row", "row-reverse", "column", "column-reverse"])

function expandFlexFlow(value: string): readonly ShorthandExpansionResult[] | null {
  const tokens = splitWhitespaceTokens(value.trim().toLowerCase())
  if (tokens.length === 0) return null
  if (tokens.length > 2) return null

  let direction: string | null = null
  let wrap: string | null = null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (FLEX_DIRECTION_VALUES.has(token)) {
      if (direction !== null) return null
      direction = token
    } else {
      if (wrap !== null) return null
      wrap = token
    }
  }

  const out: ShorthandExpansionResult[] = []
  if (direction !== null) {
    out.push({ name: "flex-direction", value: direction })
  }
  if (wrap !== null) {
    out.push({ name: "flex-wrap", value: wrap })
  }
  return out.length > 0 ? out : null
}

export function getShorthandLonghandNames(property: string): readonly string[] | null {
  const quad = QUAD_EXPANSIONS.get(property)
  if (quad !== undefined) return [...quad]
  const block = BLOCK_EXPANSIONS.get(property)
  if (block !== undefined) return [...block]
  const inline = INLINE_EXPANSIONS.get(property)
  if (inline !== undefined) return [...inline]
  if (property === "flex-flow") return ["flex-direction", "flex-wrap"]
  return null
}

export function isShorthandProperty(property: string): boolean {
  return QUAD_EXPANSIONS.has(property) || BLOCK_EXPANSIONS.has(property) || INLINE_EXPANSIONS.has(property) || property === "flex-flow"
}
