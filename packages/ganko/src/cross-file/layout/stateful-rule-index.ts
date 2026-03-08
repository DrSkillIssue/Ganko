import type { AtRuleEntity, RuleEntity } from "../../css/entities"
import { extractPseudoClasses, normalizeSelector, parseSelectorList } from "../../css/parser/selector"
import { LAYOUT_STATEFUL_SHIFT_PROPERTIES } from "../../css/layout-taxonomy"
import type { LayoutNormalizedRuleDeclaration, LayoutStatefulSelectorEntry } from "./graph"
import { expandShorthand } from "./shorthand-expansion"

const EMPTY_STATEFUL_SELECTOR_ENTRY_LIST: readonly LayoutStatefulSelectorEntry[] = []
const EMPTY_LAYOUT_NORMALIZED_DECLARATION_LIST: readonly LayoutNormalizedRuleDeclaration[] = []

const EMPTY_STRING_LIST: readonly string[] = []
const CLASS_SELECTOR_RE = /\.[_a-zA-Z][_a-zA-Z0-9-]*/g
const SIMPLE_SELECTOR_COMBINATOR_RE = /[\s>+~]/

/**
 * Classifies state pseudo-classes by interaction model:
 * - "direct": User physically interacts with the element itself (hover, press, focus).
 *   Visual feedback from these is expected and does not constitute unexpected CLS.
 * - "indirect": State can change from external triggers (JS, URL fragment, label click
 *   on a different element). Visual shifts from these may be unexpected.
 */
const STATE_PSEUDO_CLASSIFICATION = new Map<string, "direct" | "indirect">([
  ["hover", "direct"],
  ["focus", "direct"],
  ["focus-visible", "direct"],
  ["active", "direct"],
  ["checked", "indirect"],
  ["target", "indirect"],
])
const STATE_PSEUDO_SET = new Set(STATE_PSEUDO_CLASSIFICATION.keys())
const STATE_PSEUDO_STRIP_RE = /:hover\b|:focus-visible\b|:focus\b|:active\b|:checked\b|:target\b/g
const PSEUDO_FUNCTION_RE = /:(?:has|not)\(/i
const STATE_IS_WHERE_RE = /:(?:is|where)\(\s*(?::hover|:focus-visible|:focus|:active|:checked|:target)(?:\s*,\s*(?::hover|:focus-visible|:focus|:active|:checked|:target))*\s*\)/g

export interface StatefulRuleIndexes {
  readonly selectorEntriesByRuleId: ReadonlyMap<number, readonly LayoutStatefulSelectorEntry[]>
  readonly normalizedDeclarationsByRuleId: ReadonlyMap<number, readonly LayoutNormalizedRuleDeclaration[]>
  readonly baseValueIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
}

export function buildStatefulRuleIndexes(rules: readonly RuleEntity[]): StatefulRuleIndexes {
  const selectorEntriesByRuleId = new Map<number, readonly LayoutStatefulSelectorEntry[]>()
  const normalizedDeclarationsByRuleId = new Map<number, readonly LayoutNormalizedRuleDeclaration[]>()
  const baseValueIndex = new Map<string, Map<string, Set<string>>>()
  const selectorKeyCache = new Map<string, readonly string[]>()

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    const selectorEntries = buildStatefulSelectorEntries(rule.selectorText, selectorKeyCache)
    selectorEntriesByRuleId.set(rule.id, selectorEntries)

    const normalizedDeclarations = buildStatefulNormalizedDeclarations(rule)
    normalizedDeclarationsByRuleId.set(rule.id, normalizedDeclarations)

    if (isConditionalRule(rule)) continue
    if (selectorEntries.length === 0) continue
    if (normalizedDeclarations.length === 0) continue

    for (let j = 0; j < selectorEntries.length; j++) {
      const selector = selectorEntries[j]
      if (!selector) continue
      if (selector.isStateful) continue
      if (selector.baseLookupKeys.length === 0) continue

      for (let k = 0; k < selector.baseLookupKeys.length; k++) {
        const selectorKey = selector.baseLookupKeys[k]
        if (!selectorKey) continue
        let propertyMap = baseValueIndex.get(selectorKey)
        if (!propertyMap) {
          propertyMap = new Map<string, Set<string>>()
          baseValueIndex.set(selectorKey, propertyMap)
        }

        for (let n = 0; n < normalizedDeclarations.length; n++) {
          const declaration = normalizedDeclarations[n]
          if (!declaration) continue
          if (declaration.property === "position") {
            addStatefulValue(propertyMap, declaration.property, declaration.normalizedValue)
            continue
          }

          addStatefulPropertyValue(propertyMap, declaration.property, declaration.normalizedValue)
        }
      }
    }
  }

  return {
    selectorEntriesByRuleId,
    normalizedDeclarationsByRuleId,
    baseValueIndex,
  }
}

