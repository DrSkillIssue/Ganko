import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import type { SelectorEntity } from "../../entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../entities"

const messages = {
  descendingSpecificity:
    "Lower-specificity selector `{{laterSelector}}` appears after `{{earlierSelector}}` for `{{property}}`, creating brittle cascade behavior.",
} as const

interface Compound {
  readonly tag: string | null
  readonly classes: readonly string[]
  readonly ids: readonly string[]
}

function extractCompounds(selector: SelectorEntity): readonly Compound[] | null {
  const selectorCompounds = selector.compounds
  if (selectorCompounds.length === 0) return null

  for (let i = 0; i < selectorCompounds.length; i++) {
    const sc = selectorCompounds[i]
    if (!sc) continue
    const parts = sc.parts
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j]
      if (!part) continue
      const t = part.type
      if (t === "attribute" || t === "pseudo-class" || t === "pseudo-element" || t === "universal" || t === "nesting") return null
    }
  }

  const compounds: Compound[] = []
  for (let i = 0; i < selectorCompounds.length; i++) {
    const sc = selectorCompounds[i]
    if (!sc) continue
    const ids: string[] = []
    if (sc.idValue !== null) ids.push(sc.idValue)
    if (!sc.tagName && sc.classes.length === 0 && ids.length === 0) return null
    compounds.push({ tag: sc.tagName, classes: sc.classes, ids })
  }

  return compounds
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

  const earlierCombinators = earlier.combinators
  const laterCombinators = later.combinators

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
