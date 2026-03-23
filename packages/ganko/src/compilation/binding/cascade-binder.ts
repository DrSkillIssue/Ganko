/**
 * Cascade binding types + lazy per-element cascade resolution.
 *
 * Moved from cross-file/layout/cascade-builder.ts + selector-match.ts matching.
 */
import type { CascadePosition } from "../../css/entities/value"
import type { SelectorAttributeConstraint, NthPattern, AtRuleEntity, RuleEntity } from "../../css/entities"
import type { VariableEntity } from "../../css/entities/variable"
import { compareCascadePositions } from "../../css/analysis/cascade"
import { parseBlockShorthand, parseQuadShorthand, splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import { extractVarReferences } from "../../css/parser/value"
import { isWhitespace } from "@drskillissue/ganko-shared"
import type { SelectorSymbol, CompiledSelectorMatcher } from "../symbols/selector"
import type { SymbolTable } from "../symbols/symbol-table"
import type { ScopedSelectorIndex } from "./scope-resolver"
import type { ElementNode } from "./element-builder"
import type { LayoutSignalName } from "./signal-builder"
import { isMonitoredSignal, MONITORED_SIGNAL_NAME_MAP } from "./signal-builder"


// ── Enums & types ────────────────────────────────────────────────────────

export const enum SignalSource { Selector = 0, InlineStyle = 1 }
export const enum SignalGuardKind { Unconditional = 0, Conditional = 1 }

export type GuardConditionKind = "media" | "supports" | "container" | "dynamic-attribute"

export interface GuardConditionProvenance {
  readonly kind: GuardConditionKind
  readonly query: string | null
  readonly key: string
}

export type RuleGuard =
  | { readonly kind: SignalGuardKind.Unconditional; readonly conditions: readonly GuardConditionProvenance[]; readonly key: "always" }
  | { readonly kind: SignalGuardKind.Conditional; readonly conditions: readonly GuardConditionProvenance[]; readonly key: string }

export interface CascadedDeclaration {
  readonly value: string
  readonly source: SignalSource
  readonly guardProvenance: RuleGuard
}

export interface SelectorMatch {
  readonly selectorId: number
  readonly specificityScore: number
  readonly sourceOrder: number
  readonly conditionalMatch: boolean
}

export interface ElementCascade {
  readonly elementId: number
  readonly declarations: ReadonlyMap<string, CascadedDeclaration>
  readonly edges: readonly SelectorMatch[]
}


// ── Monitored declarations ───────────────────────────────────────────────

export interface MonitoredDeclaration {
  readonly property: LayoutSignalName
  readonly value: string
  readonly position: CascadePosition
  readonly guardProvenance: RuleGuard
}


// ── Cached bind state (lazily built per symbol table) ────────────────────

const bindCacheBySymbolTable = new WeakMap<SymbolTable, {
  readonly monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>
}>()

export function getOrBuildBindState(symbolTable: SymbolTable): {
  readonly monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>
} {
  const cached = bindCacheBySymbolTable.get(symbolTable)
  if (cached !== undefined) return cached

  const state = {
    monitoredDeclarationsBySelectorId: buildMonitoredDeclarationsMap(symbolTable),
  }
  bindCacheBySymbolTable.set(symbolTable, state)
  return state
}


// ── buildMonitoredDeclarationsMap ────────────────────────────────────────

function buildMonitoredDeclarationsMap(
  symbolTable: SymbolTable,
): ReadonlyMap<number, readonly MonitoredDeclaration[]> {
  const out = new Map<number, readonly MonitoredDeclaration[]>()

  const variablesByName = buildVariablesByNameFromSymbolTable(symbolTable)

  for (const [selectorId, symbol] of symbolTable.selectors) {
    const entity = symbol.entity
    const guard = resolveRuleGuard(entity.rule)
    const layerOrder = resolveLayerOrder(entity.rule.containingLayer, symbolTable)

    const declarations = collectMonitoredDeclarations(
      entity,
      layerOrder,
      guard,
      variablesByName,
    )

    if (declarations.length > 0) {
      out.set(selectorId, declarations)
    }
  }

  return out
}

function buildVariablesByNameFromSymbolTable(
  symbolTable: SymbolTable,
): ReadonlyMap<string, readonly VariableEntity[]> {
  const out = new Map<string, VariableEntity[]>()

  for (const [name, symbol] of symbolTable.customProperties) {
    const existing = out.get(name)
    if (existing) {
      existing.push(symbol.entity)
    } else {
      out.set(name, [symbol.entity])
    }
  }

  return out
}

// ── resolveRuleGuard (moved from cross-file/layout/guard-model.ts) ───────

const UNCONDITIONAL_GUARD: RuleGuard = { kind: SignalGuardKind.Unconditional, conditions: [], key: "always" }
const WHITESPACE_RE_GLOBAL = /\s+/g

function resolveRuleGuard(rule: RuleEntity): RuleGuard {
  const conditions = collectRuleConditions(rule)
  if (conditions.length === 0) return UNCONDITIONAL_GUARD
  return {
    kind: SignalGuardKind.Conditional,
    conditions,
    key: conditions.map((c) => c.key).join("&"),
  }
}

function collectRuleConditions(rule: RuleEntity): readonly GuardConditionProvenance[] {
  const out: GuardConditionProvenance[] = []
  const seenKeys = new Set<string>()
  function pushCondition(condition: GuardConditionProvenance): void {
    if (seenKeys.has(condition.key)) return
    seenKeys.add(condition.key)
    out.push(condition)
  }
  if (rule.containingMedia !== null) {
    const mediaCondition = toGuardCondition(rule.containingMedia)
    if (mediaCondition !== null) pushCondition(mediaCondition)
  }
  let current: RuleEntity["parent"] = rule.parent
  while (current !== null) {
    if (current.kind === "rule") { current = current.parent; continue }
    const condition = toGuardCondition(current)
    if (condition !== null) pushCondition(condition)
    current = current.parent
  }
  if (out.length === 0) return []
  out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  return out
}

function toGuardCondition(atRule: AtRuleEntity): GuardConditionProvenance | null {
  if (atRule.kind === "media") return buildGuardCondition("media", atRule.params)
  if (atRule.kind === "supports") return buildGuardCondition("supports", atRule.params)
  if (atRule.kind === "container") return buildGuardCondition("container", atRule.parsedParams.containerCondition ?? atRule.params)
  return null
}

function buildGuardCondition(kind: GuardConditionKind, query: string | null): GuardConditionProvenance {
  const normalized = query === null ? null : query.trim().toLowerCase().replace(WHITESPACE_RE_GLOBAL, " ") || null
  return { kind, query, key: `${kind}:${normalized === null ? "*" : normalized}` }
}


// ── expandShorthand (moved from cross-file/layout/shorthand-expansion.ts) ─

interface ShorthandExpansionResult { readonly name: string; readonly value: string }

const QUAD_EXPANSIONS: ReadonlyMap<string, readonly [string, string, string, string]> = new Map([
  ["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
  ["border-width", ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]],
  ["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
  ["inset", ["top", "right", "bottom", "left"]],
])

const BLOCK_EXPANSIONS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ["margin-block", ["margin-top", "margin-bottom"]],
  ["padding-block", ["padding-top", "padding-bottom"]],
  ["inset-block", ["inset-block-start", "inset-block-end"]],
])

