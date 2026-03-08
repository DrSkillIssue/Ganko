import type { CombinatorType, SelectorEntity, SelectorAttributeConstraint } from "../../css/entities"
import {
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_COMMA,
  CHAR_DOUBLE_QUOTE,
  CHAR_GT,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_PLUS,
  CHAR_SINGLE_QUOTE,
  CHAR_TILDE,
  isHexDigit,
  isIdentChar,
  isWhitespace,
} from "@drskillissue/ganko-shared"
import type { LayoutElementNode } from "./graph"
import type { LayoutPerfStatsMutable } from "./perf"
import type { Logger } from "@drskillissue/ganko-shared"
import { noopLogger } from "@drskillissue/ganko-shared"

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

interface NthPattern {
  readonly step: number
  readonly offset: number
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

interface ParsedSelectorPattern {
  readonly compounds: readonly string[]
  readonly combinators: readonly CombinatorType[]
}

interface ParsedCompoundPart {
  readonly type: "element" | "universal" | "id" | "class" | "attribute" | "pseudo-class"
  readonly value: string
  readonly raw: string
}

type ParsedPseudoConstraint =
  | { kind: "first-child" }
  | { kind: "last-child" }
  | { kind: "only-child" }
  | { kind: "nth-child"; value: NthPattern }
  | { kind: "nth-last-child"; value: NthPattern }
  | { kind: "nth-of-type"; value: NthPattern }
  | { kind: "nth-last-of-type"; value: NthPattern }
  | { kind: "matches-any"; selectors: readonly CompiledSelectorCompound[] }
  | { kind: "matches-none"; selectors: readonly CompiledSelectorCompound[] }
  | { kind: "ignore" }

const ATTRIBUTE_EXISTS_RE = /^[-_a-zA-Z][-_a-zA-Z0-9]*$/
const ATTRIBUTE_CONSTRAINT_RE = /^([-_a-zA-Z][-_a-zA-Z0-9]*)\s*(=|~=|\|=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?:\s+([iIsS]))?$/
const MAX_PSEUDO_COMPILE_DEPTH = 4

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

export function compileSelectorMatcher(selector: SelectorEntity): CompiledSelectorMatcher | null {
  const parsed = parseSelectorPattern(selector.raw)
  if (parsed === null) return null

  const compoundsLeftToRight: CompiledSelectorCompound[] = []

  for (let i = 0; i < parsed.compounds.length; i++) {
    const compoundRaw = parsed.compounds[i]
    if (compoundRaw === undefined) continue
    const compiled = compileCompound(compoundRaw, 0)
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
    combinatorsRightToLeft: parsed.combinators.toReversed(),
  }
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

export function selectorMatchesLayoutElement(
  matcher: CompiledSelectorMatcher,
  node: LayoutElementNode,
  perf: LayoutPerfStatsMutable,
  fileRootElements: readonly LayoutElementNode[] | null = null,
  logger: Logger = noopLogger,
): boolean {
  const firstCompound = matcher.compoundsRightToLeft[0]
  if (firstCompound === undefined) return false
  if (!matchesCompound(node, firstCompound)) return false
  if (matcher.compoundsRightToLeft.length === 1) return true
  return matchesChain(matcher, node, 0, perf, fileRootElements, logger)
}

function matchesChain(
  matcher: CompiledSelectorMatcher,
  node: LayoutElementNode,
  index: number,
  perf: LayoutPerfStatsMutable,
  fileRootElements: readonly LayoutElementNode[] | null,
  logger: Logger,
): boolean {
  const combinator = matcher.combinatorsRightToLeft[index]
  if (combinator === undefined) return false
  const nextIndex = index + 1
  const targetCompound = matcher.compoundsRightToLeft[nextIndex]
  if (targetCompound === undefined) return false
  const isFinal = nextIndex === matcher.compoundsRightToLeft.length - 1

  if (combinator === "child") {
    const parent = node.parentElementNode
    if (parent === null) return false
    perf.ancestryChecks++
    if (!matchesCompound(parent, targetCompound)) return false
    if (isFinal) return true
    return matchesChain(matcher, parent, nextIndex, perf, fileRootElements, logger)
  }

  if (combinator === "adjacent") {
    const sibling = node.previousSiblingNode
    if (sibling === null) return false
    perf.ancestryChecks++
    if (!matchesCompound(sibling, targetCompound)) return false
    if (isFinal) return true
    return matchesChain(matcher, sibling, nextIndex, perf, fileRootElements, logger)
  }

  if (combinator === "sibling") {
    let sibling = node.previousSiblingNode
    while (sibling !== null) {
      perf.ancestryChecks++
      if (matchesCompound(sibling, targetCompound)) {
        if (isFinal) return true
        if (matchesChain(matcher, sibling, nextIndex, perf, fileRootElements, logger)) return true
      }
      sibling = sibling.previousSiblingNode
    }
    return false
  }

  let ancestor = node.parentElementNode
  while (ancestor !== null) {
    perf.ancestryChecks++
    if (matchesCompound(ancestor, targetCompound)) {
      if (isFinal) return true
      if (matchesChain(matcher, ancestor, nextIndex, perf, fileRootElements, logger)) return true
    }
    ancestor = ancestor.parentElementNode
  }

  // Same-file root element fallback for descendant combinators.
  // When the parent chain is exhausted, check if any root element in the same
  // file matches the remaining ancestor compound. This bridges component function
  // boundaries within composed component APIs (e.g., DataTable.Root + DataTable.Pagination
  // defined as separate functions in the same file and composed at runtime).
  if (fileRootElements !== null) {
    for (let r = 0; r < fileRootElements.length; r++) {
      const root = fileRootElements[r]
      if (root === undefined) continue
      if (root === node) continue
      if (root.solidFile !== node.solidFile) continue
      perf.ancestryChecks++
      if (matchesCompound(root, targetCompound)) {
        if (logger.enabled) {
          const compoundDesc = describeCompound(targetCompound)
          logger.debug(`[selector-match] fallback HIT: node=${node.key} tag=${node.tagName} matched root=${root.key} tag=${root.tagName} compound=${compoundDesc} isFinal=${isFinal}`)
        }
        if (isFinal) return true
        if (matchesChain(matcher, root, nextIndex, perf, fileRootElements, logger)) return true
      }
    }
  }

  return false
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

function matchesCompound(node: LayoutElementNode, compound: CompiledSelectorCompound): boolean {
  if (compound.tagName !== null && node.tagName !== compound.tagName) return false

  if (compound.idValue !== null) {
    const id = node.attributes.get("id")
    if (id !== compound.idValue) return false
  }

  if (!matchesRequiredClasses(compound.classes, node.classTokenSet)) return false
  if (!matchesRequiredAttributes(compound.attributes, node.attributes)) return false
  if (!matchesPseudoConstraints(node, compound.pseudo)) return false

  return true
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
      if (!matchesCompound(node, compound)) continue
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
      if (!matchesCompound(node, compound)) continue
      return false
    }
  }

  return true
}

function parseSelectorPattern(raw: string): ParsedSelectorPattern | null {
  const compounds: string[] = []
  const combinators: CombinatorType[] = []
  const length = raw.length
  let start = 0
  let bracketDepth = 0
  let parenDepth = 0
  let i = 0

  while (i < length) {
    const code = raw.charCodeAt(i)

    if (code === CHAR_OPEN_BRACKET) {
      bracketDepth++
      i++
      continue
    }

    if (code === CHAR_CLOSE_BRACKET) {
      if (bracketDepth > 0) bracketDepth--
      i++
      continue
    }

    if (code === CHAR_OPEN_PAREN) {
      parenDepth++
      i++
      continue
    }

    if (code === CHAR_CLOSE_PAREN) {
      if (parenDepth > 0) parenDepth--
      i++
      continue
    }

    if (bracketDepth === 0 && parenDepth === 0) {
      if (code === CHAR_GT || code === CHAR_PLUS || code === CHAR_TILDE) {
        const compound = raw.slice(start, i).trim()
        if (compound.length === 0) return null
        compounds.push(compound)
        combinators.push(combinatorFromCode(code))
        i++
        while (i < length && isWhitespace(raw.charCodeAt(i))) i++
        start = i
        continue
      }

      if (isWhitespace(code)) {
        const compound = raw.slice(start, i).trim()
        if (compound.length > 0) compounds.push(compound)

        while (i < length && isWhitespace(raw.charCodeAt(i))) i++
        if (i >= length) break

        const next = raw.charCodeAt(i)
        if (next === CHAR_GT || next === CHAR_PLUS || next === CHAR_TILDE) {
          if (compound.length === 0) return null
          combinators.push(combinatorFromCode(next))
          i++
          while (i < length && isWhitespace(raw.charCodeAt(i))) i++
          start = i
          continue
        }

        if (compound.length > 0) combinators.push("descendant")
        start = i
        continue
      }
    }

    i++
  }

  const trailing = raw.slice(start).trim()
  if (trailing.length > 0) compounds.push(trailing)
  if (compounds.length === 0) return null
  if (combinators.length !== compounds.length - 1) return null

  return { compounds, combinators }
}

function combinatorFromCode(code: number): CombinatorType {
  if (code === CHAR_GT) return "child"
  if (code === CHAR_PLUS) return "adjacent"
  return "sibling"
}

function compileCompound(raw: string, depth: number): CompiledSelectorCompound | null {
  if (depth > MAX_PSEUDO_COMPILE_DEPTH) return null

  const parts = parseCompoundParts(raw)
  if (parts.length === 0) return null

  let tagName: string | null = null
  let idValue: string | null = null
  const classes: string[] = []
  const seenClasses = new Set<string>()
  const attributes: SelectorAttributeConstraint[] = []
  let firstChild = false
  let lastChild = false
  let onlyChild = false
  let nthChild: NthPattern | null = null
  let nthLastChild: NthPattern | null = null
  let nthOfType: NthPattern | null = null
  let nthLastOfType: NthPattern | null = null
  const anyOfGroups: (readonly CompiledSelectorCompound[])[] = []
  const noneOfGroups: (readonly CompiledSelectorCompound[])[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === undefined) continue

    if (part.type === "element") {
      tagName = part.value.toLowerCase()
      continue
    }

    if (part.type === "universal") continue

    if (part.type === "id") {
      idValue = part.value
      continue
    }

    if (part.type === "class") {
      if (seenClasses.has(part.value)) continue
      seenClasses.add(part.value)
      classes.push(part.value)
      continue
    }

    if (part.type === "attribute") {
      const attribute = parseAttributeConstraint(part.value)
      if (attribute === null) return null
      attributes.push(attribute)
      continue
    }

    if (part.type === "pseudo-class") {
      const pseudo = parsePseudoConstraint(part.raw, depth)
      if (pseudo === null) return null

      if (pseudo.kind === "first-child") {
        firstChild = true
        continue
      }

      if (pseudo.kind === "last-child") {
        lastChild = true
        continue
      }

      if (pseudo.kind === "only-child") {
        firstChild = true
        lastChild = true
        onlyChild = true
        continue
      }

      if (pseudo.kind === "nth-child") {
        if (nthChild !== null && !isSameNthPattern(nthChild, pseudo.value)) return null
        nthChild = pseudo.value
        continue
      }

      if (pseudo.kind === "nth-last-child") {
        if (nthLastChild !== null && !isSameNthPattern(nthLastChild, pseudo.value)) return null
        nthLastChild = pseudo.value
        continue
      }

      if (pseudo.kind === "nth-of-type") {
        if (nthOfType !== null && !isSameNthPattern(nthOfType, pseudo.value)) return null
        nthOfType = pseudo.value
        continue
      }

      if (pseudo.kind === "nth-last-of-type") {
        if (nthLastOfType !== null && !isSameNthPattern(nthLastOfType, pseudo.value)) return null
        nthLastOfType = pseudo.value
        continue
      }

      if (pseudo.kind === "ignore") continue

      if (pseudo.kind === "matches-any") {
        anyOfGroups.push(pseudo.selectors)
        continue
      }

      noneOfGroups.push(pseudo.selectors)
      continue
    }

    return null
  }

