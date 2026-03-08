import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import type { SelectorEntity, SelectorPart } from "../../entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../entities"

const messages = {
  descendingSpecificity:
    "Lower-specificity selector `{{laterSelector}}` appears after `{{earlierSelector}}` for `{{property}}`, creating brittle cascade behavior.",
} as const

/**
 * A compound selector segment: element/class/id parts between combinators.
 * Built from the graph's pre-parsed SelectorPart[].
 */
interface Compound {
  readonly tag: string | null
  readonly classes: readonly string[]
  readonly ids: readonly string[]
}

const UNSUPPORTED_TYPES = new Set<SelectorPart["type"]>(["attribute", "pseudo-class", "pseudo-element", "universal", "nesting"])

/**
 * Group a selector entity's pre-parsed parts into compound segments.
 * Returns null if any part type is unsupported for this analysis.
 */
function extractCompounds(selector: SelectorEntity): readonly Compound[] | null {
  const parts = selector.parts
  if (parts.length === 0) return null

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    if (UNSUPPORTED_TYPES.has(part.type)) return null
  }

  return splitIntoCompounds(selector)
}

/**
 * Split selector parts into compounds by re-grouping.
 * Each compound ends when we've consumed enough parts to reach the next combinator position.
 * Uses the raw string approach since parts don't encode combinator boundaries.
 */
function splitIntoCompounds(selector: SelectorEntity): readonly Compound[] | null {
  const raw = selector.raw
  const combinators = selector.complexity.combinators

  // Split by combinators in the raw string to get compound segments
  const segments = splitRawByCombinators(raw)
  if (!segments || segments.length !== combinators.length + 1) return null

  const compounds: Compound[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    const compound = parseCompoundFromParts(seg)
    if (!compound) return null
    compounds.push(compound)
  }

  return compounds
}

const COMBINATOR_SPLIT = /\s*[>+~]\s*|\s+/

function splitRawByCombinators(raw: string): readonly string[] | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const segments = trimmed.split(COMBINATOR_SPLIT).filter(s => s.length > 0)
  return segments.length > 0 ? segments : null
}

const COMPOUND_TOKEN = /([.#]?)([_a-zA-Z][_a-zA-Z0-9-]*)/g

function parseCompoundFromParts(segment: string): Compound | null {
  let tag: string | null = null
  const classes: string[] = []
  const ids: string[] = []

  COMPOUND_TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = COMPOUND_TOKEN.exec(segment)) !== null) {
    const prefix = match[1]
    const value = match[2]
    if (!value) continue
    if (prefix === ".") classes.push(value)
    else if (prefix === "#") ids.push(value)
    else tag = value
  }

  if (!tag && classes.length === 0 && ids.length === 0) return null
  return { tag, classes, ids }
}

function hasToken(list: readonly string[], token: string): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === token) return true
  }
  return false
}

function isCompoundSuperset(superset: Compound, subset: Compound): boolean {
  if (subset.tag && superset.tag !== subset.tag) return false

  for (let i = 0; i < subset.classes.length; i++) {
    const cls = subset.classes[i]
    if (!cls) continue
    if (!hasToken(superset.classes, cls)) return false
  }

  for (let i = 0; i < subset.ids.length; i++) {
    const id = subset.ids[i]
    if (!id) continue
    if (!hasToken(superset.ids, id)) return false
  }

  return true
}

function isExactCompoundMatch(a: Compound, b: Compound): boolean {
  if (a.tag !== b.tag) return false
  if (a.classes.length !== b.classes.length) return false
  if (a.ids.length !== b.ids.length) return false

  for (let i = 0; i < a.classes.length; i++) {
    const cls = a.classes[i]
    if (!cls) continue
    if (!hasToken(b.classes, cls)) return false
  }

  for (let i = 0; i < a.ids.length; i++) {
    const id = a.ids[i]
    if (!id) continue
    if (!hasToken(b.ids, id)) return false
  }

  return true
}

function isProvableDescendingPair(earlier: SelectorEntity, later: SelectorEntity): boolean {
  const earlierCompounds = extractCompounds(earlier)
  if (!earlierCompounds) return false
  const laterCompounds = extractCompounds(later)
  if (!laterCompounds) return false

  const earlierCombinators = earlier.complexity.combinators
  const laterCombinators = later.complexity.combinators

  if (earlierCompounds.length !== laterCompounds.length) return false
  if (earlierCombinators.length !== laterCombinators.length) return false

  for (let i = 0; i < earlierCombinators.length; i++) {
    if (earlierCombinators[i] !== laterCombinators[i]) return false
  }

  const last = earlierCompounds.length - 1
  for (let i = 0; i < last; i++) {
    const ec = earlierCompounds[i]
    const lc = laterCompounds[i]
    if (!ec || !lc) return false
    if (!isExactCompoundMatch(ec, lc)) return false
  }

  const earlierTarget = earlierCompounds[last]
  const laterTarget = laterCompounds[last]
  if (!earlierTarget || !laterTarget) return false
  if (!isCompoundSuperset(earlierTarget, laterTarget)) return false
  if (isExactCompoundMatch(earlierTarget, laterTarget)) return false

  return true
}

export const noDescendingSpecificityConflict = defineCSSRule({
  id: "no-descending-specificity-conflict",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow lower-specificity selectors after higher-specificity selectors for the same property.",
    fixable: false,
    category: "css-cascade",
  },
  options: {},
  check(graph, emit) {
    for (const [property, declarations] of graph.multiDeclarationProperties) {
      const seen = new Set<number>()

      for (let i = 1; i < declarations.length; i++) {
        const later = declarations[i]
        if (!later) continue
        const laterRule = later.rule
        if (!laterRule) continue

        for (let j = 0; j < i; j++) {
          const earlier = declarations[j]
          if (!earlier) continue
          if (earlier.file.path !== later.file.path) continue
          if (hasFlag(earlier._flags, DECL_IS_IMPORTANT) !== hasFlag(later._flags, DECL_IS_IMPORTANT)) continue
          if (earlier.cascadePosition.layerOrder !== later.cascadePosition.layerOrder) continue
          if (later.cascadePosition.specificityScore >= earlier.cascadePosition.specificityScore) continue

          const earlierRule = earlier.rule
          if (!earlierRule) continue
          if (earlierRule.selectors.length !== 1 || laterRule.selectors.length !== 1) continue

          const earlierSelector = earlierRule.selectors[0]
          const laterSelector = laterRule.selectors[0]
          if (!earlierSelector || !laterSelector) continue

          if (!isProvableDescendingPair(earlierSelector, laterSelector)) continue
          if (seen.has(later.id)) continue

          seen.add(later.id)
          emitCSSDiagnostic(
            emit,
            later.file.path,
            later.startLine,
            later.startColumn,
            noDescendingSpecificityConflict,
            "descendingSpecificity",
            resolveMessage(messages.descendingSpecificity, {
              laterSelector: laterSelector.raw,
              earlierSelector: earlierSelector.raw,
              property,
            }),
          )
        }
      }
    }
  },
})