const INLINE_EXPANSIONS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ["padding-inline", ["padding-left", "padding-right"]],
])

const FLEX_DIRECTION_VALUES = new Set(["row", "row-reverse", "column", "column-reverse"])

export function expandShorthand(property: string, value: string): readonly ShorthandExpansionResult[] | null | undefined {
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
    return [{ name: blockTarget[0], value: parsed.start }, { name: blockTarget[1], value: parsed.end }]
  }
  const inlineTarget = INLINE_EXPANSIONS.get(property)
  if (inlineTarget !== undefined) {
    const parsed = parseBlockShorthand(value)
    if (parsed === null) return null
    return [{ name: inlineTarget[0], value: parsed.start }, { name: inlineTarget[1], value: parsed.end }]
  }
  if (property === "flex-flow") return expandFlexFlow(value)
  return undefined
}

function expandFlexFlow(value: string): readonly ShorthandExpansionResult[] | null {
  const tokens = splitWhitespaceTokens(value.trim().toLowerCase())
  if (tokens.length === 0 || tokens.length > 2) return null
  let direction: string | null = null
  let wrap: string | null = null
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (FLEX_DIRECTION_VALUES.has(token)) { if (direction !== null) return null; direction = token }
    else { if (wrap !== null) return null; wrap = token }
  }
  const out: ShorthandExpansionResult[] = []
  if (direction !== null) out.push({ name: "flex-direction", value: direction })
  if (wrap !== null) out.push({ name: "flex-wrap", value: wrap })
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

function resolveLayerOrder(
  containingLayer: { readonly parsedParams: { readonly layerName?: string | null } } | null,
  symbolTable: SymbolTable,
): number {
  if (!containingLayer) return 0
  const name = containingLayer.parsedParams.layerName ?? null
  if (!name) return 0
  const layerSymbol = symbolTable.layers.get(name)
  if (!layerSymbol) return 0
  return layerSymbol.order
}