  if (firstChild && nthChild !== null && !matchesNthPattern(1, nthChild)) return null
  if (lastChild && nthLastChild !== null && !matchesNthPattern(1, nthLastChild)) return null

  return {
    tagName,
    idValue,
    classes,
    attributes,
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

function parseAttributeConstraint(raw: string): SelectorAttributeConstraint | null {
  const trimmed = raw.trim()
  const constrained = ATTRIBUTE_CONSTRAINT_RE.exec(trimmed)

  if (constrained) {
    const operatorToken = constrained[2]
    if (operatorToken === undefined) return null
    const operator = mapAttributeOperatorFromToken(operatorToken)
    if (operator === null) return null

    const value = constrained[3] ?? constrained[4] ?? constrained[5] ?? null
    if (value === null) return null

    const nameToken = constrained[1]
    if (nameToken === undefined) return null

    return {
      name: nameToken.toLowerCase(),
      operator,
      value,
      caseInsensitive: (constrained[6] ?? "").toLowerCase() === "i",
    }
  }

  if (!ATTRIBUTE_EXISTS_RE.test(trimmed)) return null

  return {
    name: trimmed.toLowerCase(),
    operator: "exists",
    value: null,
    caseInsensitive: false,
  }
}

function mapAttributeOperatorFromToken(
  operator: string,
): SelectorAttributeConstraint["operator"] | null {
  if (operator === "=") return "equals"
  if (operator === "~=") return "includes-word"
  if (operator === "|=") return "dash-prefix"
  if (operator === "^=") return "prefix"
  if (operator === "$=") return "suffix"
  if (operator === "*=") return "contains"
  return null
}

function parsePseudoConstraint(raw: string, depth: number): ParsedPseudoConstraint | null {
  const trimmed = raw.trim()
  const normalized = trimmed.toLowerCase()

  if (normalized === ":first-child") return { kind: "first-child" }
  if (normalized === ":last-child") return { kind: "last-child" }
  if (normalized === ":only-child") return { kind: "only-child" }

  const nthChild = parseNthPseudoArgument(trimmed, "nth-child")
  if (nthChild !== undefined) {
    if (nthChild === null) return null
    return { kind: "nth-child", value: nthChild }
  }

  const nthLastChild = parseNthPseudoArgument(trimmed, "nth-last-child")
  if (nthLastChild !== undefined) {
    if (nthLastChild === null) return null
    return { kind: "nth-last-child", value: nthLastChild }
  }

  const nthOfType = parseNthPseudoArgument(trimmed, "nth-of-type")
  if (nthOfType !== undefined) {
    if (nthOfType === null) return null
    return { kind: "nth-of-type", value: nthOfType }
  }

  const nthLastOfType = parseNthPseudoArgument(trimmed, "nth-last-of-type")
  if (nthLastOfType !== undefined) {
    if (nthLastOfType === null) return null
    return { kind: "nth-last-of-type", value: nthLastOfType }
  }

  const name = readPseudoName(normalized)
  if (name === null) return null
  if (STATEFUL_PSEUDO_CLASSES.has(name)) return null

  if (name !== "is" && name !== "where" && name !== "not") {
    return { kind: "ignore" }
  }

  const content = extractFunctionalPseudoContent(trimmed, name)
  if (content === null) return null

  const selectors = compileFunctionalPseudoArguments(content, depth + 1)
  if (selectors === null || selectors.length === 0) return null

  if (name === "not") {
    return {
      kind: "matches-none",
      selectors,
    }
  }

  return {
    kind: "matches-any",
    selectors,
  }
}

function parseNthPseudoArgument(
  raw: string,
  name: "nth-child" | "nth-last-child" | "nth-of-type" | "nth-last-of-type",
): NthPattern | null | undefined {
  const content = extractFunctionalPseudoContent(raw, name)
  if (content === null) return undefined
  return parseNthPattern(content)
}

function parseNthPattern(raw: string): NthPattern | null {
  const normalized = raw.trim().toLowerCase().replaceAll(" ", "")
  if (normalized.length === 0) return null

  if (normalized === "odd") {
    return { step: 2, offset: 1 }
  }

  if (normalized === "even") {
    return { step: 2, offset: 0 }
  }

  const nIndex = normalized.indexOf("n")
  if (nIndex === -1) {
    const value = Number.parseInt(normalized, 10)
    if (Number.isNaN(value)) return null
    return { step: 0, offset: value }
  }

  const stepPart = normalized.slice(0, nIndex)
  const offsetPart = normalized.slice(nIndex + 1)

  let step: number
  if (stepPart.length === 0 || stepPart === "+") {
    step = 1
  } else if (stepPart === "-") {
    step = -1
  } else {
    step = Number.parseInt(stepPart, 10)
    if (Number.isNaN(step)) return null
  }

  let offset = 0
  if (offsetPart.length > 0) {
    offset = Number.parseInt(offsetPart, 10)
    if (Number.isNaN(offset)) return null
  }

  return {
    step,
    offset,
  }
}

function extractFunctionalPseudoContent(raw: string, name: string): string | null {
  const prefix = `:${name}(`
  if (!raw.toLowerCase().startsWith(prefix)) return null
  if (!raw.endsWith(")")) return null
  return raw.slice(prefix.length, -1)
}

function compileFunctionalPseudoArguments(content: string, depth: number): readonly CompiledSelectorCompound[] | null {
  if (depth > MAX_PSEUDO_COMPILE_DEPTH) return null

  const args = splitTopLevelSelectorArguments(content)
  if (args.length === 0) return null

  const out: CompiledSelectorCompound[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) return null
    const raw = arg.trim()
    if (raw.length === 0) return null

    const parsed = parseSelectorPattern(raw)
    if (parsed === null) return null
    if (parsed.combinators.length !== 0) return null
    if (parsed.compounds.length !== 1) return null

    const compoundRaw = parsed.compounds[0]
    if (compoundRaw === undefined) return null
    const compiled = compileCompound(compoundRaw, depth)
    if (compiled === null) return null
    out.push(compiled)
  }

  return out
}

function splitTopLevelSelectorArguments(content: string): readonly string[] {
  const out: string[] = []
  let start = 0
  let parenDepth = 0
  let bracketDepth = 0
  let quote: number | null = null

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)

