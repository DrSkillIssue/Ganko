/**
 * Selector symbol + compiled matcher.
 *
 * compileSelectorMatcher moved from cross-file/layout/selector-match.ts.
 */
import type { SelectorEntity, SelectorAttributeConstraint, SelectorCompound, NthPattern, CombinatorType } from "../../css/entities/selector"
import { PseudoConstraintKind } from "../../css/entities"

// ── Compiled matcher types ───────────────────────────────────────────────

interface CompoundPseudoConstraints {
  readonly firstChild: boolean
  readonly lastChild: boolean
  readonly onlyChild: boolean
  readonly nthChild: NthPattern | null
  readonly nthLastChild: NthPattern | null
  readonly nthOfType: NthPattern | null
  readonly nthLastOfType: NthPattern | null
  readonly anyOfGroups: readonly (readonly CompiledSelectorCompound[])[]
  readonly noneOfGroups: readonly (readonly CompiledSelectorCompound[])[]
}

interface CompiledSelectorCompound {
  readonly tagName: string | null
  readonly idValue: string | null
  readonly classes: readonly string[]
  readonly attributes: readonly SelectorAttributeConstraint[]
  readonly pseudo: CompoundPseudoConstraints
}

export interface SelectorSubjectConstraintSummary {
  readonly idValue: string | null
  readonly classes: readonly string[]
  readonly attributeNames: readonly string[]
  readonly hasStructuralPseudo: boolean
}

export interface SelectorFeatureRequirements {
  readonly needsClassTokens: boolean
  readonly needsAttributes: boolean
}

export interface CompiledSelectorMatcher {
  readonly subjectTag: string | null
  readonly subject: SelectorSubjectConstraintSummary
  readonly requirements: SelectorFeatureRequirements
  readonly compoundsRightToLeft: readonly CompiledSelectorCompound[]
  readonly combinatorsRightToLeft: readonly CombinatorType[]
}


// ── SelectorSymbol ───────────────────────────────────────────────────────

export interface SelectorSymbol {
  readonly symbolKind: "selector"
  readonly name: string
  readonly filePath: string | null
  readonly entity: SelectorEntity
  readonly specificity: readonly [number, number, number]
  readonly dispatchKeys: readonly string[]
  readonly compiledMatcher: CompiledSelectorMatcher | null
}

export function createSelectorSymbol(entity: SelectorEntity, filePath: string): SelectorSymbol {
  const matcher = compileSelectorMatcher(entity)

  let dispatchKeys: string[]
  if (matcher !== null) {
    const subject = matcher.subject
    const keySet = new Set<string>()

    if (subject.idValue !== null) {
      keySet.add(`id:${subject.idValue}`)
    }

    const classes = subject.classes
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i]
      if (cls !== undefined) keySet.add(`class:${cls}`)
    }

    const attributeNames = subject.attributeNames
    for (let i = 0; i < attributeNames.length; i++) {
      const attr = attributeNames[i]
      if (attr !== undefined) keySet.add(`attr:${attr}`)
    }

    dispatchKeys = Array.from(keySet).toSorted()
  } else {
    dispatchKeys = []
  }

  return {
    symbolKind: "selector",
    name: entity.raw,
    filePath,
    entity,
    specificity: [entity.specificity[1], entity.specificity[2], entity.specificity[3]],
    dispatchKeys,
    compiledMatcher: matcher,
  }
}


// ── compileSelectorMatcher ───────────────────────────────────────────────

const STATEFUL_PSEUDO_CLASSES = new Set<string>([
  "active", "checked", "default", "disabled", "enabled",
  "focus", "focus-visible", "focus-within", "hover", "indeterminate",
  "invalid", "link", "optional", "placeholder-shown", "read-only",
  "read-write", "required", "target", "user-invalid", "valid", "visited",
])