function collectMonitoredDeclarations(
  selector: { readonly rule: { readonly declarations: readonly { readonly property: string; readonly value: string; readonly sourceOrder: number; readonly cascadePosition: CascadePosition; readonly node: { readonly important: boolean } }[] }; readonly specificity: readonly [number, number, number, number]; readonly specificityScore: number },
  layerOrder: number,
  guard: RuleGuard,
  variablesByName: ReadonlyMap<string, readonly VariableEntity[]>,
): readonly MonitoredDeclaration[] {
  const out: MonitoredDeclaration[] = []
  const declarations = selector.rule.declarations
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i]
    if (!declaration) continue
    const property = declaration.property.toLowerCase()
    if (!isMonitoredSignal(property)) continue

    const position: CascadePosition = {
      layer: declaration.cascadePosition.layer,
      layerOrder,
      sourceOrder: declaration.sourceOrder,
      specificity: selector.specificity,
      specificityScore: selector.specificityScore,
      isImportant: declaration.cascadePosition.isImportant || declaration.node.important,
    }

    const rawValue = declaration.value
    const resolvedValue = variablesByName.size > 0 && rawValue.includes("var(")
      ? substituteVarReferences(rawValue, variablesByName, 0)
      : rawValue

    const directSignal = MONITORED_SIGNAL_NAME_MAP.get(property)
    if (directSignal !== undefined) {
      out.push({ property: directSignal, value: resolvedValue, guardProvenance: guard, position })
      continue
    }

    const value = resolvedValue.trim().toLowerCase()
    const expanded = expandShorthand(property, value)
    if (expanded === undefined) continue
    if (expanded === null) {
      const longhandNames = getShorthandLonghandNames(property)
      if (longhandNames === null) continue
      for (let j = 0; j < longhandNames.length; j++) {
        const longhand = longhandNames[j]
        if (!longhand) continue
        const signal = MONITORED_SIGNAL_NAME_MAP.get(longhand)
        if (signal === undefined) continue
        out.push({ property: signal, value: resolvedValue, guardProvenance: guard, position })
      }
      continue
    }
    for (let j = 0; j < expanded.length; j++) {
      const entry = expanded[j]
      if (!entry) continue
      const signal = MONITORED_SIGNAL_NAME_MAP.get(entry.name)
      if (signal === undefined) continue
      out.push({ property: signal, value: entry.value, guardProvenance: guard, position })
    }
  }

  return out
}


// ── Variable substitution ────────────────────────────────────────────────

const MAX_VAR_SUBSTITUTION_DEPTH = 10

function substituteVarReferences(
  value: string,
  variablesByName: ReadonlyMap<string, readonly VariableEntity[]>,
  depth: number,
): string {
  if (depth >= MAX_VAR_SUBSTITUTION_DEPTH) return value
  const refs = extractVarReferences(value)
  if (refs.length === 0) return value

  let result = value
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]
    if (!ref) continue
    const candidates = variablesByName.get(ref.name)
    const resolvedValue = candidates !== undefined && candidates.length > 0
      ? selectBestVariableValue(candidates)
      : ref.fallback
    if (resolvedValue === null) continue
    result = result.slice(0, ref.sourceIndex) + resolvedValue + result.slice(ref.sourceIndex + ref.raw.length)
  }

  if (result !== value && result.includes("var(")) {
    return substituteVarReferences(result, variablesByName, depth + 1)
  }

  return result
}

function selectBestVariableValue(candidates: readonly VariableEntity[]): string | null {
  let bestGlobal: VariableEntity | null = null

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue
    if (candidate.scope.type === "global") {
      if (bestGlobal === null || candidate.declaration.sourceOrder > bestGlobal.declaration.sourceOrder) {
        bestGlobal = candidate
      }
    }
  }

  if (bestGlobal !== null) return bestGlobal.value
  const first = candidates[0]
  return first ? first.value : null
}


// ══════════════════════════════════════════════════════════════════════════
// Selector Matching Engine
// Moved from cross-file/layout/selector-match.ts
// ══════════════════════════════════════════════════════════════════════════

const enum MatchResult { Match = 0, NoMatch = 1, Conditional = 2 }

interface ElementIndex {
  readonly byDispatchKey: ReadonlyMap<string, readonly ElementNode[]>
  readonly byTagName: ReadonlyMap<string, readonly ElementNode[]>
}

type CompiledCompound = CompiledSelectorMatcher["compoundsRightToLeft"][number]

export function selectorMatchesElement(
  element: ElementNode,
  matcher: CompiledSelectorMatcher,
): boolean {
  const firstCompound = matcher.compoundsRightToLeft[0]
  if (firstCompound === undefined) return false
  const subjectResult = matchesCompound(element, firstCompound)
  if (subjectResult === MatchResult.NoMatch) return false
  if (matcher.compoundsRightToLeft.length === 1) return true
  const chainResult = matchesChain(matcher, element, 0, null, null)
  return chainResult !== MatchResult.NoMatch
}

function matchElement(
  matcher: CompiledSelectorMatcher,
  node: ElementNode,
  rootElements: readonly ElementNode[] | null,
  fileElementIndex: ElementIndex | null,
): MatchResult {
  const firstCompound = matcher.compoundsRightToLeft[0]
  if (firstCompound === undefined) return MatchResult.NoMatch
  const subjectResult = matchesCompound(node, firstCompound)
  if (subjectResult === MatchResult.NoMatch) return MatchResult.NoMatch
  if (matcher.compoundsRightToLeft.length === 1) return subjectResult
  const chainResult = matchesChain(matcher, node, 0, rootElements, fileElementIndex)
  if (chainResult === MatchResult.NoMatch) return MatchResult.NoMatch
  if (subjectResult === MatchResult.Conditional || chainResult === MatchResult.Conditional) return MatchResult.Conditional
  return MatchResult.Match
}