    if (quote !== null) {
      if (code === quote) quote = null
      continue
    }

    if (code === CHAR_SINGLE_QUOTE || code === CHAR_DOUBLE_QUOTE) {
      quote = code
      continue
    }

    if (code === CHAR_OPEN_PAREN) {
      parenDepth++
      continue
    }

    if (code === CHAR_CLOSE_PAREN) {
      if (parenDepth > 0) parenDepth--
      continue
    }

    if (code === CHAR_OPEN_BRACKET) {
      bracketDepth++
      continue
    }

    if (code === CHAR_CLOSE_BRACKET) {
      if (bracketDepth > 0) bracketDepth--
      continue
    }

    if (code !== CHAR_COMMA) continue
    if (parenDepth !== 0) continue
    if (bracketDepth !== 0) continue

    out.push(content.slice(start, i))
    start = i + 1
  }

  out.push(content.slice(start))
  return out
}

function parseCompoundParts(raw: string): readonly ParsedCompoundPart[] {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []

  const out: ParsedCompoundPart[] = []
  const length = trimmed.length
  let i = 0
  let allowsElement = true

  while (i < length) {
    const code = trimmed.charCodeAt(i)

    if (code === CHAR_OPEN_BRACKET) {
      const end = readBracketed(trimmed, i)
      if (end === null) return []
      const inner = trimmed.slice(i + 1, end - 1)
      out.push({
        type: "attribute",
        value: inner,
        raw: trimmed.slice(i, end),
      })
      i = end
      allowsElement = false
      continue
    }

    if (code === 35) {
      const ident = readIdentifier(trimmed, i + 1)
      if (ident.consumed === 0) return []
      out.push({
        type: "id",
        value: ident.value,
        raw: trimmed.slice(i, i + 1 + ident.consumed),
      })
      i += 1 + ident.consumed
      allowsElement = false
      continue
    }

    if (code === 46) {
      const ident = readIdentifier(trimmed, i + 1)
      if (ident.consumed === 0) return []
      out.push({
        type: "class",
        value: ident.value,
        raw: trimmed.slice(i, i + 1 + ident.consumed),
      })
      i += 1 + ident.consumed
      allowsElement = false
      continue
    }

    if (code === 58) {
      const pseudo = readPseudo(trimmed, i)
      if (pseudo === null) return []
      out.push(pseudo)
      i += pseudo.raw.length
      allowsElement = false
      continue
    }

    if (code === 42) {
      out.push({
        type: "universal",
        value: "*",
        raw: "*",
      })
      i++
      allowsElement = false
      continue
    }

    if (!allowsElement) return []

    const ident = readIdentifier(trimmed, i)
    if (ident.consumed === 0) return []
    out.push({
      type: "element",
      value: ident.value,
      raw: trimmed.slice(i, i + ident.consumed),
    })
    i += ident.consumed
    allowsElement = false
  }

  return out
}

