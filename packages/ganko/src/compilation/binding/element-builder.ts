/**
 * ElementNode type definition + element construction + component host resolution.
 *
 * Moved from cross-file/layout/element-record.ts + cross-file/layout/component-host.ts + build.ts wiring.
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import ts from "typescript"
import { ExportKind, type ExportEntity } from "../../solid/entities/export"
import type { FunctionEntity } from "../../solid/entities/function"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import type { VariableEntity } from "../../solid/entities/variable"
import { buildSolidSyntaxTree } from "../../solid/impl"
import { createSolidInput } from "../../solid/create-input"
import type { SolidSyntaxTree } from "../core/solid-syntax-tree"
import { getStaticStringFromJSXValue, getStaticNumericValue, getStaticStringValue } from "../../solid/util/static-value"
import { getPropertyKeyName } from "../../solid/util/pattern-detection"
import { containsJSX } from "../../solid/util/function"
import { noopLogger, isBlank, Level } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import { toKebabCase } from "@drskillissue/ganko-shared"
import { TextualContentState, isControlTag, isReplacedTag, isMonitoredSignal } from "./signal-builder"
import type { StyleCompilation } from "../core/compilation"
import { resolveImportPath, buildPackageIndex } from "../incremental/dependency-graph"
import { CSS_EXTENSIONS, SOLID_EXTENSIONS } from "@drskillissue/ganko-shared"


// ── ElementNode ──────────────────────────────────────────────────────────

export interface ElementNode {
  readonly key: string
  readonly solidFile: string
  readonly elementId: number
  readonly jsxEntity: JSXElementEntity
  readonly tag: string | null
  readonly tagName: string | null
  readonly classTokens: readonly string[]
  readonly classTokenSet: ReadonlySet<string>
  readonly inlineStyleKeys: readonly string[]
  readonly parentElementNode: ElementNode | null
  readonly childElementNodes: readonly ElementNode[]
  readonly previousSiblingNode: ElementNode | null
  readonly siblingIndex: number
  readonly siblingCount: number
  readonly siblingTypeIndex: number
  readonly siblingTypeCount: number
  readonly selectorDispatchKeys: readonly string[]
  readonly attributes: ReadonlyMap<string, string | null>
  readonly inlineStyleValues: ReadonlyMap<string, string>
  readonly textualContent: TextualContentState
  readonly isControl: boolean
  readonly isReplaced: boolean
}


// ── Component host types ────────────────────────────────────────────────

export interface LayoutComponentHostDescriptor {
  readonly tagName: string | null
  readonly staticAttributes: ReadonlyMap<string, string | null>
  readonly staticClassTokens: readonly string[]
  readonly forwardsChildren: boolean
  readonly attributePropBindings: ReadonlyMap<string, string>
}

export interface HostElementRef {
  readonly filePath: string
  readonly element: JSXElementEntity
}

export interface ResolvedComponentHost {
  readonly descriptor: LayoutComponentHostDescriptor
  readonly hostElementRef: HostElementRef | null
}

export interface ComponentHostResolver {
  resolveHost(importerFile: string, tag: string): ResolvedComponentHost | null
  isTransparentPrimitive(importerFile: string, tag: string): boolean
}


// ── Internal types ───────────────────────────────────────────────────────

interface MutableElementNode {
  key: string
  solidFile: string
  elementId: number
  jsxEntity: JSXElementEntity
  tag: string | null
  tagName: string | null
  classTokens: readonly string[]
  classTokenSet: ReadonlySet<string>
  inlineStyleKeys: readonly string[]
  parentElementNode: ElementNode | null
  childElementNodes: ElementNode[]
  previousSiblingNode: ElementNode | null
  siblingIndex: number
  siblingCount: number
  siblingTypeIndex: number
  siblingTypeCount: number
  selectorDispatchKeys: readonly string[]
  attributes: ReadonlyMap<string, string | null>
  inlineStyleValues: ReadonlyMap<string, string>
  textualContent: TextualContentState
  isControl: boolean
  isReplaced: boolean
}

interface CompositionMeta {
  readonly element: JSXElementEntity
  readonly participates: boolean
  readonly tag: string | null
  readonly tagName: string | null
  readonly resolvedHost: ResolvedComponentHost | null
}

interface ComponentBinding {
  readonly kind: "component"
  readonly host: ResolvedComponentHost
}

interface NamespaceBinding {
  readonly kind: "namespace"
  readonly base: ComponentBinding | null
  readonly members: ReadonlyMap<string, LayoutBinding>
}

type LayoutBinding = ComponentBinding | NamespaceBinding

interface ImportBinding {
  readonly source: string
  readonly kind: "named" | "default" | "namespace"
  readonly importedName: string | null
}

interface ResolvedComponentHostEntry {
  readonly resolution: "resolved"
  readonly descriptor: LayoutComponentHostDescriptor
  readonly hostElementRef: HostElementRef | null
}

interface DeferredComponentHostEntry {
  readonly resolution: "deferred"
  readonly innerTag: string
  readonly filePath: string
  readonly staticAttributes: ReadonlyMap<string, string | null>
  readonly staticClassTokens: readonly string[]
  readonly forwardsChildren: boolean
  readonly attributePropBindings: ReadonlyMap<string, string>
}

type ComponentHostEntry = ResolvedComponentHostEntry | DeferredComponentHostEntry

interface SolidModuleIndex {
  readonly tree: SolidSyntaxTree
  readonly hostByComponentName: ReadonlyMap<string, ComponentHostEntry>
  readonly variableInitByName: ReadonlyMap<string, ts.Expression>
  readonly importByLocalName: ReadonlyMap<string, ImportBinding>
  readonly exportsByName: ReadonlyMap<string, readonly ExportEntity[]>
  readonly transparentPrimitiveNames: ReadonlySet<string>
}


// ── Constants ────────────────────────────────────────────────────────────

const EMPTY_INLINE_STYLE_VALUES: ReadonlyMap<string, string> = new Map()
const EMPTY_ATTRIBUTES: ReadonlyMap<string, string | null> = new Map()
const EMPTY_PROP_BINDINGS: ReadonlyMap<string, string> = new Map()
const EMPTY_CLASS_TOKEN_SET: ReadonlySet<string> = new Set()
const EMPTY_STRING_LIST: readonly string[] = []
const MAX_EXTERNAL_FILES_PARSED = 100
const MAX_CHILDREN_REFERENCE_QUEUE_SIZE = 512

const TRANSPARENT_SOLID_PRIMITIVES = new Set([
  "For",
  "Index",
  "Show",
  "Switch",
  "Match",
  "ErrorBoundary",
  "Suspense",
  "SuspenseList",
])

const HTML_TAG_NAMES: ReadonlySet<string> = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins",
  "kbd",
  "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "picture", "pre", "progress",
  "q",
  "rp", "rt", "ruby",
  "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track",
  "u", "ul",
  "var", "video",
  "wbr",
])


// ── Local JSX query helpers (work with SolidSyntaxTree directly) ─────────

function getStaticClassTokensForTree(tree: SolidSyntaxTree, elementId: number): readonly string[] {
  const idx = tree.staticClassTokensByElementId.get(elementId)
  if (!idx || idx.hasDynamicClass) return EMPTY_STRING_LIST
  return idx.tokens
}

function getStaticClassListKeysForTree(tree: SolidSyntaxTree, elementId: number): readonly string[] {
  const idx = tree.staticClassListKeysByElementId.get(elementId)
  if (!idx) return EMPTY_STRING_LIST
  return idx.keys
}

function getStaticClassTokensForTreeElement(tree: SolidSyntaxTree, element: JSXElementEntity): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const classTokens = getStaticClassTokensForTree(tree, element.id)
  for (let i = 0; i < classTokens.length; i++) {
    const token = classTokens[i]
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  const classListTokens = getStaticClassListKeysForTree(tree, element.id)
  for (let i = 0; i < classListTokens.length; i++) {
    const token = classListTokens[i]
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  return out
}

function getStaticStyleKeysForTree(tree: SolidSyntaxTree, elementId: number): readonly string[] {
  const idx = tree.staticStyleKeysByElementId.get(elementId)
  if (!idx || idx.hasDynamic) return EMPTY_STRING_LIST
  return idx.keys
}


// ── buildElementNodes ────────────────────────────────────────────────────

export function buildElementNodes(
  solidTree: SolidSyntaxTree,
  compilation: StyleCompilation,
): ElementNode[] {
  const moduleResolver = createModuleResolverFromCompilation(compilation)
  const componentHostResolver = createComponentHostResolver(compilation.solidTrees, moduleResolver)
  const selectorRequirements = { needsClassTokens: true, needsAttributes: true }

  const inlineStyleValuesByElementId = collectInlineStyleValuesByElementId(solidTree)
  const compositionMetaByElementId = collectCompositionMetaByElementId(solidTree, componentHostResolver)
  const textContentMemo = new Map<number, TextualContentState>()

  interface FlatRecord {
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
    readonly textualContent: TextualContentState
    readonly parentElementId: number | null
  }

  const records: FlatRecord[] = []
  const jsxElements = solidTree.jsxElements

  for (let i = 0; i < jsxElements.length; i++) {
    const element = jsxElements[i]
    if (!element) continue
    const meta = compositionMetaByElementId.get(element.id)
    if (!meta || !meta.participates) continue

    const localClassTokens = selectorRequirements.needsClassTokens
      ? getStaticClassTokensForTreeElement(solidTree, element)
      : EMPTY_STRING_LIST
    const classTokens = mergeClassTokens(localClassTokens, meta.resolvedHost?.descriptor.staticClassTokens)
    const classTokenSet = classTokens.length === 0 ? EMPTY_CLASS_TOKEN_SET : createClassTokenSet(classTokens)
    const inlineStyleKeys = getStaticStyleKeysForTree(solidTree, element.id)
    const localAttributes = selectorRequirements.needsAttributes
      ? collectStaticAttributes(element)
      : EMPTY_ATTRIBUTES
    const attributes = mergeCallSiteAttributes(localAttributes, meta.resolvedHost?.descriptor.staticAttributes, meta.resolvedHost?.descriptor.attributePropBindings)
    const selectorDispatchKeys = buildSelectorDispatchKeys(attributes, classTokens)
    const inlineStyleValues = inlineStyleValuesByElementId.get(element.id) ?? EMPTY_INLINE_STYLE_VALUES
    const textualContent = getTextualContentState(element, textContentMemo, compositionMetaByElementId)
    const parentElementId = resolveComposedParentElementId(element, compositionMetaByElementId)

    records.push({
      element,
      key: `${solidTree.filePath}::${element.id}`,
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
    })
  }

  // Compute sibling totals
  const siblingCountByParentId = new Map<number, number>()
  const siblingTypeCountByParentId = new Map<number, Map<string, number>>()
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const parentElementId = record.parentElementId
    if (parentElementId === null) continue
    siblingCountByParentId.set(parentElementId, (siblingCountByParentId.get(parentElementId) ?? 0) + 1)
    if (record.tagName !== null) {
      let byType = siblingTypeCountByParentId.get(parentElementId)
      if (!byType) { byType = new Map(); siblingTypeCountByParentId.set(parentElementId, byType) }
      byType.set(record.tagName, (byType.get(record.tagName) ?? 0) + 1)
    }
  }

  // Wire into ElementNode tree
  const elements: MutableElementNode[] = []
  const nodeByElementId = new Map<number, MutableElementNode>()
  const lastChildByParentId = new Map<number, MutableElementNode>()
  const siblingTypeSeenByParentId = new Map<number, Map<string, number>>()

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue

    const parentElementId = record.parentElementId
    const parentNode = parentElementId === null ? null : (nodeByElementId.get(parentElementId) ?? null)
    const previousSiblingNode = parentElementId === null ? null : (lastChildByParentId.get(parentElementId) ?? null)
    const siblingIndex = previousSiblingNode ? previousSiblingNode.siblingIndex + 1 : 1
    const siblingCount = parentElementId === null ? 1 : (siblingCountByParentId.get(parentElementId) ?? 1)
    const siblingTypeIndex = resolveSiblingTypeIndex(siblingTypeSeenByParentId, parentElementId, record.tagName, siblingIndex)
    const siblingTypeCount = resolveSiblingTypeCount(siblingTypeCountByParentId, parentElementId, record.tagName, siblingCount)

    const node: MutableElementNode = {
      key: record.key,
      solidFile: solidTree.filePath,
      elementId: record.element.id,
      jsxEntity: record.element,
      tag: record.tag,
      tagName: record.tagName,
      classTokens: record.classTokens,
      classTokenSet: record.classTokenSet,
      inlineStyleKeys: record.inlineStyleKeys,
      parentElementNode: parentNode,
      childElementNodes: [],
      previousSiblingNode: previousSiblingNode,
      siblingIndex,
      siblingCount,
      siblingTypeIndex,
      siblingTypeCount,
      selectorDispatchKeys: record.selectorDispatchKeys,
      attributes: record.attributes,
      inlineStyleValues: record.inlineStyleValues,
      textualContent: record.textualContent,
      isControl: isControlTag(record.tagName),
      isReplaced: isReplacedTag(record.tagName),
    }

    elements.push(node)
    nodeByElementId.set(record.element.id, node)
    if (parentElementId !== null) lastChildByParentId.set(parentElementId, node)
    if (parentNode !== null) {
      (parentNode.childElementNodes as ElementNode[]).push(node)
    }
  }

  return elements
}


// ── Inline style collection ──────────────────────────────────────────────

function collectInlineStyleValuesByElementId(tree: SolidSyntaxTree): ReadonlyMap<number, ReadonlyMap<string, string>> {
  const out = new Map<number, Map<string, string>>()
  const styleProperties = tree.styleProperties

  for (let i = 0; i < styleProperties.length; i++) {
    const entry = styleProperties[i]
    if (!entry) continue
    const property = entry.property
    if (!ts.isPropertyAssignment(property)) continue

    const keyName = getPropertyKeyName(property.name)
    if (!keyName) continue

    const normalizedKey = normalizeStyleKey(keyName)
    if (!isMonitoredSignal(normalizedKey)) continue
    const value = getStaticStyleValue(property.initializer)
    if (value === null) continue

    const existing = out.get(entry.element.id)
    if (existing) { existing.set(normalizedKey, value); continue }
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


// ── Composition meta ─────────────────────────────────────────────────────

function collectCompositionMetaByElementId(
  tree: SolidSyntaxTree,
  componentHostResolver: ComponentHostResolver,
): ReadonlyMap<number, CompositionMeta> {
  const out = new Map<number, CompositionMeta>()

  for (let i = 0; i < tree.jsxElements.length; i++) {
    const element = tree.jsxElements[i]
    if (!element) continue

    const resolvedHost = resolveHostForElement(componentHostResolver, tree.filePath, element)
    const isTransparentPrimitive = resolveTransparentPrimitiveStatus(componentHostResolver, tree.filePath, element, resolvedHost)
    const participates = element.tag !== null && !isTransparentPrimitive
    const tag = resolveEffectiveTag(element, resolvedHost?.descriptor ?? null)
    const tagName = tag ? tag.toLowerCase() : null

    out.set(element.id, { element, participates, tag, tagName, resolvedHost })
  }

  return out
}

function resolveHostForElement(
  componentHostResolver: ComponentHostResolver,
  solidFile: string,
  element: JSXElementEntity,
): ResolvedComponentHost | null {
  if (element.tag === null) return null
  if (element.isDomElement) return null

  const defaultHost = componentHostResolver.resolveHost(solidFile, element.tag)

  const asTag = extractPolymorphicAsTag(element)
  if (asTag !== null) {
    const asHost = componentHostResolver.resolveHost(solidFile, asTag)
    if (asHost !== null) return composePolymorphicHost(defaultHost, asHost)
  }

  return defaultHost
}

function extractPolymorphicAsTag(element: JSXElementEntity): string | null {
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]
    if (!attr) continue
    if (attr.name !== "as") continue
    if (attr.valueNode === null) continue
    if (!ts.isJsxExpression(attr.valueNode)) continue
    const expression = attr.valueNode.expression
    if (!expression) continue
    if (ts.isIdentifier(expression)) return expression.text
    if (ts.isPropertyAccessExpression(expression)) return expression.getText()
    return null
  }
  return null
}

function composePolymorphicHost(
  outerHost: ResolvedComponentHost | null,
  asHost: ResolvedComponentHost,
): ResolvedComponentHost {
  if (outerHost === null) return asHost

  const outerDesc = outerHost.descriptor
  const asDesc = asHost.descriptor

  const staticAttributes = new Map<string, string | null>()
  for (const [name, value] of outerDesc.staticAttributes) staticAttributes.set(name, value)
  for (const [name, value] of asDesc.staticAttributes) staticAttributes.set(name, value)

  const classTokenSet = new Set<string>()
  const staticClassTokens: string[] = []
  for (const token of outerDesc.staticClassTokens) {
    if (!classTokenSet.has(token)) { classTokenSet.add(token); staticClassTokens.push(token) }
  }
  for (const token of asDesc.staticClassTokens) {
    if (!classTokenSet.has(token)) { classTokenSet.add(token); staticClassTokens.push(token) }
  }

  const attributePropBindings = new Map<string, string>()
  for (const [name, value] of outerDesc.attributePropBindings) attributePropBindings.set(name, value)
  for (const [name, value] of asDesc.attributePropBindings) attributePropBindings.set(name, value)

  return {
    descriptor: {
      tagName: asDesc.tagName ?? outerDesc.tagName,
      staticAttributes,
      staticClassTokens,
      forwardsChildren: asDesc.forwardsChildren || outerDesc.forwardsChildren,
      attributePropBindings,
    },
    hostElementRef: asHost.hostElementRef ?? outerHost.hostElementRef,
  }
}

function resolveTransparentPrimitiveStatus(
  componentHostResolver: ComponentHostResolver,
  solidFile: string,
  element: JSXElementEntity,
  resolvedHost: ResolvedComponentHost | null,
): boolean {
  if (element.tag === null) return false
  if (element.isDomElement) return false
  if (resolvedHost !== null) return false
  return componentHostResolver.isTransparentPrimitive(solidFile, element.tag)
}

function resolveEffectiveTag(element: JSXElementEntity, hostDescriptor: LayoutComponentHostDescriptor | null): string | null {
  if (hostDescriptor !== null) return hostDescriptor.tagName
  if (!element.isDomElement) return null
  return element.tag
}

function resolveComposedParentElementId(
  element: JSXElementEntity,
  compositionMetaByElementId: ReadonlyMap<number, CompositionMeta>,
): number | null {
  let parent = element.parent
  while (parent !== null) {
    const meta = compositionMetaByElementId.get(parent.id)
    if (meta && meta.participates) return parent.id
    parent = parent.parent
  }
  return null
}


// ── Textual content state ────────────────────────────────────────────────

function getTextualContentState(
  element: JSXElementEntity,
  memo: Map<number, TextualContentState>,
  compositionMetaByElementId: ReadonlyMap<number, CompositionMeta>,
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
        memo.set(element.id, TextualContentState.Unknown)
        return TextualContentState.Unknown
      }
      hasTextOnlyExpression = true
      continue
    }
    if (child.kind !== "text") continue
    if (!ts.isJsxText(child.node)) continue
    if (isBlank(child.node.text)) continue
    memo.set(element.id, TextualContentState.Yes)
    return TextualContentState.Yes
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

      if (childState !== TextualContentState.No) {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id}: non-DOM child ${child.tag ?? child.id}#${child.id} has state=${childState} → childHasUnknown`)
        childHasUnknown = true
      }
      continue
    }

    if (childState === TextualContentState.Yes) {
      memo.set(element.id, TextualContentState.Yes)
      return TextualContentState.Yes
    }
    if (childState === TextualContentState.Unknown) childHasUnknown = true
    if (childState === TextualContentState.DynamicText) childHasDynamicText = true
  }

  if (childHasUnknown) {
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id} → unknown (child has unknown)`)
    memo.set(element.id, TextualContentState.Unknown)
    return TextualContentState.Unknown
  }

  if (hasTextOnlyExpression || childHasDynamicText) {
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[textual-content] element=${element.tagName ?? element.tag}#${element.id} → dynamic-text`)
    memo.set(element.id, TextualContentState.DynamicText)
    return TextualContentState.DynamicText
  }

  memo.set(element.id, TextualContentState.No)
  return TextualContentState.No
}

function isStructuralExpression(node: ts.Node): boolean {
  if (!ts.isJsxExpression(node)) return false
  const expr = node.expression
  if (!expr) return false
  return containsJSX(expr)
}


// ── Element record helpers ───────────────────────────────────────────────

function mergeClassTokens(localTokens: readonly string[], hostTokens: readonly string[] | undefined): readonly string[] {
  if (hostTokens === undefined || hostTokens.length === 0) return localTokens
  if (localTokens.length === 0) return hostTokens
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < hostTokens.length; i++) {
    const token = hostTokens[i]
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  for (let i = 0; i < localTokens.length; i++) {
    const token = localTokens[i]
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

function mergeCallSiteAttributes(
  localAttributes: ReadonlyMap<string, string | null>,
  hostAttributes: ReadonlyMap<string, string | null> | undefined,
  propBindings: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string | null> {
  if (hostAttributes === undefined || hostAttributes.size === 0) return localAttributes
  if (localAttributes.size === 0 && (propBindings === undefined || propBindings.size === 0)) return hostAttributes

  const out = new Map<string, string | null>()
  for (const [name, value] of hostAttributes) {
    if (propBindings !== undefined) {
      const propName = propBindings.get(name)
      if (propName !== undefined) {
        const callSiteValue = localAttributes.get(propName)
        if (callSiteValue !== undefined && callSiteValue !== null) {
          out.set(name, callSiteValue)
          continue
        }
      }
    }
    out.set(name, value)
  }
  for (const [name, value] of localAttributes) {
    out.set(name, value)
  }
  return out
}

function createClassTokenSet(tokens: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token) set.add(token)
  }
  return set
}

function buildSelectorDispatchKeys(attributes: ReadonlyMap<string, string | null>, classTokens: readonly string[]): readonly string[] {
  const out: string[] = []
  const idValue = attributes.get("id")
  if (idValue !== null && idValue !== undefined) out.push(`id:${idValue}`)
  for (let i = 0; i < classTokens.length; i++) out.push(`class:${classTokens[i]}`)
  for (const attributeName of attributes.keys()) out.push(`attr:${attributeName}`)
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

function resolveSiblingTypeIndex(
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

function resolveSiblingTypeCount(
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


// ── Static attribute collection (exported) ───────────────────────────────

export function collectStaticAttributes(element: JSXElementEntity): ReadonlyMap<string, string | null> {
  let out: Map<string, string | null> | null = null

  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes[i]
    if (!attribute) continue
    if (!ts.isJsxAttribute(attribute.node)) continue
    if (!attribute.name) continue
    const name = attribute.name.toLowerCase()

    if (attribute.valueNode === null) {
      if (out === null) out = new Map<string, string | null>()
      out.set(name, null)
      continue
    }

    const value = getStaticStringFromJSXValue(attribute.valueNode)
    if (out === null) out = new Map<string, string | null>()
    out.set(name, value)
  }

  if (out === null) return EMPTY_ATTRIBUTES
  return out
}

function extractPropMemberName(node: ts.Node): string | null {
  if (!ts.isJsxExpression(node)) return null
  const expression = node.expression
  if (!expression) return null
  return extractMemberNameFromExpression(expression)
}

function extractMemberNameFromExpression(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.arguments.length === 0) {
    return expression.expression.name.text
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return extractMemberNameFromExpression(expression.left)
  }
  return null
}

export function collectAttributePropBindings(element: JSXElementEntity): ReadonlyMap<string, string> {
  let out: Map<string, string> | null = null

  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes[i]
    if (!attribute) continue
    if (!ts.isJsxAttribute(attribute.node)) continue
    if (!attribute.name) continue
    if (attribute.valueNode === null) continue

    const propName = extractPropMemberName(attribute.valueNode)
    if (propName === null) continue

    const attrName = attribute.name.toLowerCase()
    if (out === null) out = new Map<string, string>()
    out.set(attrName, propName)
  }

  if (out === null) return EMPTY_PROP_BINDINGS
  return out
}


// ── Module resolver interface ─────────────────────────────────────────────

interface ModuleResolver {
  resolveSolid(importerFile: string, source: string): string | null
  resolveCss(importerFile: string, source: string): string | null
}


// ── resolveExternalModule (moved from cross-file/layout/module-resolver.ts) ─

function resolveExternalModule(importerFile: string, importSource: string): string | null {
  if (importSource.length === 0) return null
  if (importSource.startsWith("http://") || importSource.startsWith("https://") || importSource.startsWith("data:")) return null
  if (importSource.startsWith(".") || importSource.startsWith("/")) {
    const basePath = importSource.startsWith("/") ? resolve(importSource) : resolve(dirname(resolve(importerFile)), importSource)
    return resolveExternalFromBasePath(basePath)
  }
  return resolveExternalPackage(importerFile, importSource)
}

function resolveExternalFromBasePath(basePath: string): string | null {
  const normalizedBase = resolve(basePath)
  const candidates = [normalizedBase]
  for (let i = 0; i < SOLID_EXTENSIONS.length; i++) candidates.push(normalizedBase + SOLID_EXTENSIONS[i])
  for (let i = 0; i < SOLID_EXTENSIONS.length; i++) candidates.push(join(normalizedBase, `index${SOLID_EXTENSIONS[i]}`))
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveExternalPackage(importerFile: string, source: string): string | null {
  const { packageName, subpath } = parseExternalPackageSpecifier(source)
  if (packageName === null) return null
  const packageDir = findNodeModulesPackage(importerFile, packageName)
  if (packageDir === null) return null
  const packageJsonPath = join(packageDir, "package.json")
  let entry: { name: string; exportsValue: ExternalPackageExportNode | null } | null = null
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"))
    if (typeof raw === "object" && raw !== null && typeof raw.name === "string") {
      entry = { name: raw.name, exportsValue: parseExternalExportNode(raw.exports) }
    }
  } catch { /* ignore */ }
  if (entry === null) return null

  const exportSubpath = subpath === null ? "." : `./${subpath}`
  const EXTERNAL_CONDITIONS = ["solid", "import", "default"]
  const exported = resolveExternalExportTarget(entry.exportsValue, exportSubpath, EXTERNAL_CONDITIONS)
  if (exported !== null) {
    const resolved = resolveExternalFromBasePath(resolve(packageDir, exported))
    if (resolved !== null) return resolved
  }
  if (subpath !== null) {
    const direct = resolveExternalFromBasePath(resolve(packageDir, subpath))
    if (direct !== null) return direct
    const fromSrc = resolveExternalFromBasePath(resolve(packageDir, "src", subpath))
    if (fromSrc !== null) return fromSrc
  } else {
    const fromRoot = resolveExternalFromBasePath(resolve(packageDir, "index"))
    if (fromRoot !== null) return fromRoot
    const fromSrc = resolveExternalFromBasePath(resolve(packageDir, "src/index"))
    if (fromSrc !== null) return fromSrc
  }
  return null
}