function matchesChain(
  matcher: CompiledSelectorMatcher,
  node: ElementNode,
  index: number,
  fileRootElements: readonly ElementNode[] | null,
  fileElementIndex: ElementIndex | null,
): MatchResult {
  const combinator = matcher.combinatorsRightToLeft[index]
  if (combinator === undefined) return MatchResult.NoMatch
  const nextIndex = index + 1
  const targetCompound = matcher.compoundsRightToLeft[nextIndex]
  if (targetCompound === undefined) return MatchResult.NoMatch
  const isFinal = nextIndex === matcher.compoundsRightToLeft.length - 1

  if (combinator === "child") {
    const parent = node.parentElementNode
    if (parent === null) return MatchResult.NoMatch
    const compoundResult = matchesCompound(parent, targetCompound)
    if (compoundResult === MatchResult.NoMatch) return MatchResult.NoMatch
    if (isFinal) return compoundResult
    const chainResult = matchesChain(matcher, parent, nextIndex, fileRootElements, fileElementIndex)
    return mergeMatchResults(compoundResult, chainResult)
  }

  if (combinator === "adjacent") {
    const sibling = node.previousSiblingNode
    if (sibling === null) return MatchResult.NoMatch
    const compoundResult = matchesCompound(sibling, targetCompound)
    if (compoundResult === MatchResult.NoMatch) return MatchResult.NoMatch
    if (isFinal) return compoundResult
    const chainResult = matchesChain(matcher, sibling, nextIndex, fileRootElements, fileElementIndex)
    return mergeMatchResults(compoundResult, chainResult)
  }

  if (combinator === "sibling") {
    let sibling = node.previousSiblingNode
    while (sibling !== null) {
      const compoundResult = matchesCompound(sibling, targetCompound)
      if (compoundResult !== MatchResult.NoMatch) {
        if (isFinal) return compoundResult
        const chainResult = matchesChain(matcher, sibling, nextIndex, fileRootElements, fileElementIndex)
        if (chainResult !== MatchResult.NoMatch) return mergeMatchResults(compoundResult, chainResult)
      }
      sibling = sibling.previousSiblingNode
    }
    return MatchResult.NoMatch
  }

  // Descendant combinator — walk ancestor chain
  let bestResult: MatchResult = MatchResult.NoMatch
  let ancestor = node.parentElementNode
  while (ancestor !== null) {
    const compoundResult = matchesCompound(ancestor, targetCompound)
    if (compoundResult !== MatchResult.NoMatch) {
      if (isFinal) return compoundResult
      const chainResult = matchesChain(matcher, ancestor, nextIndex, fileRootElements, fileElementIndex)
      if (chainResult !== MatchResult.NoMatch) {
        const merged = mergeMatchResults(compoundResult, chainResult)
        if (merged === MatchResult.Match) return MatchResult.Match
        bestResult = merged
      }
    }
    ancestor = ancestor.parentElementNode
  }

  // Same-file root element fallback for descendant combinators
  if (fileRootElements !== null) {
    for (let r = 0; r < fileRootElements.length; r++) {
      const root = fileRootElements[r]
      if (root === undefined) continue
      if (root === node) continue
      if (root.solidFile !== node.solidFile) continue
      const compoundResult = matchesCompound(root, targetCompound)
      if (compoundResult !== MatchResult.NoMatch) {
        if (isFinal) return compoundResult
        const chainResult = matchesChain(matcher, root, nextIndex, fileRootElements, fileElementIndex)
        if (chainResult !== MatchResult.NoMatch) {
          const merged = mergeMatchResults(compoundResult, chainResult)
          if (merged === MatchResult.Match) return MatchResult.Match
          bestResult = merged
        }
      }
    }
  }

  // Dispatch-key-indexed fallback for descendant combinators
  if (fileElementIndex !== null && bestResult === MatchResult.NoMatch) {
    const candidates = resolveCompoundCandidates(fileElementIndex, targetCompound)
    if (candidates !== null) {
      for (let r = 0; r < candidates.length; r++) {
        const elem = candidates[r]
        if (elem === undefined) continue
        if (elem === node) continue
        const compoundResult = matchesCompound(elem, targetCompound)
        if (compoundResult !== MatchResult.NoMatch) {
          bestResult = MatchResult.Conditional
          break
        }
      }
    }
  }

  return bestResult
}

function mergeMatchResults(a: MatchResult, b: MatchResult): MatchResult {
  if (a === MatchResult.NoMatch || b === MatchResult.NoMatch) return MatchResult.NoMatch
  if (a === MatchResult.Conditional || b === MatchResult.Conditional) return MatchResult.Conditional
  return MatchResult.Match
}

function resolveCompoundCandidates(
  index: ElementIndex,
  compound: CompiledCompound,
): readonly ElementNode[] | null {
  if (compound.idValue !== null) {
    return index.byDispatchKey.get(`id:${compound.idValue}`) ?? null
  }
  if (compound.classes.length > 0 && compound.classes[0] !== undefined) {
    return index.byDispatchKey.get(`class:${compound.classes[0]}`) ?? null
  }
  if (compound.attributes.length > 0 && compound.attributes[0] !== undefined) {
    return index.byDispatchKey.get(`attr:${compound.attributes[0].name}`) ?? null
  }
  if (compound.tagName !== null) {
    return index.byTagName.get(compound.tagName) ?? null
  }
  return null
}

function matchesCompound(node: ElementNode, compound: CompiledCompound): MatchResult {
  if (compound.tagName !== null && node.tagName !== compound.tagName) return MatchResult.NoMatch

  if (compound.idValue !== null) {
    const id = node.attributes.get("id")
    if (id !== compound.idValue) return MatchResult.NoMatch
  }

  if (!matchesRequiredClasses(compound.classes, node.classTokenSet)) return MatchResult.NoMatch
  const attrResult = matchesRequiredAttributes(compound.attributes, node.attributes)
  if (attrResult === MatchResult.NoMatch) return MatchResult.NoMatch
  if (!matchesPseudoConstraints(node, compound.pseudo)) return MatchResult.NoMatch

  return attrResult
}