function buildStatefulSelectorEntries(
  selectorText: string,
  selectorKeyCache: Map<string, readonly string[]>,
): readonly LayoutStatefulSelectorEntry[] {
  const parsed = parseSelectorList(selectorText)
  if (parsed.length === 0) return EMPTY_STATEFUL_SELECTOR_ENTRY_LIST

  const entries: LayoutStatefulSelectorEntry[] = []
  for (let i = 0; i < parsed.length; i++) {
    const rawEntry = parsed[i]
    if (!rawEntry) continue
    const raw = rawEntry.trim()
    if (raw.length === 0) continue

    const normalized = normalizeSelector(raw.toLowerCase())
    if (normalized.length === 0) continue

    const statePseudoClasses = classifyStatefulSelector(normalized)
    const isStateful = statePseudoClasses.length > 0
    const isDirectInteraction = isStateful && isAllDirectInteraction(statePseudoClasses)
    const baseSelector = isStateful ? toBaseSelector(normalized) : normalized
    const baseLookupKeys = baseSelector ? getSelectorLookupKeys(baseSelector, selectorKeyCache) : EMPTY_STRING_LIST
    entries.push({
      raw,
      isStateful,
      statePseudoClasses,
      isDirectInteraction,
      baseLookupKeys,
    })
  }

  if (entries.length === 0) return EMPTY_STATEFUL_SELECTOR_ENTRY_LIST
  return entries
}

function buildStatefulNormalizedDeclarations(rule: RuleEntity): readonly LayoutNormalizedRuleDeclaration[] {
  const out: LayoutNormalizedRuleDeclaration[] = []

  for (let i = 0; i < rule.declarations.length; i++) {
    const declaration = rule.declarations[i]
    if (!declaration) continue
    const property = declaration.property.toLowerCase()
    if (!LAYOUT_STATEFUL_SHIFT_PROPERTIES.has(property) && property !== "position") continue

    out.push({
      declarationId: declaration.id,
      property,
      normalizedValue: normalizeCssValue(declaration.value),
      filePath: declaration.file.path,
      startLine: declaration.startLine,
      startColumn: declaration.startColumn,
      propertyLength: declaration.property.length,
    })
  }

  if (out.length === 0) return EMPTY_LAYOUT_NORMALIZED_DECLARATION_LIST
  return out
}

function addStatefulPropertyValue(propertyMap: Map<string, Set<string>>, property: string, normalizedValue: string): void {
  addStatefulValue(propertyMap, property, normalizedValue)

  const expanded = expandShorthand(property, normalizedValue)
  if (expanded === undefined || expanded === null) return
  for (let i = 0; i < expanded.length; i++) {
    const entry = expanded[i]
    if (!entry) continue
    addStatefulValue(propertyMap, entry.name, entry.value)
  }
}

function addStatefulValue(propertyMap: Map<string, Set<string>>, property: string, value: string): void {
  let values = propertyMap.get(property)
  if (!values) {
    values = new Set<string>()
    propertyMap.set(property, values)
  }
  values.add(value)
}

function getSelectorLookupKeys(
  selector: string,
  selectorKeyCache: Map<string, readonly string[]>,
): readonly string[] {
  const existing = selectorKeyCache.get(selector)
  if (existing) return existing

  const canonical = canonicalizeClassOrder(selector)
  const keys = !canonical || canonical === selector
    ? [selector]
    : [selector, canonical]
  selectorKeyCache.set(selector, keys)
  return keys
}

function canonicalizeClassOrder(selector: string): string | null {
  if (selector.length === 0) return null
  if (SIMPLE_SELECTOR_COMBINATOR_RE.test(selector)) return null
  if (selector.includes("[")) return null
  if (selector.includes(":")) return null
  if (selector.indexOf(".") === -1) return null

  const classTokens = selector.match(CLASS_SELECTOR_RE)
  if (!classTokens || classTokens.length < 2) return null

  const sorted = classTokens.toSorted()
  const withoutClasses = selector.replace(CLASS_SELECTOR_RE, "")
  return normalizeSelector(`${withoutClasses}${sorted.join("")}`)
}

function classifyStatefulSelector(selector: string): readonly string[] {
  const pseudoClasses = extractPseudoClasses(selector)
  const matched: string[] = []
  for (let i = 0; i < pseudoClasses.length; i++) {
    const pc = pseudoClasses[i]
    if (!pc) continue
    if (STATE_PSEUDO_SET.has(pc)) matched.push(pc)
  }
  return matched
}

function isAllDirectInteraction(pseudoClasses: readonly string[]): boolean {
  for (let i = 0; i < pseudoClasses.length; i++) {
    const pc = pseudoClasses[i]
    if (!pc) continue
    if (STATE_PSEUDO_CLASSIFICATION.get(pc) !== "direct") return false
  }
  return true
}

function toBaseSelector(selector: string): string | null {
  if (PSEUDO_FUNCTION_RE.test(selector)) return null

  const stripped = selector
    .replace(STATE_IS_WHERE_RE, "")
    .replace(STATE_PSEUDO_STRIP_RE, "")
  const normalized = normalizeSelector(stripped)
  if (normalized.length === 0) return null
  return normalized
}

function normalizeCssValue(value: string): string {
  return value.trim().toLowerCase()
}

function isConditionalRule(rule: RuleEntity): boolean {
  let current: RuleEntity | AtRuleEntity | null = rule.parent

  while (current) {
    if (current.kind === "rule") {
      current = current.parent
      continue
    }

    if (current.kind === "media" || current.kind === "supports" || current.kind === "container") {
      return true
    }
    current = current.parent
  }

  return false
}
