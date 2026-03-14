import type { SelectorEntity } from "../../css/entities"
import type { CSSGraph } from "../../css/impl"
import { canonicalPath } from "@drskillissue/ganko-shared"
import type { LayoutElementNode } from "./graph"
import type { LayoutRuleGuard } from "./guard-model"
import type { CompiledSelectorMatcher, SelectorFeatureRequirements } from "./selector-match"
import type { LayoutPerfStatsMutable } from "./perf"

export interface LayoutSelectorCandidate {
  readonly selector: SelectorEntity
  readonly matcher: CompiledSelectorMatcher
  readonly subjectDispatchKeys: readonly string[]
}

export interface SelectorDispatchBucket {
  readonly unconstrained: readonly LayoutSelectorCandidate[]
  readonly constrained: readonly LayoutSelectorCandidate[]
  readonly bySubjectKey: ReadonlyMap<string, readonly LayoutSelectorCandidate[]>
}

export interface ScopedSelectorIndex {
  readonly bySubjectTag: ReadonlyMap<string, SelectorDispatchBucket>
  readonly withoutSubjectTag: SelectorDispatchBucket
  readonly requirements: SelectorFeatureRequirements
}

export interface SelectorBuildMetadata {
  readonly guard: LayoutRuleGuard
  readonly matcher: CompiledSelectorMatcher | null
}

const EMPTY_SELECTOR_LIST: readonly LayoutSelectorCandidate[] = []
const EMPTY_NUMBER_LIST: readonly number[] = []
const EMPTY_SELECTOR_BUCKET: SelectorDispatchBucket = {
  unconstrained: EMPTY_SELECTOR_LIST,
  constrained: EMPTY_SELECTOR_LIST,
  bySubjectKey: new Map(),
}

export function buildScopedSelectorIndexBySolidFile(
  cssScopeBySolidFile: ReadonlyMap<string, readonly string[]>,
  css: CSSGraph,
  selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>,
  perf: LayoutPerfStatsMutable,
): ReadonlyMap<string, ScopedSelectorIndex> {
  const selectorsByNormalizedFile = new Map<string, SelectorEntity[]>()
  const conditionalSelectorIds = new Set<number>()
  const normalizedPathCache = new Map<string, string>()

  for (let i = 0; i < css.selectors.length; i++) {
    const selector = css.selectors[i]
    if (!selector) continue
    const normalized = normalizeWithCache(normalizedPathCache, selector.rule.file.path)
    const existing = selectorsByNormalizedFile.get(normalized)
    if (existing) {
      existing.push(selector)
      continue
    }
    selectorsByNormalizedFile.set(normalized, [selector])
  }

  const out = new Map<string, ScopedSelectorIndex>()

  for (const [solidFile, scopePaths] of cssScopeBySolidFile) {
    if (scopePaths.length === 0) continue

    const bySubjectTagMutable = new Map<string, SelectorDispatchBucketMutable>()
    const withoutSubjectTag = createSelectorDispatchBucketMutable()
    const seenSelectorIds = new Set<number>()
    let needsClassTokens = false
    let needsAttributes = false

    for (let i = 0; i < scopePaths.length; i++) {
      const scopePath = scopePaths[i]
      if (!scopePath) continue
      const selectorsInFile = selectorsByNormalizedFile.get(scopePath)
      if (!selectorsInFile) continue

      for (let j = 0; j < selectorsInFile.length; j++) {
        const selector = selectorsInFile[j]
        if (!selector) continue
        if (seenSelectorIds.has(selector.id)) continue
        seenSelectorIds.add(selector.id)

        const metadata = selectorMetadataById.get(selector.id)
        if (!metadata) continue

        if (metadata.guard.kind === "conditional") {
          if (!conditionalSelectorIds.has(selector.id)) {
            conditionalSelectorIds.add(selector.id)
            perf.selectorsGuardedConditional++
          }
        }

        const matcher = metadata.matcher
        if (matcher === null) continue

        if (matcher.requirements.needsClassTokens) needsClassTokens = true
        if (matcher.requirements.needsAttributes) needsAttributes = true

        const candidate: LayoutSelectorCandidate = {
          selector,
          matcher,
          subjectDispatchKeys: resolveSubjectDispatchKeys(matcher),
        }

        if (matcher.subjectTag === null) {
          appendSelectorCandidate(withoutSubjectTag, candidate)
          continue
        }

        let existing = bySubjectTagMutable.get(matcher.subjectTag)
        if (!existing) {
          existing = createSelectorDispatchBucketMutable()
          bySubjectTagMutable.set(matcher.subjectTag, existing)
        }
        appendSelectorCandidate(existing, candidate)
      }
    }

    const bySubjectTag = new Map<string, SelectorDispatchBucket>()
    for (const [tag, selectors] of bySubjectTagMutable) {
      bySubjectTag.set(tag, finalizeSelectorDispatchBucket(selectors))
    }

    out.set(solidFile, {
      bySubjectTag,
      withoutSubjectTag: finalizeSelectorDispatchBucket(withoutSubjectTag),
      requirements: {
        needsClassTokens,
        needsAttributes,
      },
    })
  }

  return out
}