function readPseudo(input: string, start: number): ParsedCompoundPart | null {
  const second = input.charCodeAt(start + 1)
  if (second === 58) return null

  let i = start + 1
  while (i < input.length) {
    const code = input.charCodeAt(i)
    if (!isIdentChar(code)) break
    i++
  }

  if (i === start + 1) return null
  const value = input.slice(start + 1, i)

  if (input.charCodeAt(i) !== CHAR_OPEN_PAREN) {
    return {
      type: "pseudo-class",
      value,
      raw: input.slice(start, i),
    }
  }

  const end = readParenthesized(input, i)
  if (end === null) return null

  return {
    type: "pseudo-class",
    value,
    raw: input.slice(start, end),
  }
}

function readBracketed(input: string, start: number): number | null {
  let quote: number | null = null
  let depth = 0

  for (let i = start; i < input.length; i++) {
    const code = input.charCodeAt(i)

    if (quote !== null) {
      if (code === quote) quote = null
      continue
    }

    if (code === CHAR_SINGLE_QUOTE || code === CHAR_DOUBLE_QUOTE) {
      quote = code
      continue
    }

    if (code === CHAR_OPEN_BRACKET) {
      depth++
      continue
    }

    if (code !== CHAR_CLOSE_BRACKET) continue
    depth--
    if (depth === 0) return i + 1
    if (depth < 0) return null
  }

  return null
}