function matchesPseudoConstraints(node: ElementNode, pseudo: CompiledCompound["pseudo"]): boolean {
  if (pseudo.firstChild && node.siblingIndex !== 1) return false
  if (pseudo.lastChild && node.siblingIndex !== node.siblingCount) return false
  if (pseudo.onlyChild && node.siblingCount !== 1) return false
  if (pseudo.nthChild !== null && !matchesNthPattern(node.siblingIndex, pseudo.nthChild)) return false

  if (pseudo.nthLastChild !== null) {
    const nthFromEnd = node.siblingCount - node.siblingIndex + 1
    if (!matchesNthPattern(nthFromEnd, pseudo.nthLastChild)) return false
  }

  if (pseudo.nthOfType !== null) {
    if (!matchesNthPattern(node.siblingTypeIndex, pseudo.nthOfType)) return false
  }

  if (pseudo.nthLastOfType !== null) {
    const nthFromTypeEnd = node.siblingTypeCount - node.siblingTypeIndex + 1
    if (!matchesNthPattern(nthFromTypeEnd, pseudo.nthLastOfType)) return false
  }

  for (let i = 0; i < pseudo.anyOfGroups.length; i++) {
    const group = pseudo.anyOfGroups[i]
    if (group === undefined) continue
    let matched = false

    for (let j = 0; j < group.length; j++) {
      const compound = group[j]
      if (compound === undefined) continue
      if (matchesCompound(node, compound) === MatchResult.NoMatch) continue
      matched = true
      break
    }

    if (!matched) return false
  }

  for (let i = 0; i < pseudo.noneOfGroups.length; i++) {
    const group = pseudo.noneOfGroups[i]
    if (group === undefined) continue

    for (let j = 0; j < group.length; j++) {
      const compound = group[j]
      if (compound === undefined) continue
      if (matchesCompound(node, compound) === MatchResult.NoMatch) continue
      return false
    }
  }

  return true
}

function matchesNthPattern(index: number, pattern: NthPattern): boolean {
  if (index < 1) return false

  const step = pattern.step
  const offset = pattern.offset
  if (step === 0) {
    if (offset < 1) return false
    return index === offset
  }

  if (step > 0) {
    const delta = index - offset
    if (delta < 0) return false
    return delta % step === 0
  }

  const positiveStep = -step
  const delta = offset - index
  if (delta < 0) return false
  return delta % positiveStep === 0
}

function matchesRequiredClasses(required: readonly string[], actual: ReadonlySet<string>): boolean {
  if (required.length === 0) return true
  if (actual.size === 0) return false

  for (let i = 0; i < required.length; i++) {
    const cls = required[i]
    if (cls === undefined) continue
    if (actual.has(cls)) continue
    return false
  }

  return true
}

function matchesRequiredAttributes(
  required: readonly SelectorAttributeConstraint[],
  actual: ReadonlyMap<string, string | null>,
): MatchResult {
  if (required.length === 0) return MatchResult.Match

  let hasConditional = false

  for (let i = 0; i < required.length; i++) {
    const constraint = required[i]
    if (constraint === undefined) continue
    if (!actual.has(constraint.name)) return MatchResult.NoMatch
    if (constraint.operator === "exists") {
      continue
    }

    const actualValue = actual.get(constraint.name)
    if (actualValue === undefined) return MatchResult.NoMatch
    if (actualValue === null) {
      hasConditional = true
      continue
    }
    if (constraint.value === null) return MatchResult.NoMatch
    if (matchesAttributeValue(actualValue, constraint)) continue
    return MatchResult.NoMatch
  }

  return hasConditional ? MatchResult.Conditional : MatchResult.Match
}

function matchesAttributeValue(
  actualValue: string,
  constraint: SelectorAttributeConstraint,
): boolean {
  const expectedValue = constraint.value
  if (expectedValue === null) return false

  const actual = constraint.caseInsensitive ? actualValue.toLowerCase() : actualValue
  const expected = constraint.caseInsensitive ? expectedValue.toLowerCase() : expectedValue

  if (constraint.operator === "equals") return actual === expected
  if (constraint.operator === "prefix") return actual.startsWith(expected)
  if (constraint.operator === "suffix") return actual.endsWith(expected)
  if (constraint.operator === "contains") return actual.includes(expected)

  if (constraint.operator === "includes-word") {
    return includesAttributeWord(actual, expected)
  }

  if (constraint.operator === "dash-prefix") {
    if (actual === expected) return true
    return actual.startsWith(expected + "-")
  }

  return false
}

function includesAttributeWord(value: string, word: string): boolean {
  if (value.length === 0 || word.length === 0) return false

  let i = 0
  while (i < value.length) {
    while (i < value.length && isWhitespace(value.charCodeAt(i))) i++
    if (i >= value.length) return false

    const start = i
    while (i < value.length && !isWhitespace(value.charCodeAt(i))) i++
    const tokenLength = i - start
    if (tokenLength !== word.length) continue
    if (value.startsWith(word, start)) return true
  }

  return false
}


