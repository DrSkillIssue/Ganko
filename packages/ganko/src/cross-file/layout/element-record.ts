import ts from "typescript"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import { getStaticClassTokensForElementEntity, getStaticStyleKeysForElement, objectKeyName } from "../../solid/queries/jsx-derived"
import { getStaticNumericValue, getStaticStringValue } from "../../solid/util/static-value"
import { containsJSX } from "../../solid/util/function"
import { noopLogger, isBlank, Level } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import { toKebabCase } from "@drskillissue/ganko-shared"
import { LayoutTextualContentState } from "./signal-model"
import { isControlTag, isMonitoredSignal } from "./signal-normalization"
import { toLayoutElementKey, type LayoutElementRef } from "./graph"
import { collectStaticAttributes, createLayoutComponentHostResolver, type ResolvedComponentHost, type LayoutComponentHostDescriptor } from "./component-host"
import type { SelectorFeatureRequirements } from "./selector-match"
import { buildSelectorDispatchKeys } from "./selector-dispatch"

export interface LayoutElementCompositionMeta {
  readonly element: JSXElementEntity
  readonly participates: boolean
  readonly tag: string | null
  readonly tagName: string | null
  readonly resolvedHost: ResolvedComponentHost | null
}

export interface LayoutElementRecord {
  readonly element: JSXElementEntity
  readonly key: string
  readonly tag: string | null
  readonly tagName: string | null
  readonly classTokens: readonly string[]
  readonly classTokenSet: ReadonlySet<string>
  readonly inlineStyleKeys: readonly string[]
  readonly attributes: ReadonlyMap<string, string | null>
  readonly selectorDispatchKeys: readonly string[]
  readonly inlineStyleValues: ReadonlyMap<string, string>
  readonly textualContent: LayoutTextualContentState
  readonly parentElementId: number | null
  /**
   * Reference to the actual host DOM element when this record represents a
   * component call site resolved to a concrete DOM element. Null for native
   * DOM elements (the element itself is the host) and unresolvable components.
   * Used by rules that need to inspect host JSX attributes (e.g. dynamic
   * `width`/`height` expressions) that are not captured in `attributes`.
   */
  readonly hostElementRef: LayoutElementRef | null
}

export interface SiblingTotals {
  readonly siblingCountByParentId: ReadonlyMap<number, number>
  readonly siblingTypeCountByParentId: ReadonlyMap<number, ReadonlyMap<string, number>>
}

export type TextualContentState = LayoutTextualContentState

const EMPTY_INLINE_STYLE_VALUES: ReadonlyMap<string, string> = new Map()
const EMPTY_ATTRIBUTES: ReadonlyMap<string, string | null> = new Map()
const EMPTY_CLASS_TOKEN_SET: ReadonlySet<string> = new Set()
const EMPTY_STRING_LIST: readonly string[] = []

export function collectInlineStyleValuesByElementId(graph: SolidGraph): ReadonlyMap<number, ReadonlyMap<string, string>> {
  const out = new Map<number, Map<string, string>>()

  for (let i = 0; i < graph.styleProperties.length; i++) {
    const entry = graph.styleProperties[i]
    if (!entry) continue
    const property = entry.property
    if (!ts.isPropertyAssignment(property)) continue

    const keyName = objectKeyName(property.name)
    if (!keyName) continue

    const normalizedKey = normalizeStyleKey(keyName)
    if (!isMonitoredSignal(normalizedKey)) continue
    const value = getStaticStyleValue(property.initializer)
    if (value === null) continue

    const existing = out.get(entry.element.id)
    if (existing) {
      existing.set(normalizedKey, value)
      continue
    }

    const next = new Map<string, string>()
    next.set(normalizedKey, value)
    out.set(entry.element.id, next)
  }

  return out
}

function normalizeStyleKey(key: string): string {
  if (key.includes("-")) return key.toLowerCase()
  return toKebabCase(key)
}

function getStaticStyleValue(node: ts.Node): string | null {
  const staticString = getStaticStringValue(node)
  if (staticString !== null) return staticString
  const staticNumber = getStaticNumericValue(node)
  if (staticNumber === null) return null
  return String(staticNumber)
}