const EMPTY_PSEUDO: CompoundPseudoConstraints = {
  firstChild: false, lastChild: false, onlyChild: false,
  nthChild: null, nthLastChild: null, nthOfType: null, nthLastOfType: null,
  anyOfGroups: [], noneOfGroups: [],
}

export function compileSelectorMatcher(selector: SelectorEntity): CompiledSelectorMatcher | null {
  const selectorCompounds = selector.compounds
  if (selectorCompounds.length === 0) return null

  const compoundsLeftToRight: CompiledSelectorCompound[] = []

  for (let i = 0; i < selectorCompounds.length; i++) {
    const sc = selectorCompounds[i]
    if (sc === undefined) continue
    const compiled = buildCompiledCompound(sc)
    if (compiled === null) return null
    compoundsLeftToRight.push(compiled)
  }

  if (compoundsLeftToRight.length === 0) return null

  const subject = compoundsLeftToRight[compoundsLeftToRight.length - 1]
  if (subject === undefined) return null

  return {
    subjectTag: subject.tagName,
    subject: {
      idValue: subject.idValue,
      classes: subject.classes,
      attributeNames: collectSubjectAttributeNames(subject),
      hasStructuralPseudo: hasStructuralPseudoConstraints(subject),
    },
    requirements: resolveFeatureRequirements(compoundsLeftToRight),
    compoundsRightToLeft: compoundsLeftToRight.toReversed(),
    combinatorsRightToLeft: selector.combinators.toReversed(),
  }
}

function buildCompiledCompound(sc: SelectorCompound): CompiledSelectorCompound | null {
  const parts = sc.parts
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    if (part.type === "pseudo-element") return null
  }

  const pseudoConstraints = sc.pseudoClasses
  if (pseudoConstraints.length === 0) {
    return {
      tagName: sc.tagName, idValue: sc.idValue, classes: sc.classes,
      attributes: sc.attributes, pseudo: EMPTY_PSEUDO,
    }
  }

  let firstChild = false
  let lastChild = false
  let onlyChild = false
  let nthChild: NthPattern | null = null
  let nthLastChild: NthPattern | null = null
  let nthOfType: NthPattern | null = null
  let nthLastOfType: NthPattern | null = null
  const anyOfGroups: (readonly CompiledSelectorCompound[])[] = []
  const noneOfGroups: (readonly CompiledSelectorCompound[])[] = []

  for (let i = 0; i < pseudoConstraints.length; i++) {
    const pc = pseudoConstraints[i]
    if (!pc) continue
    if (pc.kind === PseudoConstraintKind.Simple) { if (STATEFUL_PSEUDO_CLASSES.has(pc.name)) return null; continue }
    if (pc.kind === PseudoConstraintKind.FirstChild) { firstChild = true; continue }
    if (pc.kind === PseudoConstraintKind.LastChild) { lastChild = true; continue }
    if (pc.kind === PseudoConstraintKind.OnlyChild) { firstChild = true; lastChild = true; onlyChild = true; continue }
    if (pc.kind === PseudoConstraintKind.NthChild) { if (!pc.nthPattern) return null; nthChild = pc.nthPattern; continue }
    if (pc.kind === PseudoConstraintKind.NthLastChild) { if (!pc.nthPattern) return null; nthLastChild = pc.nthPattern; continue }
    if (pc.kind === PseudoConstraintKind.NthOfType) { if (!pc.nthPattern) return null; nthOfType = pc.nthPattern; continue }
    if (pc.kind === PseudoConstraintKind.NthLastOfType) { if (!pc.nthPattern) return null; nthLastOfType = pc.nthPattern; continue }
    if (pc.kind === PseudoConstraintKind.MatchesAny) {
      if (pc.nestedCompounds && pc.nestedCompounds.length > 0) {
        const group = buildNestedGroup(pc.nestedCompounds)
        if (group === null) return null
        if (group.length > 0) anyOfGroups.push(group)
      }
      continue
    }
    if (pc.kind === PseudoConstraintKind.NoneOf) {
      if (pc.nestedCompounds && pc.nestedCompounds.length > 0) {
        const group = buildNestedGroup(pc.nestedCompounds)
        if (group === null) return null
        if (group.length > 0) noneOfGroups.push(group)
      }
      continue
    }
  }

  return {
    tagName: sc.tagName, idValue: sc.idValue, classes: sc.classes, attributes: sc.attributes,
    pseudo: { firstChild, lastChild, onlyChild, nthChild, nthLastChild, nthOfType, nthLastOfType, anyOfGroups, noneOfGroups },
  }
}