export function buildSelectorCandidatesByNode(
  elements: readonly LayoutElementNode[],
  scopedSelectorsBySolidFile: ReadonlyMap<string, ScopedSelectorIndex>,
  perf: LayoutPerfStatsMutable,
): ReadonlyMap<LayoutElementNode, readonly number[]> {
  const out = new Map<LayoutElementNode, readonly number[]>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue

    const scoped = scopedSelectorsBySolidFile.get(node.solidFile)
    if (!scoped) continue

    const byTag = node.tagName !== null
      ? collectSelectorCandidates(scoped.bySubjectTag.get(node.tagName), node.selectorDispatchKeys)
      : EMPTY_SELECTOR_LIST
    const withoutTag = collectSelectorCandidates(scoped.withoutSubjectTag, node.selectorDispatchKeys)
    const merged = mergeSelectorCandidateIds(byTag, withoutTag)

    out.set(node, merged)
    perf.elementsScanned++
    perf.selectorCandidatesChecked += merged.length
  }

  return out
}

export function buildSelectorDispatchKeys(
  attributes: ReadonlyMap<string, string | null>,
  classTokens: readonly string[],
): readonly string[] {
  const out: string[] = []

  const idValue = attributes.get("id")
  if (idValue !== null && idValue !== undefined) {
    out.push(`id:${idValue}`)
  }

  for (let i = 0; i < classTokens.length; i++) {
    out.push(`class:${classTokens[i]}`)
  }

  for (const attributeName of attributes.keys()) {
    out.push(`attr:${attributeName}`)
  }

  if (out.length <= 1) return out
  out.sort()
  return dedupeSorted(out)
}

function mergeSelectorCandidateIds(
  byTag: readonly LayoutSelectorCandidate[],
  withoutTag: readonly LayoutSelectorCandidate[],
): readonly number[] {
  if (byTag.length === 0 && withoutTag.length === 0) return EMPTY_NUMBER_LIST
  if (byTag.length === 0) return mapCandidatesToIds(withoutTag)
  if (withoutTag.length === 0) return mapCandidatesToIds(byTag)

  const out: number[] = []
  let byTagIndex = 0
  let withoutTagIndex = 0

  while (byTagIndex < byTag.length && withoutTagIndex < withoutTag.length) {
    const byTagItem = byTag[byTagIndex]
    const withoutTagItem = withoutTag[withoutTagIndex]
    if (!byTagItem || !withoutTagItem) break
    const byTagId = byTagItem.selector.id
    const withoutTagId = withoutTagItem.selector.id

    if (byTagId < withoutTagId) {
      out.push(byTagId)
      byTagIndex++
      continue
    }

    if (byTagId > withoutTagId) {
      out.push(withoutTagId)
      withoutTagIndex++
      continue
    }

    out.push(byTagId)
    byTagIndex++
    withoutTagIndex++
  }

  while (byTagIndex < byTag.length) {
    const item = byTag[byTagIndex]
    if (!item) break
    out.push(item.selector.id)
    byTagIndex++
  }

  while (withoutTagIndex < withoutTag.length) {
    const item = withoutTag[withoutTagIndex]
    if (!item) break
    out.push(item.selector.id)
    withoutTagIndex++
  }

  return out
}