function parseExternalPackageSpecifier(source: string): { packageName: string | null; subpath: string | null } {
  if (source.startsWith("@")) {
    const firstSlash = source.indexOf("/")
    if (firstSlash < 0) return { packageName: null, subpath: null }
    const secondSlash = source.indexOf("/", firstSlash + 1)
    if (secondSlash < 0) return { packageName: source, subpath: null }
    return { packageName: source.slice(0, secondSlash), subpath: source.slice(secondSlash + 1) }
  }
  const firstSlash = source.indexOf("/")
  if (firstSlash < 0) return { packageName: source, subpath: null }
  return { packageName: source.slice(0, firstSlash), subpath: source.slice(firstSlash + 1) }
}

function findNodeModulesPackage(importerFile: string, packageName: string): string | null {
  let current = dirname(resolve(importerFile))
  while (true) {
    const candidate = join(current, "node_modules", packageName)
    if (existsSync(join(candidate, "package.json"))) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

type ExternalPackageExportNode = { kind: "path"; value: string } | { kind: "array"; values: ExternalPackageExportNode[] } | { kind: "map"; fields: Map<string, ExternalPackageExportNode> }

function parseExternalExportNode(value: unknown): ExternalPackageExportNode | null {
  if (typeof value === "string") return { kind: "path", value }
  if (Array.isArray(value)) {
    const values: ExternalPackageExportNode[] = []
    for (let i = 0; i < value.length; i++) { const parsed = parseExternalExportNode(value[i]); if (parsed !== null) values.push(parsed) }
    return { kind: "array", values }
  }
  if (typeof value !== "object" || value === null) return null
  const fields = new Map<string, ExternalPackageExportNode>()
  for (const [key, nested] of Object.entries(value)) { const parsed = parseExternalExportNode(nested); if (parsed !== null) fields.set(key, parsed) }
  return { kind: "map", fields }
}

function resolveExternalExportTarget(node: ExternalPackageExportNode | null, subpath: string, conditions: readonly string[]): string | null {
  if (node === null) return null
  if (node.kind === "path") return node.value
  if (node.kind === "array") {
    for (let i = 0; i < node.values.length; i++) { const r = resolveExternalExportTarget(node.values[i]!, subpath, conditions); if (r !== null) return r }
    return null
  }
  const exact = node.fields.get(subpath)
  if (exact) { const r = resolveExternalExportCondition(exact, conditions); if (r !== null) return r }
  for (const [key, value] of node.fields) {
    const star = key.indexOf("*"); if (star < 0) continue
    const prefix = key.slice(0, star); const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    const captured = subpath.slice(prefix.length, subpath.length - suffix.length)
    const target = resolveExternalExportCondition(value, conditions)
    if (target === null) continue
    return target.includes("*") ? target.replaceAll("*", captured) : target
  }
  if (subpath === ".") { const root = node.fields.get("."); if (root) { const r = resolveExternalExportCondition(root, conditions); if (r !== null) return r } }
  return resolveExternalExportCondition(node, conditions)
}

function resolveExternalExportCondition(node: ExternalPackageExportNode | undefined, conditions: readonly string[]): string | null {
  if (node === undefined) return null
  if (node.kind === "path") return node.value
  if (node.kind === "array") {
    for (let i = 0; i < node.values.length; i++) { const r = resolveExternalExportCondition(node.values[i]!, conditions); if (r !== null) return r }
    return null
  }
  for (let i = 0; i < conditions.length; i++) { const c = conditions[i]; if (!c) continue; const r = resolveExternalExportCondition(node.fields.get(c), conditions); if (r !== null) return r }
  for (const next of node.fields.values()) { const r = resolveExternalExportCondition(next, conditions); if (r !== null) return r }
  return null
}


// ── Module resolver from compilation ─────────────────────────────────────

function createModuleResolverFromCompilation(compilation: StyleCompilation): ModuleResolver {
  const solidPathSet = new Set<string>()
  for (const key of compilation.solidTrees.keys()) solidPathSet.add(resolve(key))

  const cssPathSet = new Set<string>()
  for (const key of compilation.cssTrees.keys()) cssPathSet.add(resolve(key))

  const packageEntries = buildPackageIndex(solidPathSet, cssPathSet)

  return {
    resolveSolid(importerFile: string, source: string): string | null {
      return resolveImportPath({
        importerFile,
        source,
        availablePaths: solidPathSet,
        extensions: SOLID_EXTENSIONS,
        packageEntries,
        allowPartialFiles: false,
      })
    },
    resolveCss(importerFile: string, source: string): string | null {
      return resolveImportPath({
        importerFile,
        source,
        availablePaths: cssPathSet,
        extensions: CSS_EXTENSIONS,
        packageEntries,
        allowPartialFiles: true,
      })
    },
  }
}


// ══════════════════════════════════════════════════════════════════════════
// Component Host Resolution
// Moved from cross-file/layout/component-host.ts (1452 lines)
// ══════════════════════════════════════════════════════════════════════════

export function createComponentHostResolver(
  allSolidTrees: ReadonlyMap<string, SolidSyntaxTree>,
  moduleResolver: ModuleResolver,
  logger: Logger = noopLogger,
): ComponentHostResolver {
  const moduleIndexes = new Map(buildSolidModuleIndexes(allSolidTrees))
  const externalResolutionCache = new Map<string, string | null>()
  let externalFilesParsed = 0
  const localBindingCache = new Map<string, LayoutBinding | null>()
  const exportBindingCache = new Map<string, LayoutBinding | null>()
  const namespaceBindingCache = new Map<string, NamespaceBinding | null>()
  const resolvingLocal = new Set<string>()
  const resolvingExport = new Set<string>()
  const hostByTagCache = new Map<string, ResolvedComponentHost | null>()

  return {
    resolveHost(importerFile, tag) {
      const normalizedFile = resolve(importerFile)
      const cacheKey = `${normalizedFile}::${tag}`
      const cached = hostByTagCache.get(cacheKey)
      if (cached !== undefined) return cached

      const binding = resolveTagBinding(normalizedFile, tag)
      if (binding === null) {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] resolveHost(${tag}): binding=null`)
        hostByTagCache.set(cacheKey, null)
        return null
      }

      if (binding.kind === "component") {
        if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] resolveHost(${tag}): component, tagName=${binding.host.descriptor.tagName}, attrs=[${[...binding.host.descriptor.staticAttributes.keys()]}]`)
        hostByTagCache.set(cacheKey, binding.host)
        return binding.host
      }

      const host = binding.base ? binding.base.host : null
      if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] resolveHost(${tag}): namespace, base=${host?.descriptor.tagName ?? "null"}`)
      hostByTagCache.set(cacheKey, host)
      return host
    },

    isTransparentPrimitive(importerFile, tag) {
      const root = readTagRoot(tag)
      if (root === null) return false

      const index = moduleIndexes.get(resolve(importerFile))
      if (!index) return false
      return index.transparentPrimitiveNames.has(root)
    },
  }

  function resolveComponentHostEntry(entry: ComponentHostEntry): ResolvedComponentHost | null {
    if (entry.resolution === "resolved") {
      return { descriptor: entry.descriptor, hostElementRef: entry.hostElementRef }
    }

    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] resolveComponentHostEntry: deferred innerTag=${entry.innerTag}, file=${entry.filePath}, attrs=[${[...entry.staticAttributes.keys()]}]`)

    const innerBinding = resolveLocalIdentifierBinding(entry.filePath, entry.innerTag)
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   innerBinding=${innerBinding === null ? "null" : innerBinding.kind}`)
    const innerHost = extractHostFromBinding(innerBinding)
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   innerHost=${innerHost === null ? "null" : `tagName=${innerHost.descriptor.tagName}, attrs=[${[...innerHost.descriptor.staticAttributes.keys()]}]`}`)

    let tagName = innerHost !== null ? innerHost.descriptor.tagName : null
    if (tagName === null) {
      tagName = resolveTagNameFromPolymorphicProp(entry.staticAttributes)
      if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   polymorphic fallback: tagName=${tagName}`)
    }
    const staticAttributes = innerHost !== null
      ? mergeStaticAttributes(entry.staticAttributes, innerHost.descriptor.staticAttributes)
      : entry.staticAttributes
    const staticClassTokens = innerHost !== null
      ? mergeStaticClassTokens(entry.staticClassTokens, innerHost.descriptor.staticClassTokens)
      : entry.staticClassTokens
    const forwardsChildren = entry.forwardsChildren || (innerHost !== null && innerHost.descriptor.forwardsChildren)
    const attributePropBindings = innerHost !== null
      ? mergePropBindings(entry.attributePropBindings, innerHost.descriptor.attributePropBindings)
      : entry.attributePropBindings

    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   resolved: tagName=${tagName}, attrs=[${[...staticAttributes.keys()]}], classes=[${staticClassTokens}]`)

    return {
      descriptor: { tagName, staticAttributes, staticClassTokens, forwardsChildren, attributePropBindings },
      hostElementRef: innerHost?.hostElementRef ?? null,
    }
  }

  function extractHostFromBinding(binding: LayoutBinding | null): ResolvedComponentHost | null {
    if (binding === null) return null
    if (binding.kind === "component") return binding.host
    return binding.base !== null ? binding.base.host : null
  }

  function resolveTagBinding(filePath: string, tag: string): LayoutBinding | null {
    const parts = splitTagPath(tag)
    if (parts.length === 0) return null

    const firstPart = parts[0]
    if (!firstPart) return null
    let binding = resolveLocalIdentifierBinding(filePath, firstPart)
    if (binding === null) return null

    for (let i = 1; i < parts.length; i++) {
      if (binding.kind !== "namespace") return null
      const part = parts[i]
      if (!part) return null
      const next = binding.members.get(part)
      if (!next) return null
      binding = next
    }

    return binding
  }

  function resolveLocalIdentifierBinding(filePath: string, name: string): LayoutBinding | null {
    const key = `${filePath}::${name}`
    const cached = localBindingCache.get(key)
    if (cached !== undefined) return cached
    if (resolvingLocal.has(key)) return null
    resolvingLocal.add(key)

    const index = moduleIndexes.get(filePath)
    if (!index) {
      localBindingCache.set(key, null)
      resolvingLocal.delete(key)
      return null
    }

    const hostEntry = index.hostByComponentName.get(name)
    if (hostEntry) {
      const resolved = resolveComponentHostEntry(hostEntry)
      if (resolved !== null) {
        const binding: ComponentBinding = { kind: "component", host: resolved }
        localBindingCache.set(key, binding)
        resolvingLocal.delete(key)
        return binding
      }
    }

    const variableInit = index.variableInitByName.get(name)
    if (variableInit) {
      const binding = resolveBindingFromExpression(filePath, variableInit)
      localBindingCache.set(key, binding)
      resolvingLocal.delete(key)
      return binding
    }

    const importBinding = index.importByLocalName.get(name)
    if (importBinding) {
      const binding = resolveBindingFromImport(filePath, importBinding)
      localBindingCache.set(key, binding)
      resolvingLocal.delete(key)
      return binding
    }

    localBindingCache.set(key, null)
    resolvingLocal.delete(key)
    return null
  }

  function resolveBindingFromExpression(filePath: string, expression: ts.Expression): LayoutBinding | null {
    const unwrapped = unwrapExpression(expression)
    if (ts.isIdentifier(unwrapped)) {
      return resolveLocalIdentifierBinding(filePath, unwrapped.text)
    }

    if (ts.isPropertyAccessExpression(unwrapped)) {
      return resolveBindingFromMemberExpression(filePath, unwrapped)
    }

    if (ts.isCallExpression(unwrapped)) {
      return resolveBindingFromCallExpression(filePath, unwrapped)
    }

    if (ts.isObjectLiteralExpression(unwrapped)) {
      return resolveNamespaceFromObjectExpression(filePath, unwrapped, null)
    }

    if (ts.isCommaListExpression(unwrapped)) {
      if (unwrapped.elements.length === 0) return null
      const lastExpr = unwrapped.elements[unwrapped.elements.length - 1]
      if (!lastExpr) return null
      return resolveBindingFromExpression(filePath, lastExpr)
    }

    return null
  }

  function resolveBindingFromMemberExpression(
    filePath: string,
    expression: ts.PropertyAccessExpression,
  ): LayoutBinding | null {
    if (expression.expression.kind === ts.SyntaxKind.SuperKeyword) return null

    const objectBinding = resolveBindingFromExpression(filePath, expression.expression)
    if (objectBinding === null) return null
    if (objectBinding.kind !== "namespace") return null
    return objectBinding.members.get(expression.name.text) ?? null
  }

  function resolveBindingFromCallExpression(
    filePath: string,
    expression: ts.CallExpression,
  ): LayoutBinding | null {
    if (!isObjectAssignCall(expression)) return null
    if (expression.arguments.length === 0) return null

    const firstArg = expression.arguments[0]
    if (!firstArg) return null
    const baseExpression = toExpressionArgument(firstArg)
    if (baseExpression === null) return null
    const baseBinding = resolveBindingFromExpression(filePath, baseExpression)
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] Object.assign base: ${baseBinding === null ? "null" : baseBinding.kind}${baseBinding?.kind === "component" ? `, tagName=${baseBinding.host.descriptor.tagName}` : ""}`)

    let baseComponent: ComponentBinding | null = null
    const members = new Map<string, LayoutBinding>()

    if (baseBinding && baseBinding.kind === "component") {
      baseComponent = baseBinding
    }

    if (baseBinding && baseBinding.kind === "namespace") {
      baseComponent = baseBinding.base
      for (const [name, value] of baseBinding.members) {
        members.set(name, value)
      }
    }

    for (let i = 1; i < expression.arguments.length; i++) {
      const argument = expression.arguments[i]
      if (!argument) continue
      if (ts.isSpreadElement(argument)) {
        const spread = resolveBindingFromExpression(filePath, argument.expression)
        if (!spread || spread.kind !== "namespace") continue
        for (const [name, value] of spread.members) {
          members.set(name, value)
        }
        continue
      }

      if (!ts.isObjectLiteralExpression(argument)) continue
      appendObjectExpressionMembers(filePath, argument, members)
    }

    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] Object.assign result: base=${baseComponent === null ? "null" : `tagName=${baseComponent.host.descriptor.tagName}`}, members=[${[...members.keys()]}]`)
    if (baseComponent === null && members.size === 0) return null

    return {
      kind: "namespace",
      base: baseComponent,
      members,
    }
  }

  function resolveNamespaceFromObjectExpression(
    filePath: string,
    objectExpression: ts.ObjectLiteralExpression,
    base: ComponentBinding | null,
  ): NamespaceBinding | null {
    const members = new Map<string, LayoutBinding>()
    appendObjectExpressionMembers(filePath, objectExpression, members)
    if (base === null && members.size === 0) return null

    return {
      kind: "namespace",
      base,
      members,
    }
  }

  function appendObjectExpressionMembers(
    filePath: string,
    objectExpression: ts.ObjectLiteralExpression,
    members: Map<string, LayoutBinding>,
  ): void {
    for (let i = 0; i < objectExpression.properties.length; i++) {
      const property = objectExpression.properties[i]
      if (!property) continue
      if (ts.isSpreadAssignment(property)) {
        const spread = resolveBindingFromExpression(filePath, property.expression)
        if (!spread || spread.kind !== "namespace") continue
        for (const [name, value] of spread.members) {
          members.set(name, value)
        }
        continue
      }

      if (!ts.isPropertyAssignment(property)) continue
      if (property.name && ts.isComputedPropertyName(property.name)) continue
      const keyName = readObjectPropertyKey(property.name)
      if (keyName === null) continue
      const value = property.initializer

      const valueBinding = resolveBindingFromExpression(filePath, value)
      if (valueBinding === null) continue
      members.set(keyName, valueBinding)
    }
  }

  function resolveBindingFromImport(filePath: string, importBinding: ImportBinding): LayoutBinding | null {
    const resolvedModule = moduleResolver.resolveSolid(filePath, importBinding.source)
      ?? resolveAndIndexExternalModule(filePath, importBinding.source)
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host] resolveBindingFromImport: source=${importBinding.source}, kind=${importBinding.kind}, resolvedModule=${resolvedModule}`)
    if (resolvedModule === null) return null

    const normalized = resolve(resolvedModule)
    if (importBinding.kind === "namespace") {
      return resolveNamespaceBindingForFile(normalized)
    }

    const exportName = importBinding.kind === "default" ? "default" : importBinding.importedName
    if (exportName === null) return null
    const result = resolveExportBinding(normalized, exportName)
    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   export ${exportName}: ${result === null ? "null" : result.kind}`)
    return result
  }

  function resolveAndIndexExternalModule(importerFile: string, importSource: string): string | null {
    const cacheKey = `${importerFile}::${importSource}`
    const cached = externalResolutionCache.get(cacheKey)
    if (cached !== undefined) return cached

    if (externalFilesParsed >= MAX_EXTERNAL_FILES_PARSED) {
      externalResolutionCache.set(cacheKey, null)
      return null
    }

    const externalPath = resolveExternalModule(importerFile, importSource)
    if (externalPath === null) {
      externalResolutionCache.set(cacheKey, null)
      return null
    }

    const normalized = resolve(externalPath)
    if (moduleIndexes.has(normalized)) {
      externalResolutionCache.set(cacheKey, normalized)
      return normalized
    }

    const index = parseAndBuildExternalIndex(normalized)
    if (index === null) {
      externalResolutionCache.set(cacheKey, null)
      return null
    }

    moduleIndexes.set(normalized, index)
    externalResolutionCache.set(cacheKey, normalized)
    externalFilesParsed++
    return normalized
  }

  function resolveNamespaceBindingForFile(filePath: string): NamespaceBinding | null {
    const cached = namespaceBindingCache.get(filePath)
    if (cached !== undefined) return cached

    const index = moduleIndexes.get(filePath)
    if (!index) {
      namespaceBindingCache.set(filePath, null)
      return null
    }

    const members = new Map<string, LayoutBinding>()

    for (const exportName of index.exportsByName.keys()) {
      const binding = resolveExportBinding(filePath, exportName)
      if (binding === null) continue
      members.set(exportName, binding)
    }

    if (members.size === 0) {
      namespaceBindingCache.set(filePath, null)
      return null
    }

    const namespaceBinding: NamespaceBinding = {
      kind: "namespace",
      base: null,
      members,
    }
    namespaceBindingCache.set(filePath, namespaceBinding)
    return namespaceBinding
  }

  function resolveExportBinding(filePath: string, exportName: string): LayoutBinding | null {
    const key = `${filePath}::${exportName}`
    const cached = exportBindingCache.get(key)
    if (cached !== undefined) return cached
    if (resolvingExport.has(key)) return null
    resolvingExport.add(key)

    const index = moduleIndexes.get(filePath)
    if (!index) {
      exportBindingCache.set(key, null)
      resolvingExport.delete(key)
      return null
    }

    const candidates = index.exportsByName.get(exportName)
    if (!candidates || candidates.length === 0) {
      exportBindingCache.set(key, null)
      resolvingExport.delete(key)
      return null
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (!candidate) continue
      const binding = resolveBindingFromExportEntity(filePath, candidate)
      if (binding === null) continue
      exportBindingCache.set(key, binding)
      resolvingExport.delete(key)
      return binding
    }

    exportBindingCache.set(key, null)
    resolvingExport.delete(key)
    return null
  }

  function resolveBindingFromExportEntity(filePath: string, exportEntity: ExportEntity): LayoutBinding | null {
    if (exportEntity.isTypeOnly) return null

    if (exportEntity.source !== null) {
      const targetModule = moduleResolver.resolveSolid(filePath, exportEntity.source)
      if (targetModule === null) return null

      const targetName = exportEntity.importedName ?? exportEntity.name
      if (targetName === "*") return null
      return resolveExportBinding(resolve(targetModule), targetName)
    }

    const index = moduleIndexes.get(filePath)
    if (!index) return null

    const byEntityId = resolveBindingByEntityId(index, filePath, exportEntity)
    if (byEntityId !== null) return byEntityId

    if (exportEntity.name === "default") return null
    const localName = exportEntity.importedName ?? exportEntity.name
    return resolveLocalIdentifierBinding(filePath, localName)
  }

  function resolveBindingByEntityId(
    index: SolidModuleIndex,
    filePath: string,
    exportEntity: ExportEntity,
  ): LayoutBinding | null {
    if (exportEntity.entityId < 0) return null

    if (exportEntity.kind === ExportKind.COMPONENT) {
      const fn = index.tree.functions[exportEntity.entityId]
      if (!fn || fn.name === null) return null
      const hostEntry = index.hostByComponentName.get(fn.name)
      if (!hostEntry) return null
      const resolved = resolveComponentHostEntry(hostEntry)
      if (resolved === null) return null
      return {
        kind: "component",
        host: resolved,
      }
    }

    if (exportEntity.kind === ExportKind.FUNCTION) {
      const fn = index.tree.functions[exportEntity.entityId]
      if (!fn || fn.name === null) return null
      return resolveLocalIdentifierBinding(filePath, fn.name)
    }

    const variable = index.tree.variables[exportEntity.entityId]
    if (!variable) return null
    return resolveLocalIdentifierBinding(filePath, variable.name)
  }
}