// ── bind / bindFile ──────────────────────────────────────────────────────

export function bind(
  element: ElementNode,
  scopedSelectors: ScopedSelectorIndex,
  symbolTable: SymbolTable,
): ElementCascade {
  const state = getOrBuildBindState(symbolTable)
  const edges: SelectorMatch[] = []

  appendMatchingEdges(element, scopedSelectors, edges)

  const declarations = buildCascadeMap(element, edges, state, symbolTable)

  return {
    elementId: element.elementId,
    declarations,
    edges,
  }
}

export function bindFile(
  elements: readonly ElementNode[],
  scopedSelectors: ScopedSelectorIndex,
  symbolTable: SymbolTable,
): ReadonlyMap<number, ElementCascade> {
  const state = getOrBuildBindState(symbolTable)
  const out = new Map<number, ElementCascade>()

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue

    const edges: SelectorMatch[] = []
    appendMatchingEdges(element, scopedSelectors, edges)
    const declarations = buildCascadeMap(element, edges, state, symbolTable)

    out.set(element.elementId, {
      elementId: element.elementId,
      declarations,
      edges,
    })
  }

  return out
}

function appendMatchingEdges(
  element: ElementNode,
  scopedSelectors: ScopedSelectorIndex,
  edges: SelectorMatch[],
): void {
  const candidates: SelectorSymbol[] = []

  const dispatchKeys = element.selectorDispatchKeys
  for (let i = 0; i < dispatchKeys.length; i++) {
    const key = dispatchKeys[i]
    if (key === undefined) continue
    const bucket = scopedSelectors.byDispatchKey.get(key)
    if (!bucket) continue
    for (let j = 0; j < bucket.length; j++) {
      const symbol = bucket[j]
      if (symbol) candidates.push(symbol)
    }
  }

  if (element.tagName !== null) {
    const byTag = scopedSelectors.byTagName.get(element.tagName)
    if (byTag) {
      for (let j = 0; j < byTag.length; j++) {
        const symbol = byTag[j]
        if (symbol) candidates.push(symbol)
      }
    }
  }

  const seen = new Set<number>()
  for (let i = 0; i < candidates.length; i++) {
    const symbol = candidates[i]
    if (!symbol) continue
    if (seen.has(symbol.entity.id)) continue
    seen.add(symbol.entity.id)

    const matcher = symbol.compiledMatcher
    if (matcher === null) continue

    const matchResult = matchElement(matcher, element, null, null)
    if (matchResult === MatchResult.NoMatch) continue

    edges.push({
      selectorId: symbol.entity.id,
      specificityScore: symbol.entity.specificityScore,
      sourceOrder: symbol.entity.rule.sourceOrder,
      conditionalMatch: matchResult === MatchResult.Conditional,
    })
  }
}


// ── Cascade map ──────────────────────────────────────────────────────────

const DYNAMIC_ATTRIBUTE_GUARD: RuleGuard = {
  kind: SignalGuardKind.Conditional,
  conditions: [{ kind: "dynamic-attribute", query: null, key: "dynamic-attribute:*" }],
  key: "dynamic-attribute:*",
}

const INLINE_CASCADE_POSITION: CascadePosition = Object.freeze({
  layer: null,
  layerOrder: Number.MAX_SAFE_INTEGER,
  sourceOrder: Number.MAX_SAFE_INTEGER,
  specificity: [1, 0, 0, 0] as const,
  specificityScore: Number.MAX_SAFE_INTEGER,
  isImportant: false,
})

const INLINE_GUARD_PROVENANCE: RuleGuard = Object.freeze({
  kind: SignalGuardKind.Unconditional,
  conditions: [],
  key: "always",
})

interface CascadeCandidate {
  readonly declaration: CascadedDeclaration
  readonly position: CascadePosition
}

function buildCascadeMap(
  element: ElementNode,
  edges: readonly SelectorMatch[],
  state: { readonly monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]> },
  symbolTable: SymbolTable,
): ReadonlyMap<string, CascadedDeclaration> {
  const out = new Map<string, CascadedDeclaration>()
  const positions = new Map<string, CascadePosition>()

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!edge) continue
    const declarations = state.monitoredDeclarationsBySelectorId.get(edge.selectorId)
    if (!declarations) continue

    for (let j = 0; j < declarations.length; j++) {
      const declaration = declarations[j]
      if (!declaration) continue
      const property = declaration.property

      const guardProvenance = edge.conditionalMatch && declaration.guardProvenance.kind === SignalGuardKind.Unconditional
        ? DYNAMIC_ATTRIBUTE_GUARD
        : declaration.guardProvenance

      const newDeclaration: CascadedDeclaration = {
        value: declaration.value,
        source: SignalSource.Selector,
        guardProvenance,
      }

      const existingPosition = positions.get(property)
      if (existingPosition === undefined) {
        out.set(property, newDeclaration)
        positions.set(property, declaration.position)
        continue
      }

      const existingDeclaration = out.get(property)
      if (existingDeclaration === undefined) continue
      if (!doesCandidateOverride(
        { declaration: existingDeclaration, position: existingPosition },
        { declaration: newDeclaration, position: declaration.position },
      )) continue
      out.set(property, newDeclaration)
      positions.set(property, declaration.position)
    }
  }

  // Inline styles
  for (const [property, value] of element.inlineStyleValues) {
    const newDeclaration: CascadedDeclaration = {
      value,
      source: SignalSource.InlineStyle,
      guardProvenance: INLINE_GUARD_PROVENANCE,
    }

    const existingPosition = positions.get(property)
    if (existingPosition === undefined) {
      out.set(property, newDeclaration)
      positions.set(property, INLINE_CASCADE_POSITION)
      continue
    }

    const existingDeclaration = out.get(property)
    if (existingDeclaration === undefined) continue
    if (!doesCandidateOverride(
      { declaration: existingDeclaration, position: existingPosition },
      { declaration: newDeclaration, position: INLINE_CASCADE_POSITION },
    )) continue
    out.set(property, newDeclaration)
    positions.set(property, INLINE_CASCADE_POSITION)
  }

  // Tailwind augmentation (lowest priority — fills gaps only)
  augmentCascadeWithTailwindFromSymbolTable(out, element, symbolTable)

  return out
}