function buildNestedGroup(nestedCompounds: readonly SelectorCompound[][]): readonly CompiledSelectorCompound[] | null {
  const out: CompiledSelectorCompound[] = []
  for (let i = 0; i < nestedCompounds.length; i++) {
    const compoundGroup = nestedCompounds[i]
    if (!compoundGroup) continue
    if (compoundGroup.length !== 1) continue
    const sc = compoundGroup[0]
    if (!sc) continue
    const compiled = buildCompiledCompound(sc)
    if (compiled === null) return null
    out.push(compiled)
  }
  return out
}

function collectSubjectAttributeNames(subject: CompiledSelectorCompound): readonly string[] {
  if (subject.attributes.length === 0) return []
  const names = new Set<string>()
  for (let i = 0; i < subject.attributes.length; i++) {
    const attr = subject.attributes[i]
    if (attr === undefined) continue
    names.add(attr.name)
  }
  return [...names]
}

function hasStructuralPseudoConstraints(subject: CompiledSelectorCompound): boolean {
  const pseudo = subject.pseudo
  return pseudo.firstChild || pseudo.lastChild || pseudo.onlyChild
    || pseudo.nthChild !== null || pseudo.nthLastChild !== null
    || pseudo.nthOfType !== null || pseudo.nthLastOfType !== null
}

function resolveFeatureRequirements(compounds: readonly CompiledSelectorCompound[]): SelectorFeatureRequirements {
  let needsClassTokens = false
  let needsAttributes = false
  for (let i = 0; i < compounds.length; i++) {
    const compound = compounds[i]
    if (compound === undefined) continue
    if (!needsClassTokens && compoundNeedsClassTokens(compound)) needsClassTokens = true
    if (!needsAttributes && compoundNeedsAttributes(compound)) needsAttributes = true
    if (needsClassTokens && needsAttributes) break
  }
  return { needsClassTokens, needsAttributes }
}

function compoundNeedsClassTokens(compound: CompiledSelectorCompound): boolean {
  if (compound.classes.length > 0) return true
  const pseudo = compound.pseudo
  if (compoundGroupNeedsClassTokens(pseudo.anyOfGroups)) return true
  if (compoundGroupNeedsClassTokens(pseudo.noneOfGroups)) return true
  return false
}

function compoundGroupNeedsClassTokens(groups: readonly (readonly CompiledSelectorCompound[])[]): boolean {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (group === undefined) continue
    for (let j = 0; j < group.length; j++) {
      const compound = group[j]
      if (compound === undefined) continue
      if (compoundNeedsClassTokens(compound)) return true
    }
  }
  return false
}

function compoundNeedsAttributes(compound: CompiledSelectorCompound): boolean {
  if (compound.idValue !== null) return true
  if (compound.attributes.length > 0) return true
  const pseudo = compound.pseudo
  if (compoundGroupNeedsAttributes(pseudo.anyOfGroups)) return true
  if (compoundGroupNeedsAttributes(pseudo.noneOfGroups)) return true
  return false
}

function compoundGroupNeedsAttributes(groups: readonly (readonly CompiledSelectorCompound[])[]): boolean {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (group === undefined) continue
    for (let j = 0; j < group.length; j++) {
      const compound = group[j]
      if (compound === undefined) continue
      if (compoundNeedsAttributes(compound)) return true
    }
  }
  return false
}