// ── Module index construction ────────────────────────────────────────────

function buildSolidModuleIndexes(allTrees: ReadonlyMap<string, SolidSyntaxTree>): ReadonlyMap<string, SolidModuleIndex> {
  const out = new Map<string, SolidModuleIndex>()

  for (const [filePath, tree] of allTrees) {
    out.set(resolve(filePath), buildSolidModuleIndex(tree))
  }

  return out
}

function buildSolidModuleIndex(tree: SolidSyntaxTree): SolidModuleIndex {
  return {
    tree,
    hostByComponentName: collectComponentHosts(tree),
    variableInitByName: collectTopLevelVariableInitializers(tree),
    importByLocalName: collectImportBindingsByLocalName(tree),
    exportsByName: collectExportsByName(tree),
    transparentPrimitiveNames: collectTransparentPrimitiveNames(tree),
  }
}

function parseAndBuildExternalIndex(filePath: string): SolidModuleIndex | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const program = ts.createProgram([filePath], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
      noEmit: true,
    }, {
      getSourceFile(name, languageVersion) {
        if (name === filePath) return ts.createSourceFile(name, content, languageVersion, true)
        return undefined
      },
      writeFile() {},
      getDefaultLibFileName: () => "lib.d.ts",
      useCaseSensitiveFileNames: () => true,
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => "",
      getNewLine: () => "\n",
      fileExists: (f) => f === filePath,
      readFile: (f) => f === filePath ? content : undefined,
    })
    const input = createSolidInput(filePath, program)
    const tree = buildSolidSyntaxTree(input, "external")
    return buildSolidModuleIndex(tree)
  } catch {
    return null
  }
}