function doesCandidateOverride(
  existing: CascadeCandidate,
  incoming: CascadeCandidate,
): boolean {
  const existingSource = existing.declaration.source
  const incomingSource = incoming.declaration.source

  if (existingSource !== incomingSource) {
    if (incomingSource === SignalSource.InlineStyle) {
      if (existing.position.isImportant && !incoming.position.isImportant) return false
      return true
    }
    if (existing.position.isImportant && !incoming.position.isImportant) return false
  }

  return compareCascadePositions(incoming.position, existing.position) > 0
}


// ── Tailwind augmentation via symbol table ───────────────────────────────

const TAILWIND_CSS_DECLARATION = /^\s+([\w-]+)\s*:\s*(.+?)\s*;?\s*$/gm

function parseTailwindCssDeclarations(css: string): readonly [string, string][] {
  const result: [string, string][] = []
  TAILWIND_CSS_DECLARATION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAILWIND_CSS_DECLARATION.exec(css)) !== null) {
    const prop = match[1]
    const val = match[2]
    if (prop === undefined || val === undefined) continue
    result.push([prop, val])
  }
  return result
}

function augmentCascadeWithTailwindFromSymbolTable(
  cascade: Map<string, CascadedDeclaration>,
  element: ElementNode,
  symbolTable: SymbolTable,
): void {
  const classTokens = element.classTokens
  if (classTokens.length === 0) return

  const guardProvenance: RuleGuard = {
    kind: SignalGuardKind.Unconditional,
    conditions: [],
    key: "always",
  }

  for (let i = 0; i < classTokens.length; i++) {
    const token = classTokens[i]
    if (token === undefined) continue
    const classSymbol = symbolTable.getClassName(token)
    if (classSymbol === null) continue
    const resolvedCSS = classSymbol.tailwindResolvedCSS
    if (resolvedCSS === null) continue

    const declarations = parseTailwindCssDeclarations(resolvedCSS)
    for (let j = 0; j < declarations.length; j++) {
      const entry = declarations[j]
      if (!entry) continue
      const [property, value] = entry
      if (cascade.has(property)) continue
      cascade.set(property, {
        value,
        source: SignalSource.Selector,
        guardProvenance,
      })
    }
  }
}


// ── Layout fact computation from cascade ─────────────────────────────────

import type { LayoutFactKind, LayoutFactMap, ReservedSpaceFact, ScrollContainerFact, FlowParticipationFact, ContainingBlockFact } from "../analysis/layout-fact"

const SCROLLABLE_VALUES: ReadonlySet<string> = new Set(["auto", "scroll"])
const OUT_OF_FLOW_POSITIONS: ReadonlySet<string> = new Set(["absolute", "fixed", "sticky"])

export function computeLayoutFact<K extends LayoutFactKind>(
  factKind: K,
  elementId: number,
  declarations: ReadonlyMap<string, CascadedDeclaration>,
  allElements: readonly ElementNode[],
  getCascadeForElement: (id: number) => ReadonlyMap<string, CascadedDeclaration>,
): LayoutFactMap[K] {
  switch (factKind) {
    case "reservedSpace": return computeReservedSpaceFact(declarations) as LayoutFactMap[K]
    case "scrollContainer": return computeScrollContainerFact(declarations) as LayoutFactMap[K]
    case "flowParticipation": return computeFlowParticipationFact(declarations) as LayoutFactMap[K]
    case "containingBlock": return computeContainingBlockFact(elementId, allElements, getCascadeForElement) as LayoutFactMap[K]
    default: throw new Error(`Unknown layout fact kind: ${factKind}`)
  }
}

function getCascadeValue(declarations: ReadonlyMap<string, CascadedDeclaration>, property: string): string | null {
  const decl = declarations.get(property)
  if (!decl) return null
  return decl.value.trim().toLowerCase()
}