function readParenthesized(input: string, start: number): number | null {
  let quote: number | null = null
  let depth = 0

  for (let i = start; i < input.length; i++) {
    const code = input.charCodeAt(i)

    if (quote !== null) {
      if (code === quote) quote = null
      continue
    }

    if (code === CHAR_SINGLE_QUOTE || code === CHAR_DOUBLE_QUOTE) {
      quote = code
      continue
    }

    if (code === CHAR_OPEN_PAREN) {
      depth++
      continue
    }

    if (code !== CHAR_CLOSE_PAREN) continue
    depth--
    if (depth === 0) return i + 1
    if (depth < 0) return null
  }

  return null
}

interface IdentifierReadResult {
  readonly value: string
  readonly consumed: number
}

const EMPTY_IDENTIFIER: IdentifierReadResult = { value: "", consumed: 0 }

/**
 * Reads a CSS identifier from the input, starting at `start`.
 *
 * Handles CSS escape sequences per CSS Syntax Level 3 §4.3.7:
 * - `\` followed by 1-6 hex digits (optionally followed by one whitespace)
 *   represents the Unicode code point.
 * - `\` followed by any non-hex, non-newline character represents that
 *   character literally (e.g. `\[` → `[`, `\]` → `]`).
 *
 * Returns the decoded identifier value and the number of raw characters consumed
 * from the input, which may differ from `value.length` when escapes are present.
 */