function collectComponentHosts(tree: SolidSyntaxTree): ReadonlyMap<string, ComponentHostEntry> {
  const out = new Map<string, ComponentHostEntry>()

  for (let i = 0; i < tree.componentFunctions.length; i++) {
    const fn = tree.componentFunctions[i]
    if (!fn) continue
    if (fn.name === null) continue
    const entry = resolveComponentHostEntryForFunction(tree, fn)
    if (entry === null) continue
    out.set(fn.name, entry)
  }

  return out
}

function resolveComponentHostEntryForFunction(
  tree: SolidSyntaxTree,
  fn: FunctionEntity,
): ComponentHostEntry | null {
  let entry: ComponentHostEntry | null = null
  let hostElementRefAgreed = true

  const bodyEntry = resolveHostEntryFromFunctionBody(tree, fn)
  if (bodyEntry !== null) {
    entry = bodyEntry
  }

  for (let i = 0; i < fn.returnStatements.length; i++) {
    const returnStatement = fn.returnStatements[i]
    if (!returnStatement) continue
    const argument = returnStatement.node.expression
    if (!argument) continue
    const returnEntry = resolveHostEntryFromExpression(tree, argument)
    if (returnEntry === null) return null

    if (entry === null) {
      entry = returnEntry
      continue
    }

    if (areComponentHostEntriesEqual(entry, returnEntry)) {
      if (
        hostElementRefAgreed &&
        entry.resolution === "resolved" &&
        returnEntry.resolution === "resolved" &&
        entry.hostElementRef !== returnEntry.hostElementRef
      ) {
        hostElementRefAgreed = false
      }
      continue
    }
    return null
  }

  if (!hostElementRefAgreed && entry !== null && entry.resolution === "resolved") {
    return { resolution: "resolved", descriptor: entry.descriptor, hostElementRef: null }
  }

  return entry
}