function mapCandidatesToIds(candidates: readonly LayoutSelectorCandidate[]): readonly number[] {
  const out: number[] = []
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue
    out.push(candidate.selector.id)
  }
  return out
}

function collectSelectorCandidates(
  bucket: SelectorDispatchBucket | undefined,
  selectorDispatchKeys: readonly string[],
): readonly LayoutSelectorCandidate[] {
  const active = bucket ?? EMPTY_SELECTOR_BUCKET
  if (active.constrained.length === 0) return active.unconstrained
  if (selectorDispatchKeys.length === 0) return active.unconstrained

  const matched = collectMatchedConstrainedViaIndex(active.bySubjectKey, selectorDispatchKeys)
  if (matched.length === 0) return active.unconstrained

  matched.sort(compareSelectorCandidate)
  return mergeSortedCandidates(active.unconstrained, matched)
}

function collectMatchedConstrainedViaIndex(
  bySubjectKey: ReadonlyMap<string, readonly LayoutSelectorCandidate[]>,
  selectorDispatchKeys: readonly string[],
): LayoutSelectorCandidate[] {
  const seenIds = new Set<number>()
  const out: LayoutSelectorCandidate[] = []

  for (let i = 0; i < selectorDispatchKeys.length; i++) {
    const dispatchKey = selectorDispatchKeys[i]
    if (!dispatchKey) continue
    const candidates = bySubjectKey.get(dispatchKey)
    if (!candidates) continue
    for (let j = 0; j < candidates.length; j++) {
      const candidate = candidates[j]
      if (!candidate) continue
      if (seenIds.has(candidate.selector.id)) continue
      if (!selectorMatchesDispatchKeys(candidate, selectorDispatchKeys)) continue
      seenIds.add(candidate.selector.id)
      out.push(candidate)
    }
  }

  return out
}

function mergeSortedCandidates(
  unconstrained: readonly LayoutSelectorCandidate[],
  constrained: readonly LayoutSelectorCandidate[],
): readonly LayoutSelectorCandidate[] {
  const out: LayoutSelectorCandidate[] = []
  let unconstrainedIndex = 0
  let constrainedIndex = 0

  while (unconstrainedIndex < unconstrained.length && constrainedIndex < constrained.length) {
    const unconstrainedItem = unconstrained[unconstrainedIndex]
    const constrainedItem = constrained[constrainedIndex]
    if (!unconstrainedItem || !constrainedItem) break
    const unconstrainedId = unconstrainedItem.selector.id
    const constrainedId = constrainedItem.selector.id

    if (unconstrainedId < constrainedId) {
      out.push(unconstrainedItem)
      unconstrainedIndex++
      continue
    }

    if (unconstrainedId > constrainedId) {
      out.push(constrainedItem)
      constrainedIndex++
      continue
    }

    out.push(unconstrainedItem)
    unconstrainedIndex++
    constrainedIndex++
  }

  while (unconstrainedIndex < unconstrained.length) {
    const item = unconstrained[unconstrainedIndex]
    if (!item) break
    out.push(item)
    unconstrainedIndex++
  }

  while (constrainedIndex < constrained.length) {
    const item = constrained[constrainedIndex]
    if (!item) break
    out.push(item)
    constrainedIndex++
  }

  return out
}