function readIdentifier(input: string, start: number): IdentifierReadResult {
  const length = input.length
  let i = start
  let hasEscape = false

  while (i < length) {
    const code = input.charCodeAt(i)

    if (code === CHAR_BACKSLASH) {
      if (i + 1 >= length) break
      hasEscape = true
      i = skipCssEscapeSequence(input, i + 1)
      continue
    }

    if (!isIdentChar(code)) break
    i++
  }

  const consumed = i - start
  if (consumed === 0) return EMPTY_IDENTIFIER

  if (!hasEscape) {
    const value = input.slice(start, i)
    return { value, consumed }
  }

  return { value: decodeCssEscapes(input, start, i), consumed }
}

const CHAR_BACKSLASH = 92

/**
 * Advances past a CSS escape sequence starting AFTER the leading backslash.
 * Returns the index of the first character after the escape.
 */
function skipCssEscapeSequence(input: string, afterBackslash: number): number {
  const length = input.length
  if (afterBackslash >= length) return afterBackslash

  const first = input.charCodeAt(afterBackslash)
  if (!isHexDigit(first)) return afterBackslash + 1

  let end = afterBackslash + 1
  const maxHex = Math.min(afterBackslash + 6, length)
  while (end < maxHex && isHexDigit(input.charCodeAt(end))) end++

  if (end < length && isWhitespace(input.charCodeAt(end))) end++
  return end
}