function resolveHostEntryFromFunctionBody(
  tree: SolidSyntaxTree,
  fn: FunctionEntity,
): ComponentHostEntry | null {
  if (!fn.body || ts.isBlock(fn.body)) return null
  return resolveHostEntryFromExpression(tree, fn.body)
}

function resolveHostEntryFromExpression(
  tree: SolidSyntaxTree,
  expression: ts.Expression,
): ComponentHostEntry | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
    return resolveHostEntryFromJSXElement(tree, unwrapped)
  }

  if (!ts.isJsxFragment(unwrapped)) return null
  return resolveHostEntryFromJSXFragment(tree, unwrapped)
}

function resolveHostEntryFromJSXElement(tree: SolidSyntaxTree, node: ts.JsxElement | ts.JsxSelfClosingElement): ComponentHostEntry | null {
  const element = tree.jsxByNode.get(node)
  if (!element) return null
  if (element.tag === null) return null

  if (element.isDomElement) {
    if (element.tagName === null) return null
    return {
      resolution: "resolved",
      descriptor: {
        tagName: element.tagName,
        staticAttributes: collectStaticAttributes(element),
        staticClassTokens: getStaticClassTokensForTreeElement(tree, element),
        forwardsChildren: detectChildrenForwarding(element),
        attributePropBindings: collectAttributePropBindings(element),
      },
      hostElementRef: { filePath: tree.filePath, element },
    }
  }

  if (isContextProviderTag(element.tag)) {
    const children = ts.isJsxElement(node) ? node.children : []
    return resolveHostEntryFromJSXChildren(tree, children)
  }

  return {
    resolution: "deferred",
    innerTag: element.tag,
    filePath: tree.filePath,
    staticAttributes: collectStaticAttributes(element),
    staticClassTokens: getStaticClassTokensForTreeElement(tree, element),
    forwardsChildren: detectChildrenForwarding(element),
    attributePropBindings: collectAttributePropBindings(element),
  }
}