function selectorMatchesDispatchKeys(
  candidate: LayoutSelectorCandidate,
  dispatchKeys: readonly string[],
): boolean {
  if (candidate.subjectDispatchKeys.length === 0) return true
  if (dispatchKeys.length === 0) return false

  let subjectIndex = 0
  let dispatchIndex = 0

  while (subjectIndex < candidate.subjectDispatchKeys.length && dispatchIndex < dispatchKeys.length) {
    const subjectKey = candidate.subjectDispatchKeys[subjectIndex]
    const dispatchKey = dispatchKeys[dispatchIndex]
    if (subjectKey === undefined || dispatchKey === undefined) break

    if (subjectKey === dispatchKey) {
      subjectIndex++
      dispatchIndex++
      continue
    }

    if (dispatchKey < subjectKey) {
      dispatchIndex++
      continue
    }

    return false
  }

  return subjectIndex === candidate.subjectDispatchKeys.length
}

function resolveSubjectDispatchKeys(matcher: CompiledSelectorMatcher): readonly string[] {
  const out: string[] = []

  if (matcher.subject.idValue !== null) {
    out.push(`id:${matcher.subject.idValue}`)
  }

  for (let i = 0; i < matcher.subject.classes.length; i++) {
    out.push(`class:${matcher.subject.classes[i]}`)
  }

  for (let i = 0; i < matcher.subject.attributeNames.length; i++) {
    out.push(`attr:${matcher.subject.attributeNames[i]}`)
  }

  if (out.length <= 1) return out

  out.sort()
  return dedupeSorted(out)
}

function dedupeSorted(values: readonly string[]): readonly string[] {
  if (values.length <= 1) return values

  const first = values[0]
  if (first === undefined) return values
  const out: string[] = [first]
  for (let i = 1; i < values.length; i++) {
    const value = values[i]
    if (value === undefined || value === out[out.length - 1]) continue
    out.push(value)
  }

  return out
}

interface SelectorDispatchBucketMutable {
  readonly unconstrained: LayoutSelectorCandidate[]
  readonly bySubjectKey: Map<string, LayoutSelectorCandidate[]>
}

function createSelectorDispatchBucketMutable(): SelectorDispatchBucketMutable {
  return {
    unconstrained: [],
    bySubjectKey: new Map(),
  }
}

function appendSelectorCandidate(bucket: SelectorDispatchBucketMutable, candidate: LayoutSelectorCandidate): void {
  if (candidate.subjectDispatchKeys.length === 0) {
    bucket.unconstrained.push(candidate)
    return
  }

  for (let i = 0; i < candidate.subjectDispatchKeys.length; i++) {
    const key = candidate.subjectDispatchKeys[i]
    if (!key) continue
    const byKey = bucket.bySubjectKey.get(key)
    if (byKey) {
      byKey.push(candidate)
      continue
    }
    bucket.bySubjectKey.set(key, [candidate])
  }
}

function finalizeSelectorDispatchBucket(bucket: SelectorDispatchBucketMutable): SelectorDispatchBucket {
  bucket.unconstrained.sort(compareSelectorCandidate)

  const bySubjectKey = new Map<string, readonly LayoutSelectorCandidate[]>()
  const constrained: LayoutSelectorCandidate[] = []
  const seenSelectorIds = new Set<number>()
  for (const [key, candidates] of bucket.bySubjectKey) {
    candidates.sort(compareSelectorCandidate)
    bySubjectKey.set(key, candidates)

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (!candidate) continue
      if (seenSelectorIds.has(candidate.selector.id)) continue
      seenSelectorIds.add(candidate.selector.id)
      constrained.push(candidate)
    }
  }

  constrained.sort(compareSelectorCandidate)

  return {
    unconstrained: bucket.unconstrained,
    constrained,
    bySubjectKey,
  }
}

function compareSelectorCandidate(left: LayoutSelectorCandidate, right: LayoutSelectorCandidate): number {
  return left.selector.id - right.selector.id
}

function normalizeWithCache(cache: Map<string, string>, path: string): string {
  const existing = cache.get(path)
  if (existing !== undefined) return existing
  const normalized = canonicalPath(path)
  cache.set(path, normalized)
  return normalized
}