/**
 * Decodes CSS escape sequences in a slice of the input, producing the
 * unescaped identifier string.
 */
function decodeCssEscapes(input: string, start: number, end: number): string {
  const parts: string[] = []
  let i = start

  while (i < end) {
    const code = input.charCodeAt(i)

    if (code !== CHAR_BACKSLASH) {
      parts.push(String.fromCharCode(code))
      i++
      continue
    }

    i++
    if (i >= end) break

    const first = input.charCodeAt(i)
    if (!isHexDigit(first)) {
      parts.push(String.fromCharCode(first))
      i++
      continue
    }

    const hexStart = i
    const maxHex = Math.min(i + 6, end)
    while (i < maxHex && isHexDigit(input.charCodeAt(i))) i++

    const codePoint = Number.parseInt(input.slice(hexStart, i), 16)
    if (codePoint > 0 && codePoint <= 0x10FFFF) {
      parts.push(String.fromCodePoint(codePoint))
    }

    if (i < end && isWhitespace(input.charCodeAt(i))) i++
  }

  return parts.join("")
}

function isSameNthPattern(left: NthPattern, right: NthPattern): boolean {
  if (left.step !== right.step) return false
  return left.offset === right.offset
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

function readPseudoName(raw: string): string | null {
  if (!raw.startsWith(":")) return null

  let index = 1
  while (index < raw.length) {
    const code = raw.charCodeAt(index)
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    const isDash = code === 45
    if (!isUpper && !isLower && !isDash) break
    index++
  }

  if (index <= 1) return null
  return raw.slice(1, index)
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
): boolean {
  if (required.length === 0) return true

  for (let i = 0; i < required.length; i++) {
    const constraint = required[i]
    if (constraint === undefined) continue
    if (!actual.has(constraint.name)) return false
    if (constraint.operator === "exists") continue

    const actualValue = actual.get(constraint.name)
    if (actualValue === null || actualValue === undefined) return false
    if (constraint.value === null) return false
    if (matchesAttributeValue(actualValue, constraint)) continue
    return false
  }

  return true
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