export function getTextualContentState(
  element: JSXElementEntity,
  memo: Map<number, TextualContentState>,
  compositionMetaByElementId: ReadonlyMap<number, LayoutElementCompositionMeta>,
  logger: Logger = noopLogger,
): TextualContentState {
  const existing = memo.get(element.id)
  if (existing !== undefined) return existing

  let hasTextOnlyExpression = false

  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]
    if (!child) continue
    if (child.kind === "expression") {
      if (isStructuralExpression(child.node)) {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id} → unknown (structural expression child)`)
        memo.set(element.id, LayoutTextualContentState.Unknown)
        return LayoutTextualContentState.Unknown
      }
      hasTextOnlyExpression = true
      continue
    }
    if (child.kind !== "text") continue
    if (!ts.isJsxText(child.node)) continue
    if (isBlank(child.node.text)) continue
    memo.set(element.id, LayoutTextualContentState.Yes)
    return LayoutTextualContentState.Yes
  }

  let childHasUnknown = false
  let childHasDynamicText = false

  for (let i = 0; i < element.childElements.length; i++) {
    const child = element.childElements[i]
    if (!child) continue
    const childState = getTextualContentState(child, memo, compositionMetaByElementId, logger)

    if (!child.isDomElement) {
      const childMeta = compositionMetaByElementId.get(child.id)
      if (childMeta !== undefined && isControlTag(childMeta.tagName)) {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id}: non-DOM child ${child.tag}#${child.id} resolves to control tag=${childMeta.tagName}, skipping`)
        continue
      }

      if (childState !== LayoutTextualContentState.No) {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id}: non-DOM child ${child.tag ?? child.id}#${child.id} has state=${childState} → childHasUnknown`)
        childHasUnknown = true
      }
      continue
    }

    if (childState === LayoutTextualContentState.Yes) {
      memo.set(element.id, LayoutTextualContentState.Yes)
      return LayoutTextualContentState.Yes
    }
    if (childState === LayoutTextualContentState.Unknown) childHasUnknown = true
    if (childState === LayoutTextualContentState.DynamicText) childHasDynamicText = true
  }

  if (childHasUnknown) {
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id} → unknown (child has unknown)`)
    memo.set(element.id, LayoutTextualContentState.Unknown)
    return LayoutTextualContentState.Unknown
  }

  if (hasTextOnlyExpression || childHasDynamicText) {
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id} → dynamic-text`)
    memo.set(element.id, LayoutTextualContentState.DynamicText)
    return LayoutTextualContentState.DynamicText
  }

  memo.set(element.id, LayoutTextualContentState.No)
  return LayoutTextualContentState.No
}

function isStructuralExpression(node: ts.Node): boolean {
  if (!ts.isJsxExpression(node)) return false
  const expr = node.expression
  if (!expr) return false
  return containsJSX(expr)
}

export function collectLayoutElementRecordsForSolid(
  solid: SolidGraph,
  selectorRequirements: SelectorFeatureRequirements,
  inlineStyleValuesByElementId: ReadonlyMap<number, ReadonlyMap<string, string>>,
  textContentMemo: Map<number, TextualContentState>,
  componentHostResolver: ReturnType<typeof createLayoutComponentHostResolver>,
  logger: Logger = noopLogger,
): readonly LayoutElementRecord[] {
  const compositionMetaByElementId = collectCompositionMetaByElementId(solid, componentHostResolver)
  const out: LayoutElementRecord[] = []

  for (let i = 0; i < solid.jsxElements.length; i++) {
    const element = solid.jsxElements[i]
    if (!element) continue
    const meta = compositionMetaByElementId.get(element.id)
    if (!meta || !meta.participates) continue

    const localClassTokens = selectorRequirements.needsClassTokens
      ? getStaticClassTokensForElementEntity(solid, element)
      : EMPTY_STRING_LIST
    const classTokens = mergeClassTokens(localClassTokens, meta.resolvedHost?.descriptor.staticClassTokens)
    const classTokenSet = classTokens.length === 0 ? EMPTY_CLASS_TOKEN_SET : createClassTokenSet(classTokens)
    const inlineStyleKeys = getStaticStyleKeysForElement(solid, element.id)
    const localAttributes = selectorRequirements.needsAttributes
      ? collectStaticAttributes(element)
      : EMPTY_ATTRIBUTES
    const attributes = mergeAttributes(localAttributes, meta.resolvedHost?.descriptor.staticAttributes)
    const selectorDispatchKeys = buildSelectorDispatchKeys(attributes, classTokens)
    const inlineStyleValues = inlineStyleValuesByElementId.get(element.id) ?? EMPTY_INLINE_STYLE_VALUES
    const textualContent = getTextualContentState(element, textContentMemo, compositionMetaByElementId, logger)
    const parentElementId = resolveComposedParentElementId(element, compositionMetaByElementId)

    const hostElementRef: LayoutElementRef | null = meta.resolvedHost?.hostElementRef ?? null

    out.push({
      element,
      key: toLayoutElementKey(solid.file, element.id),
      tag: meta.tag,
      tagName: meta.tagName,
      classTokens,
      classTokenSet,
      inlineStyleKeys,
      attributes,
      selectorDispatchKeys,
      inlineStyleValues,
      textualContent,
      parentElementId,
      hostElementRef,
    })
  }

  return out
}

function collectCompositionMetaByElementId(
  solid: SolidGraph,
  componentHostResolver: ReturnType<typeof createLayoutComponentHostResolver>,
): ReadonlyMap<number, LayoutElementCompositionMeta> {
  const out = new Map<number, LayoutElementCompositionMeta>()

  for (let i = 0; i < solid.jsxElements.length; i++) {
    const element = solid.jsxElements[i]
    if (!element) continue

    const resolvedHost = resolveHostForElement(
      componentHostResolver,
      solid.file,
      element,
    )
    const isTransparentPrimitive = resolveTransparentPrimitiveStatus(
      componentHostResolver,
      solid.file,
      element,
      resolvedHost,
    )
    const participates = element.tag !== null && !isTransparentPrimitive
    const tag = resolveEffectiveTag(element, resolvedHost?.descriptor ?? null)
    const tagName = tag ? tag.toLowerCase() : null

    out.set(element.id, {
      element,
      participates,
      tag,
      tagName,
      resolvedHost,
    })
  }

  return out
}