function computeReservedSpaceFact(declarations: ReadonlyMap<string, CascadedDeclaration>): ReservedSpaceFact {
  const reasons: string[] = []

  const height = getCascadeValue(declarations, "height")
  if (height !== null && height !== "auto" && height !== "fit-content" && height !== "min-content" && height !== "max-content") {
    reasons.push("height")
  }

  const blockSize = getCascadeValue(declarations, "block-size")
  if (blockSize !== null && blockSize !== "auto" && blockSize !== "fit-content" && blockSize !== "min-content" && blockSize !== "max-content") {
    reasons.push("block-size")
  }

  const minHeight = getCascadeValue(declarations, "min-height")
  if (minHeight !== null && minHeight !== "0" && minHeight !== "0px" && minHeight !== "auto") {
    reasons.push("min-height")
  }

  const minBlockSize = getCascadeValue(declarations, "min-block-size")
  if (minBlockSize !== null && minBlockSize !== "0" && minBlockSize !== "0px" && minBlockSize !== "auto") {
    reasons.push("min-block-size")
  }

  const containIntrinsicSize = getCascadeValue(declarations, "contain-intrinsic-size")
  const hasContainIntrinsicSize = containIntrinsicSize !== null
  if (hasContainIntrinsicSize) {
    reasons.push("contain-intrinsic-size")
  }

  const aspectRatio = getCascadeValue(declarations, "aspect-ratio")
  const hasUsableAspectRatio = aspectRatio !== null && aspectRatio !== "auto"

  const width = getCascadeValue(declarations, "width")
  const inlineSize = getCascadeValue(declarations, "inline-size")
  const hasDeclaredInlineDimension = (width !== null && width !== "auto") || (inlineSize !== null && inlineSize !== "auto")
  const hasDeclaredBlockDimension = height !== null && height !== "auto"

  if (hasUsableAspectRatio && hasDeclaredInlineDimension) {
    if (width !== null) reasons.push("aspect-ratio+width")
    if (inlineSize !== null) reasons.push("aspect-ratio+inline-size")
  }

  return {
    hasReservedSpace: reasons.length > 0,
    reasons,
    hasContainIntrinsicSize,
    hasUsableAspectRatio,
    hasDeclaredInlineDimension,
    hasDeclaredBlockDimension,
  }
}

function computeScrollContainerFact(declarations: ReadonlyMap<string, CascadedDeclaration>): ScrollContainerFact {
  const overflow = getCascadeValue(declarations, "overflow")
  const overflowY = getCascadeValue(declarations, "overflow-y")

  let axis = 0
  let isScrollContainer = false
  let hasConditionalScroll = false
  let hasUnconditionalScroll = false

  if (overflow !== null && SCROLLABLE_VALUES.has(overflow)) {
    isScrollContainer = true
    axis = 3 // both
    const decl = declarations.get("overflow")
    if (decl && decl.guardProvenance.kind === SignalGuardKind.Conditional) {
      hasConditionalScroll = true
    } else {
      hasUnconditionalScroll = true
    }
  }

  if (overflowY !== null && SCROLLABLE_VALUES.has(overflowY)) {
    isScrollContainer = true
    if (axis === 0) axis = 2 // vertical only
    const decl = declarations.get("overflow-y")
    if (decl && decl.guardProvenance.kind === SignalGuardKind.Conditional) {
      hasConditionalScroll = true
    } else {
      hasUnconditionalScroll = true
    }
  }

  return {
    isScrollContainer,
    axis,
    overflow,
    overflowY,
    hasConditionalScroll,
    hasUnconditionalScroll,
  }
}

function computeFlowParticipationFact(declarations: ReadonlyMap<string, CascadedDeclaration>): FlowParticipationFact {
  const position = getCascadeValue(declarations, "position")
  const isOutOfFlow = position !== null && OUT_OF_FLOW_POSITIONS.has(position)

  let hasConditionalOutOfFlow = false
  let hasUnconditionalOutOfFlow = false

  if (isOutOfFlow) {
    const decl = declarations.get("position")
    if (decl && decl.guardProvenance.kind === SignalGuardKind.Conditional) {
      hasConditionalOutOfFlow = true
    } else {
      hasUnconditionalOutOfFlow = true
    }
  }

  return {
    inFlow: !isOutOfFlow,
    position,
    hasConditionalOutOfFlow,
    hasUnconditionalOutOfFlow,
  }
}

function computeContainingBlockFact(
  elementId: number,
  allElements: readonly ElementNode[],
  getCascadeForElement: (id: number) => ReadonlyMap<string, CascadedDeclaration>,
): ContainingBlockFact {
  // Walk up the parent chain to find the nearest positioned ancestor
  let current: ElementNode | null = null
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i]
    if (el && el.elementId === elementId) { current = el; break }
  }

  if (current === null) {
    return { nearestPositionedAncestorKey: null, nearestPositionedAncestorHasReservedSpace: false }
  }

  let ancestor = current.parentElementNode
  while (ancestor !== null) {
    const ancestorCascade = getCascadeForElement(ancestor.elementId)
    const pos = getCascadeValue(ancestorCascade, "position")
    if (pos !== null && pos !== "static") {
      const reservedFact = computeReservedSpaceFact(ancestorCascade)
      return {
        nearestPositionedAncestorKey: ancestor.key,
        nearestPositionedAncestorHasReservedSpace: reservedFact.hasReservedSpace,
      }
    }
    ancestor = ancestor.parentElementNode
  }

  return { nearestPositionedAncestorKey: null, nearestPositionedAncestorHasReservedSpace: false }
}