function isContextProviderTag(tag: string): boolean {
  return tag.endsWith(".Provider")
}

function resolveHostEntryFromJSXChildren(tree: SolidSyntaxTree, children: readonly ts.JsxChild[]): ComponentHostEntry | null {
  let candidate: ComponentHostEntry | null = null

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    const resolved = resolveHostEntryFromJSXChild(tree, child)
    if (resolved === "ignore") continue
    if (resolved === null) return null
    if (candidate !== null) {
      if (!areComponentHostEntriesEqual(candidate, resolved)) return null
    }
    candidate = resolved
  }

  return candidate
}

function resolveHostEntryFromJSXFragment(tree: SolidSyntaxTree, node: ts.JsxFragment): ComponentHostEntry | null {
  return resolveHostEntryFromJSXChildren(tree, [...node.children])
}

function resolveHostEntryFromJSXChild(
  tree: SolidSyntaxTree,
  child: ts.JsxChild,
): ComponentHostEntry | null | "ignore" {
  if (ts.isJsxText(child)) {
    if (isBlank(child.text)) return "ignore"
    return null
  }

  if (ts.isJsxExpression(child)) {
    if (!child.expression) return "ignore"
    return null
  }

  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    return resolveHostEntryFromJSXElement(tree, child)
  }

  if (!ts.isJsxFragment(child)) return null
  return resolveHostEntryFromJSXFragment(tree, child)
}