function resolveHostForElement(
  componentHostResolver: ReturnType<typeof createLayoutComponentHostResolver>,
  solidFile: string,
  element: JSXElementEntity,
): ResolvedComponentHost | null {
  if (element.tag === null) return null
  if (element.isDomElement) return null
  return componentHostResolver.resolveHost(solidFile, element.tag)
}

function resolveTransparentPrimitiveStatus(
  componentHostResolver: ReturnType<typeof createLayoutComponentHostResolver>,
  solidFile: string,
  element: JSXElementEntity,
  resolvedHost: ResolvedComponentHost | null,
): boolean {
  if (element.tag === null) return false
  if (element.isDomElement) return false
  if (resolvedHost !== null) return false
  return componentHostResolver.isTransparentPrimitive(solidFile, element.tag)
}

function resolveEffectiveTag(
  element: JSXElementEntity,
  hostDescriptor: LayoutComponentHostDescriptor | null,
): string | null {
  if (hostDescriptor !== null) return hostDescriptor.tagName
  /* DOM elements use their tag directly (div, span, etc.).
     Non-DOM elements (components) with no host descriptor have no
     resolved DOM tag — returning the raw JSX tag (e.g. "DropdownMenu.Portal")
     would create a fake tagName that bypasses tagName === null guards. */
  if (!element.isDomElement) return null
  return element.tag
}

function resolveComposedParentElementId(
  element: JSXElementEntity,
  compositionMetaByElementId: ReadonlyMap<number, LayoutElementCompositionMeta>,
): number | null {
  let parent = element.parent

  while (parent !== null) {
    const meta = compositionMetaByElementId.get(parent.id)
    if (meta && meta.participates) return parent.id
    parent = parent.parent
  }

  return null
}

function mergeClassTokens(
  localTokens: readonly string[],
  hostTokens: readonly string[] | undefined,
): readonly string[] {
  if (hostTokens === undefined || hostTokens.length === 0) return localTokens
  if (localTokens.length === 0) return hostTokens

  const out: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < hostTokens.length; i++) {
    const token = hostTokens[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  for (let i = 0; i < localTokens.length; i++) {
    const token = localTokens[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  return out
}

function mergeAttributes(
  localAttributes: ReadonlyMap<string, string | null>,
  hostAttributes: ReadonlyMap<string, string | null> | undefined,
): ReadonlyMap<string, string | null> {
  if (hostAttributes === undefined || hostAttributes.size === 0) return localAttributes
  if (localAttributes.size === 0) return hostAttributes

  const out = new Map<string, string | null>()

  for (const [name, value] of hostAttributes) {
    out.set(name, value)
  }

  for (const [name, value] of localAttributes) {
    out.set(name, value)
  }

  return out
}

export function collectSiblingTotals(records: readonly LayoutElementRecord[]): SiblingTotals {
  const siblingCountByParentId = new Map<number, number>()
  const siblingTypeCountByParentId = new Map<number, Map<string, number>>()

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const parentElementId = record.parentElementId
    if (parentElementId === null) continue

    const nextSiblingCount = (siblingCountByParentId.get(parentElementId) ?? 0) + 1
    siblingCountByParentId.set(parentElementId, nextSiblingCount)

    const tagName = record.tagName
    if (tagName === null) continue

    const existingByType = siblingTypeCountByParentId.get(parentElementId)
    if (existingByType) {
      const nextTypeCount = (existingByType.get(tagName) ?? 0) + 1
      existingByType.set(tagName, nextTypeCount)
      continue
    }

    const byType = new Map<string, number>()
    byType.set(tagName, 1)
    siblingTypeCountByParentId.set(parentElementId, byType)
  }

  return {
    siblingCountByParentId,
    siblingTypeCountByParentId,
  }
}

function createClassTokenSet(tokens: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    set.add(token)
  }
  return set
}

export function resolveSiblingTypeIndex(
  seenByParentId: Map<number, Map<string, number>>,
  parentElementId: number | null,
  tagName: string | null,
  siblingIndex: number,
): number {
  if (parentElementId === null || tagName === null) return siblingIndex

  const seen = seenByParentId.get(parentElementId)
  if (!seen) {
    const next = new Map<string, number>()
    next.set(tagName, 1)
    seenByParentId.set(parentElementId, next)
    return 1
  }

  const count = (seen.get(tagName) ?? 0) + 1
  seen.set(tagName, count)
  return count
}

export function resolveSiblingTypeCount(
  totalsByParentId: ReadonlyMap<number, ReadonlyMap<string, number>>,
  parentElementId: number | null,
  tagName: string | null,
  siblingCount: number,
): number {
  if (parentElementId === null || tagName === null) return siblingCount

  const totals = totalsByParentId.get(parentElementId)
  if (!totals) return 1
  return totals.get(tagName) ?? 1
}
