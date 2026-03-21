import type { CombinatorType, SelectorEntity, SelectorAttributeConstraint, SelectorCompound, NthPattern } from "../../css/entities"
import { PseudoConstraintKind } from "../../css/entities"
import { isWhitespace } from "@drskillissue/ganko-shared"
import type { LayoutElementNode } from "./graph"
import type { LayoutPerfStatsMutable } from "./perf"
import type { Logger } from "@drskillissue/ganko-shared"
import { noopLogger, Level } from "@drskillissue/ganko-shared"

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

const STATEFUL_PSEUDO_CLASSES = new Set<string>([
  "active",
  "checked",
  "default",
  "disabled",
  "enabled",
  "focus",
  "focus-visible",
  "focus-within",
  "hover",
  "indeterminate",
  "invalid",
  "link",
  "optional",
  "placeholder-shown",
  "read-only",
  "read-write",
  "required",
  "target",
  "user-invalid",
  "valid",
  "visited",
])

const EMPTY_PSEUDO: CompoundPseudoConstraints = {
  firstChild: false,
  lastChild: false,
  onlyChild: false,
  nthChild: null,
  nthLastChild: null,
  nthOfType: null,
  nthLastOfType: null,
  anyOfGroups: [],
  noneOfGroups: [],
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
      tagName: sc.tagName,
      idValue: sc.idValue,
      classes: sc.classes,
      attributes: sc.attributes,
      pseudo: EMPTY_PSEUDO,
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

    if (pc.kind === PseudoConstraintKind.Simple) {
      if (STATEFUL_PSEUDO_CLASSES.has(pc.name)) return null
      continue
    }

    if (pc.kind === PseudoConstraintKind.FirstChild) { firstChild = true; continue }
    if (pc.kind === PseudoConstraintKind.LastChild) { lastChild = true; continue }
    if (pc.kind === PseudoConstraintKind.OnlyChild) { firstChild = true; lastChild = true; onlyChild = true; continue }

    if (pc.kind === PseudoConstraintKind.NthChild) {
      if (!pc.nthPattern) return null
      nthChild = pc.nthPattern
      continue
    }
    if (pc.kind === PseudoConstraintKind.NthLastChild) {
      if (!pc.nthPattern) return null
      nthLastChild = pc.nthPattern
      continue
    }
    if (pc.kind === PseudoConstraintKind.NthOfType) {
      if (!pc.nthPattern) return null
      nthOfType = pc.nthPattern
      continue
    }
    if (pc.kind === PseudoConstraintKind.NthLastOfType) {
      if (!pc.nthPattern) return null
      nthLastOfType = pc.nthPattern
      continue
    }

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
    tagName: sc.tagName,
    idValue: sc.idValue,
    classes: sc.classes,
    attributes: sc.attributes,
    pseudo: {
      firstChild,
      lastChild,
      onlyChild,
      nthChild,
      nthLastChild,
      nthOfType,
      nthLastOfType,
      anyOfGroups,
      noneOfGroups,
    },
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
  if (pseudo.firstChild) return true
  if (pseudo.lastChild) return true
  if (pseudo.onlyChild) return true
  if (pseudo.nthChild !== null) return true
  if (pseudo.nthLastChild !== null) return true
  if (pseudo.nthOfType !== null) return true
  if (pseudo.nthLastOfType !== null) return true
  return false
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

  return {
    needsClassTokens,
    needsAttributes,
  }
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

/** Three-valued selector match result. */
export const enum SelectorMatchResult { Match = 0, NoMatch = 1, Conditional = 2 }

export interface FileElementIndex {
  readonly byDispatchKey: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly byTagName: ReadonlyMap<string, readonly LayoutElementNode[]>
}

export function selectorMatchesLayoutElement(
  matcher: CompiledSelectorMatcher,
  node: LayoutElementNode,
  perf: LayoutPerfStatsMutable,
  fileRootElements: readonly LayoutElementNode[] | null = null,
  logger: Logger = noopLogger,
  fileElementIndex: FileElementIndex | null = null,
): SelectorMatchResult {
  const firstCompound = matcher.compoundsRightToLeft[0]
  if (firstCompound === undefined) return SelectorMatchResult.NoMatch
  const subjectResult = matchesCompound(node, firstCompound)
  if (subjectResult === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
  if (matcher.compoundsRightToLeft.length === 1) return subjectResult
  const chainResult = matchesChain(matcher, node, 0, perf, fileRootElements, logger, fileElementIndex)
  if (chainResult === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
  if (subjectResult === SelectorMatchResult.Conditional || chainResult === SelectorMatchResult.Conditional) return SelectorMatchResult.Conditional
  return SelectorMatchResult.Match
}

function matchesChain(
  matcher: CompiledSelectorMatcher,
  node: LayoutElementNode,
  index: number,
  perf: LayoutPerfStatsMutable,
  fileRootElements: readonly LayoutElementNode[] | null,
  logger: Logger,
  fileElementIndex: FileElementIndex | null = null,
): SelectorMatchResult {
  const combinator = matcher.combinatorsRightToLeft[index]
  if (combinator === undefined) return SelectorMatchResult.NoMatch
  const nextIndex = index + 1
  const targetCompound = matcher.compoundsRightToLeft[nextIndex]
  if (targetCompound === undefined) return SelectorMatchResult.NoMatch
  const isFinal = nextIndex === matcher.compoundsRightToLeft.length - 1

  if (combinator === "child") {
    const parent = node.parentElementNode
    if (parent === null) return SelectorMatchResult.NoMatch
    perf.ancestryChecks++
    const compoundResult = matchesCompound(parent, targetCompound)
    if (compoundResult === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
    if (isFinal) return compoundResult
    const chainResult = matchesChain(matcher, parent, nextIndex, perf, fileRootElements, logger, fileElementIndex)
    return mergeMatchResults(compoundResult, chainResult)
  }

  if (combinator === "adjacent") {
    const sibling = node.previousSiblingNode
    if (sibling === null) return SelectorMatchResult.NoMatch
    perf.ancestryChecks++
    const compoundResult = matchesCompound(sibling, targetCompound)
    if (compoundResult === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
    if (isFinal) return compoundResult
    const chainResult = matchesChain(matcher, sibling, nextIndex, perf, fileRootElements, logger, fileElementIndex)
    return mergeMatchResults(compoundResult, chainResult)
  }

  if (combinator === "sibling") {
    let sibling = node.previousSiblingNode
    while (sibling !== null) {
      perf.ancestryChecks++
      const compoundResult = matchesCompound(sibling, targetCompound)
      if (compoundResult !== SelectorMatchResult.NoMatch) {
        if (isFinal) return compoundResult
        const chainResult = matchesChain(matcher, sibling, nextIndex, perf, fileRootElements, logger, fileElementIndex)
        if (chainResult !== SelectorMatchResult.NoMatch) return mergeMatchResults(compoundResult, chainResult)
      }
      sibling = sibling.previousSiblingNode
    }
    return SelectorMatchResult.NoMatch
  }

  // Descendant combinator — walk ancestor chain
  let bestResult: SelectorMatchResult = SelectorMatchResult.NoMatch
  let ancestor = node.parentElementNode
  while (ancestor !== null) {
    perf.ancestryChecks++
    const compoundResult = matchesCompound(ancestor, targetCompound)
    if (compoundResult !== SelectorMatchResult.NoMatch) {
      if (isFinal) return compoundResult
      const chainResult = matchesChain(matcher, ancestor, nextIndex, perf, fileRootElements, logger, fileElementIndex)
      if (chainResult !== SelectorMatchResult.NoMatch) {
        const merged = mergeMatchResults(compoundResult, chainResult)
        if (merged === SelectorMatchResult.Match) return SelectorMatchResult.Match
        bestResult = merged
      }
    }
    ancestor = ancestor.parentElementNode
  }

  // Same-file root element fallback for descendant combinators.
  if (fileRootElements !== null) {
    if (logger.isLevelEnabled(Level.Trace)) {
      const compoundDesc = describeCompound(targetCompound)
      logger.trace(`[selector-match] fallback: node=${node.key} tag=${node.tagName} checking ${fileRootElements.length} roots for compound=${compoundDesc}`)
    }
    for (let r = 0; r < fileRootElements.length; r++) {
      const root = fileRootElements[r]
      if (root === undefined) continue
      if (root === node) continue
      if (root.solidFile !== node.solidFile) continue
      perf.ancestryChecks++
      const compoundResult = matchesCompound(root, targetCompound)
      if (logger.isLevelEnabled(Level.Trace) && compoundResult === SelectorMatchResult.NoMatch) {
        logger.trace(`[selector-match] fallback MISS: root=${root.key} tag=${root.tagName} attrs=[${[...root.attributes.entries()].map(([k,v]) => `${k}=${v}`).join(",")}]`)
      }
      if (compoundResult !== SelectorMatchResult.NoMatch) {
        if (logger.isLevelEnabled(Level.Debug)) {
          const compoundDesc = describeCompound(targetCompound)
          logger.debug(`[selector-match] fallback HIT: node=${node.key} tag=${node.tagName} matched root=${root.key} tag=${root.tagName} compound=${compoundDesc} isFinal=${isFinal}`)
        }
        if (isFinal) return compoundResult
        const chainResult = matchesChain(matcher, root, nextIndex, perf, fileRootElements, logger, fileElementIndex)
        if (chainResult !== SelectorMatchResult.NoMatch) {
          const merged = mergeMatchResults(compoundResult, chainResult)
          if (merged === SelectorMatchResult.Match) return SelectorMatchResult.Match
          bestResult = merged
        }
      }
    }
  }

  // Dispatch-key-indexed fallback for descendant combinators.
  //
  // When the ancestor compound is unreachable via the JSX ancestor chain or
  // file-root elements (e.g. it lives inside a non-transparent wrapper like
  // createContext().Provider), use the per-file dispatch key index for O(1)
  // lookup of candidate elements that could match the ancestor compound.
  // A match on a non-root element returns Conditional: the ancestor compound
  // exists in the same file but static descent cannot be confirmed.
  if (fileElementIndex !== null && bestResult === SelectorMatchResult.NoMatch) {
    const candidates = resolveCompoundCandidates(fileElementIndex, targetCompound)
    if (candidates !== null) {
      for (let r = 0; r < candidates.length; r++) {
        const elem = candidates[r]
        if (elem === undefined) continue
        if (elem === node) continue
        perf.ancestryChecks++
        const compoundResult = matchesCompound(elem, targetCompound)
        if (compoundResult !== SelectorMatchResult.NoMatch) {
          if (logger.isLevelEnabled(Level.Debug)) {
            const compoundDesc = describeCompound(targetCompound)
            logger.debug(`[selector-match] indexed fallback HIT: node=${node.key} tag=${node.tagName} matched elem=${elem.key} tag=${elem.tagName} compound=${compoundDesc}`)
          }
          bestResult = SelectorMatchResult.Conditional
          break
        }
      }
    }
  }

  return bestResult
}

/** Merge two match results — Conditional if either is conditional, NoMatch if either is. */
function mergeMatchResults(a: SelectorMatchResult, b: SelectorMatchResult): SelectorMatchResult {
  if (a === SelectorMatchResult.NoMatch || b === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
  if (a === SelectorMatchResult.Conditional || b === SelectorMatchResult.Conditional) return SelectorMatchResult.Conditional
  return SelectorMatchResult.Match
}

function describeCompound(compound: CompiledSelectorCompound): string {
  const parts: string[] = []
  if (compound.tagName !== null) parts.push(compound.tagName)
  for (let i = 0; i < compound.classes.length; i++) {
    const cls = compound.classes[i]
    if (cls === undefined) continue
    parts.push(`.${cls}`)
  }
  for (let i = 0; i < compound.attributes.length; i++) {
    const attr = compound.attributes[i]
    if (attr === undefined) continue
    if (attr.value !== null) parts.push(`[${attr.name}="${attr.value}"]`)
    else parts.push(`[${attr.name}]`)
  }
  if (compound.idValue !== null) parts.push(`#${compound.idValue}`)
  return parts.join("") || "*"
}

function resolveCompoundCandidates(
  index: FileElementIndex,
  compound: CompiledSelectorCompound,
): readonly LayoutElementNode[] | null {
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

function matchesCompound(node: LayoutElementNode, compound: CompiledSelectorCompound): SelectorMatchResult {
  if (compound.tagName !== null && node.tagName !== compound.tagName) return SelectorMatchResult.NoMatch

  if (compound.idValue !== null) {
    const id = node.attributes.get("id")
    if (id !== compound.idValue) return SelectorMatchResult.NoMatch
  }

  if (!matchesRequiredClasses(compound.classes, node.classTokenSet)) return SelectorMatchResult.NoMatch
  const attrResult = matchesRequiredAttributes(compound.attributes, node.attributes)
  if (attrResult === SelectorMatchResult.NoMatch) return SelectorMatchResult.NoMatch
  if (!matchesPseudoConstraints(node, compound.pseudo)) return SelectorMatchResult.NoMatch

  return attrResult
}

function matchesPseudoConstraints(node: LayoutElementNode, pseudo: CompoundPseudoConstraints): boolean {
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
      if (matchesCompound(node, compound) === SelectorMatchResult.NoMatch) continue
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
      if (matchesCompound(node, compound) === SelectorMatchResult.NoMatch) continue
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
): SelectorMatchResult {
  if (required.length === 0) return SelectorMatchResult.Match

  let hasConditional = false

  for (let i = 0; i < required.length; i++) {
    const constraint = required[i]
    if (constraint === undefined) continue
    if (!actual.has(constraint.name)) return SelectorMatchResult.NoMatch
    if (constraint.operator === "exists") {
      // A null value means the attribute is dynamic — it may or may not
      // exist at runtime. Treat as conditional, not unconditional match.
      const existsValue = actual.get(constraint.name)
      if (existsValue === null) hasConditional = true
      continue
    }

    const actualValue = actual.get(constraint.name)
    if (actualValue === undefined) return SelectorMatchResult.NoMatch
    // Dynamic attribute value (null) — the runtime value COULD match.
    // Record as conditional rather than rejecting the entire selector.
    if (actualValue === null) {
      hasConditional = true
      continue
    }
    if (constraint.value === null) return SelectorMatchResult.NoMatch
    if (matchesAttributeValue(actualValue, constraint)) continue
    return SelectorMatchResult.NoMatch
  }

  return hasConditional ? SelectorMatchResult.Conditional : SelectorMatchResult.Match
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