function detectChildrenForwarding(root: JSXElementEntity): boolean {
  const queue = [root]
  const seen = new Set<number>()

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    if (!current) continue
    if (seen.has(current.id)) continue
    seen.add(current.id)

    for (let j = 0; j < current.children.length; j++) {
      const child = current.children[j]
      if (!child) continue
      if (child.kind !== "expression") continue
      if (!ts.isJsxExpression(child.node)) continue
      if (!child.node.expression) continue
      if (containsChildrenReference(child.node.expression)) return true
    }

    for (let j = 0; j < current.childElements.length; j++) {
      const childElement = current.childElements[j]
      if (!childElement) continue
      queue.push(childElement)
    }
  }

  return false
}

function containsChildrenReference(expression: ts.Expression): boolean {
  const queue: ts.Node[] = [expression]

  for (let i = 0; i < queue.length; i++) {
    if (queue.length > MAX_CHILDREN_REFERENCE_QUEUE_SIZE) return false
    const current = queue[i]
    if (!current) continue

    if (ts.isIdentifier(current)) {
      if (current.text === "children") return true
      continue
    }

    if (ts.isPropertyAccessExpression(current)) {
      if (ts.isIdentifier(current.name) && current.name.text === "children") {
        return true
      }
      queue.push(current.expression)
      continue
    }

    if (ts.isElementAccessExpression(current)) {
      queue.push(current.expression)
      queue.push(current.argumentExpression)
      continue
    }

    if (ts.isCallExpression(current)) {
      if (ts.isIdentifier(current.expression) && current.expression.text === "children") return true
      queue.push(current.expression)

      for (let j = 0; j < current.arguments.length; j++) {
        const argument = current.arguments[j]
        if (!argument) continue
        if (ts.isSpreadElement(argument)) {
          queue.push(argument.expression)
          continue
        }
        queue.push(argument)
      }
      continue
    }

    if (ts.isConditionalExpression(current)) {
      queue.push(current.condition)
      queue.push(current.whenTrue)
      queue.push(current.whenFalse)
      continue
    }

    if (ts.isBinaryExpression(current)) {
      queue.push(current.left)
      queue.push(current.right)
      continue
    }

    if (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) {
      queue.push(current.operand)
      continue
    }

    if (ts.isCommaListExpression(current)) {
      for (let j = 0; j < current.elements.length; j++) {
        const expr = current.elements[j]
        if (!expr) continue
        queue.push(expr)
      }
      continue
    }

    if (ts.isArrayLiteralExpression(current)) {
      for (let j = 0; j < current.elements.length; j++) {
        const elem = current.elements[j]
        if (!elem) continue
        queue.push(elem)
      }
      continue
    }

    if (ts.isObjectLiteralExpression(current)) {
      for (let j = 0; j < current.properties.length; j++) {
        const property = current.properties[j]
        if (!property) continue
        if (ts.isSpreadAssignment(property)) {
          queue.push(property.expression)
          continue
        }
        if (!ts.isPropertyAssignment(property)) continue
        if (property.name && ts.isComputedPropertyName(property.name)) queue.push(property.name.expression)
        queue.push(property.initializer)
      }
      continue
    }

    if (ts.isTemplateExpression(current)) {
      for (let j = 0; j < current.templateSpans.length; j++) {
        const span = current.templateSpans[j]
        if (!span) continue
        queue.push(span.expression)
      }
      continue
    }

    if (ts.isAwaitExpression(current)) {
      queue.push(current.expression)
      continue
    }

    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      queue.push(current.expression)
      continue
    }

    if (ts.isNonNullExpression(current)) {
      queue.push(current.expression)
      continue
    }
  }

  return false
}


// ── Module index helpers ─────────────────────────────────────────────────

function collectTopLevelVariableInitializers(tree: SolidSyntaxTree): ReadonlyMap<string, ts.Expression> {
  const out = new Map<string, ts.Expression>()

  for (let i = 0; i < tree.variables.length; i++) {
    const variable = tree.variables[i]
    if (!variable) continue
    if (variable.scope.kind !== "program") continue

    const initializer = resolveInitializerExpression(variable)
    if (initializer === null) continue
    out.set(variable.name, initializer)
  }

  return out
}

function resolveInitializerExpression(variable: VariableEntity): ts.Expression | null {
  return variable.initializer
}

function collectImportBindingsByLocalName(tree: SolidSyntaxTree): ReadonlyMap<string, ImportBinding> {
  const out = new Map<string, ImportBinding>()

  for (let i = 0; i < tree.imports.length; i++) {
    const importEntity = tree.imports[i]
    if (!importEntity) continue
    if (importEntity.isTypeOnly) continue

    for (let j = 0; j < importEntity.specifiers.length; j++) {
      const specifier = importEntity.specifiers[j]
      if (!specifier) continue
      if (specifier.isTypeOnly) continue
      if (out.has(specifier.localName)) continue
      out.set(specifier.localName, {
        source: importEntity.source,
        kind: specifier.kind,
        importedName: specifier.importedName,
      })
    }
  }

  return out
}

function collectTransparentPrimitiveNames(tree: SolidSyntaxTree): ReadonlySet<string> {
  const out = new Set<string>()

  for (let i = 0; i < tree.imports.length; i++) {
    const importEntity = tree.imports[i]
    if (!importEntity) continue
    if (importEntity.source !== "solid-js") continue
    if (importEntity.isTypeOnly) continue

    for (let j = 0; j < importEntity.specifiers.length; j++) {
      const specifier = importEntity.specifiers[j]
      if (!specifier) continue
      if (specifier.isTypeOnly) continue
      if (specifier.kind !== "named") continue
      if (specifier.importedName === null) continue
      if (!TRANSPARENT_SOLID_PRIMITIVES.has(specifier.importedName)) continue
      out.add(specifier.localName)
    }
  }

  return out
}

function collectExportsByName(tree: SolidSyntaxTree): ReadonlyMap<string, readonly ExportEntity[]> {
  const out = new Map<string, ExportEntity[]>()

  for (let i = 0; i < tree.exports.length; i++) {
    const exportEntity = tree.exports[i]
    if (!exportEntity) continue
    const existing = out.get(exportEntity.name)
    if (existing) {
      existing.push(exportEntity)
      continue
    }
    out.set(exportEntity.name, [exportEntity])
  }

  return out
}


// ── Expression/type helpers ──────────────────────────────────────────────

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression

  while (true) {
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression
      continue
    }

    if (ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }

    if (ts.isParenthesizedExpression(current)) {
      current = current.expression
      continue
    }

    return current
  }
}

function isObjectAssignCall(expression: ts.CallExpression): boolean {
  const callee = expression.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.expression)) return false
  if (callee.expression.text !== "Object") return false
  return callee.name.text === "assign"
}

function toExpressionArgument(argument: ts.Expression): ts.Expression | null {
  if (ts.isSpreadElement(argument)) return null
  return argument
}

function readObjectPropertyKey(key: ts.PropertyName): string | null {
  if (ts.isPrivateIdentifier(key)) return null
  if (ts.isIdentifier(key)) return key.text
  if (ts.isStringLiteral(key)) return key.text
  if (ts.isNumericLiteral(key)) return key.text
  if (ts.isNoSubstitutionTemplateLiteral(key)) return key.text
  return null
}

function splitTagPath(tag: string): readonly string[] {
  if (tag.length === 0) return []
  const parts = tag.split(".")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || part.length === 0) return []
  }
  return parts
}

function readTagRoot(tag: string): string | null {
  if (tag.length === 0) return null
  const dotIndex = tag.indexOf(".")
  const root = dotIndex === -1 ? tag : tag.slice(0, dotIndex)
  if (root.length === 0) return null
  return root
}


// ── Host entry comparison ────────────────────────────────────────────────

function areHostDescriptorsEqual(
  left: LayoutComponentHostDescriptor,
  right: LayoutComponentHostDescriptor,
): boolean {
  if (left.tagName !== right.tagName) return false
  if (left.forwardsChildren !== right.forwardsChildren) return false
  if (!areStringListsEqual(left.staticClassTokens, right.staticClassTokens)) return false
  if (!areAttributeMapsEqual(left.staticAttributes, right.staticAttributes)) return false
  if (left.attributePropBindings.size !== right.attributePropBindings.size) return false
  for (const [key, value] of left.attributePropBindings) {
    if (right.attributePropBindings.get(key) !== value) return false
  }
  return true
}

function areComponentHostEntriesEqual(
  left: ComponentHostEntry,
  right: ComponentHostEntry,
): boolean {
  if (left.resolution !== right.resolution) return false

  if (left.resolution === "resolved" && right.resolution === "resolved") {
    return areHostDescriptorsEqual(left.descriptor, right.descriptor)
  }

  if (left.resolution === "deferred" && right.resolution === "deferred") {
    if (left.innerTag !== right.innerTag) return false
    if (left.filePath !== right.filePath) return false
    if (left.forwardsChildren !== right.forwardsChildren) return false
    if (!areStringListsEqual(left.staticClassTokens, right.staticClassTokens)) return false
    return areAttributeMapsEqual(left.staticAttributes, right.staticAttributes)
  }

  return false
}

function areStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }

  return true
}

function areAttributeMapsEqual(
  left: ReadonlyMap<string, string | null>,
  right: ReadonlyMap<string, string | null>,
): boolean {
  if (left.size !== right.size) return false

  for (const [key, value] of left) {
    if (!right.has(key)) return false
    if (right.get(key) !== value) return false
  }

  return true
}


// ── Host resolution merge helpers ────────────────────────────────────────

function mergeStaticAttributes(
  outer: ReadonlyMap<string, string | null>,
  inner: ReadonlyMap<string, string | null>,
): ReadonlyMap<string, string | null> {
  if (inner.size === 0) return outer
  if (outer.size === 0) return inner

  const out = new Map<string, string | null>()
  for (const [name, value] of inner) out.set(name, value)
  for (const [name, value] of outer) out.set(name, value)
  return out
}

function mergePropBindings(
  outer: ReadonlyMap<string, string>,
  inner: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (inner.size === 0) return outer
  if (outer.size === 0) return inner

  const out = new Map<string, string>()
  for (const [name, value] of inner) out.set(name, value)
  for (const [name, value] of outer) out.set(name, value)
  return out
}

function resolveTagNameFromPolymorphicProp(
  staticAttributes: ReadonlyMap<string, string | null>,
): string | null {
  const asValue = staticAttributes.get("as")
  if (asValue === undefined || asValue === null) return null
  const normalized = asValue.toLowerCase()
  if (!HTML_TAG_NAMES.has(normalized)) return null
  return normalized
}

function mergeStaticClassTokens(
  outer: readonly string[],
  inner: readonly string[],
): readonly string[] {
  if (inner.length === 0) return outer
  if (outer.length === 0) return inner

  const seen = new Set<string>()
  const out: string[] = []

  for (let i = 0; i < outer.length; i++) {
    const token = outer[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  for (let i = 0; i < inner.length; i++) {
    const token = inner[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  return out
}
