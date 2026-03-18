import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"
import { ExportKind, type ExportEntity } from "../../solid/entities/export"
import type { FunctionEntity } from "../../solid/entities/function"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import type { VariableEntity } from "../../solid/entities/variable"
import { SolidGraph } from "../../solid/impl"
import { createSolidInput } from "../../solid/create-input"
import { runPhases } from "../../solid/phases"
import { getStaticClassTokensForElementEntity } from "../../solid/queries/jsx-derived"
import { getStaticStringFromJSXValue } from "../../solid/util/static-value"
import type { Logger } from "@drskillissue/ganko-shared"
import { noopLogger, isBlank, Level } from "@drskillissue/ganko-shared"
import type { LayoutModuleResolver } from "./module-resolver"
import { resolveExternalModule } from "./module-resolver"
import type { LayoutElementRef } from "./graph"

const EMPTY_ATTRIBUTES: ReadonlyMap<string, string | null> = new Map()

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

/** Purely structural host metadata — no AST references. Safe to cache and compare. */
export interface LayoutComponentHostDescriptor {
  readonly tagName: string | null
  readonly staticAttributes: ReadonlyMap<string, string | null>
  readonly staticClassTokens: readonly string[]
  readonly forwardsChildren: boolean
}

/**
 * Pairs the structural host descriptor with a direct reference to the actual
 * host DOM element in its own SolidGraph. The `hostElementRef` is non-null only
 * when the component resolves unambiguously to a single concrete DOM element —
 * it is null for polymorphic tags, unresolvable components, and components with
 * multiple structurally-equal returns that use different JSX element nodes.
 *
 * Rules that need to inspect JSX attribute expressions on the host (e.g. dynamic
 * `width={props.size ?? 24}`) should read `layout.hostElementRefsByNode` via
 * `readHostElementRef`, which is populated from this field during graph construction.
 */
export interface ResolvedComponentHost {
  readonly descriptor: LayoutComponentHostDescriptor
  readonly hostElementRef: LayoutElementRef | null
}

export interface LayoutComponentHostResolver {
  resolveHost(importerFile: string, tag: string): ResolvedComponentHost | null
  isTransparentPrimitive(importerFile: string, tag: string): boolean
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

/**
 * A fully resolved host entry — the JSX root was a DOM element, so tagName,
 * attributes, and class tokens are all known from the single-file analysis phase.
 * `hostElementRef` points to the actual JSX element node and its SolidGraph so
 * that rules can inspect dynamic attribute expressions on the host.
 */
interface ResolvedComponentHostEntry {
  readonly resolution: "resolved"
  readonly descriptor: LayoutComponentHostDescriptor
  readonly hostElementRef: LayoutElementRef | null
}

/**
 * A deferred host entry — the component's JSX root renders another component (non-DOM).
 * The call-site attributes and class tokens ARE known (they're in the user's source),
 * but the underlying DOM tag is unknown until the inner component is recursively resolved
 * through the cross-file binding chain.
 *
 * `innerTag` is the JSX tag of the non-DOM root element (e.g. "Base" for `<Base data-component="tabs">`).
 * `filePath` is the file where this component is defined, used to resolve the inner tag's import.
 */
interface DeferredComponentHostEntry {
  readonly resolution: "deferred"
  readonly innerTag: string
  readonly filePath: string
  readonly staticAttributes: ReadonlyMap<string, string | null>
  readonly staticClassTokens: readonly string[]
  readonly forwardsChildren: boolean
}

type ComponentHostEntry = ResolvedComponentHostEntry | DeferredComponentHostEntry

interface SolidModuleIndex {
  readonly graph: SolidGraph
  readonly hostByComponentName: ReadonlyMap<string, ComponentHostEntry>
  readonly variableInitByName: ReadonlyMap<string, ts.Expression>
  readonly importByLocalName: ReadonlyMap<string, ImportBinding>
  readonly exportsByName: ReadonlyMap<string, readonly ExportEntity[]>
  readonly transparentPrimitiveNames: ReadonlySet<string>
}

const MAX_EXTERNAL_FILES_PARSED = 100

export function createLayoutComponentHostResolver(
  solids: readonly SolidGraph[],
  moduleResolver: LayoutModuleResolver,
  logger: Logger = noopLogger,
): LayoutComponentHostResolver {
  const moduleIndexes = new Map(buildSolidModuleIndexes(solids))
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

  /**
   * Resolves a ComponentHostEntry to a final ResolvedComponentHost.
   *
   * For resolved entries, returns the descriptor and hostElementRef directly.
   * For deferred entries, recursively resolves the inner component tag through
   * the binding chain, merges call-site attributes/classes from each layer,
   * and propagates the leaf DOM element's hostElementRef.
   *
   * Returns null only when the inner component resolves to a non-component binding
   * or cyclic resolution is detected (handled by the existing resolvingLocal/resolvingExport guards).
   */
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

    if (logger.isLevelEnabled(Level.Trace)) logger.trace(`[component-host]   resolved: tagName=${tagName}, attrs=[${[...staticAttributes.keys()]}], classes=[${staticClassTokens}]`)

    return {
      descriptor: { tagName, staticAttributes, staticClassTokens, forwardsChildren },
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

  /**
   * Attempt to resolve an import source to an external file (node_modules),
   * parse it on demand, build a SolidModuleIndex, and cache it for subsequent
   * resolution calls. Returns the resolved file path if successful, null otherwise.
   *
   * @param importerFile - Absolute path of the file containing the import
   * @param importSource - The import specifier to resolve
   * @returns Resolved file path added to moduleIndexes, or null
   */
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
      const fn = index.graph.functions[exportEntity.entityId]
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
      const fn = index.graph.functions[exportEntity.entityId]
      if (!fn || fn.name === null) return null
      return resolveLocalIdentifierBinding(filePath, fn.name)
    }

    const variable = index.graph.variables[exportEntity.entityId]
    if (!variable) return null
    return resolveLocalIdentifierBinding(filePath, variable.name)
  }
}

function buildSolidModuleIndex(graph: SolidGraph): SolidModuleIndex {
  return {
    graph,
    hostByComponentName: collectComponentHosts(graph),
    variableInitByName: collectTopLevelVariableInitializers(graph),
    importByLocalName: collectImportBindingsByLocalName(graph),
    exportsByName: collectExportsByName(graph),
    transparentPrimitiveNames: collectTransparentPrimitiveNames(graph),
  }
}

function buildSolidModuleIndexes(solids: readonly SolidGraph[]): ReadonlyMap<string, SolidModuleIndex> {
  const out = new Map<string, SolidModuleIndex>()

  for (let i = 0; i < solids.length; i++) {
    const graph = solids[i]
    if (!graph) continue
    out.set(resolve(graph.file), buildSolidModuleIndex(graph))
  }

  return out
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
    const graph = new SolidGraph(input)
    runPhases(graph, input)
    return buildSolidModuleIndex(graph)
  } catch {
    return null
  }
}

function collectComponentHosts(graph: SolidGraph): ReadonlyMap<string, ComponentHostEntry> {
  const out = new Map<string, ComponentHostEntry>()

  for (let i = 0; i < graph.componentFunctions.length; i++) {
    const fn = graph.componentFunctions[i]
    if (!fn) continue
    if (fn.name === null) continue
    const entry = resolveComponentHostEntryForFunction(graph, fn)
    if (entry === null) continue
    out.set(fn.name, entry)
  }

  return out
}

function resolveComponentHostEntryForFunction(
  graph: SolidGraph,
  fn: FunctionEntity,
): ComponentHostEntry | null {
  let entry: ComponentHostEntry | null = null
  let hostElementRefAgreed = true

  const bodyEntry = resolveHostEntryFromFunctionBody(graph, fn)
  if (bodyEntry !== null) {
    entry = bodyEntry
  }

  for (let i = 0; i < fn.returnStatements.length; i++) {
    const returnStatement = fn.returnStatements[i]
    if (!returnStatement) continue
    const argument = returnStatement.node.expression
    if (!argument) continue
    const returnEntry = resolveHostEntryFromExpression(graph, argument)
    if (returnEntry === null) return null

    if (entry === null) {
      entry = returnEntry
      continue
    }

    if (areComponentHostEntriesEqual(entry, returnEntry)) {
      // Two structurally equal resolved returns that point to different JSX element
      // nodes (e.g., two `<svg>` returns with different dynamic expressions) cannot
      // be resolved to a single authoritative host element. Nullify rather than
      // silently inheriting the first one, which could produce incorrect dynamic
      // attribute lookups in rules that call readHostElementRef.
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
  graph: SolidGraph,
  fn: FunctionEntity,
): ComponentHostEntry | null {
  if (!fn.body || ts.isBlock(fn.body)) return null
  return resolveHostEntryFromExpression(graph, fn.body)
}

function resolveHostEntryFromExpression(
  graph: SolidGraph,
  expression: ts.Expression,
): ComponentHostEntry | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
    return resolveHostEntryFromJSXElement(graph, unwrapped)
  }

  if (!ts.isJsxFragment(unwrapped)) return null
  return resolveHostEntryFromJSXFragment(graph, unwrapped)
}

/**
 * Resolves a JSX element to a ComponentHostEntry.
 *
 * If the element is a DOM element, produces a ResolvedComponentHostEntry with
 * the concrete tagName, attributes, and class tokens.
 *
 * If the element is a component (non-DOM), produces a DeferredComponentHostEntry
 * carrying the call-site attributes and class tokens, plus the inner component
 * tag for later cross-file recursive resolution.
 */
function resolveHostEntryFromJSXElement(graph: SolidGraph, node: ts.JsxElement | ts.JsxSelfClosingElement): ComponentHostEntry | null {
  const element = graph.jsxByNode.get(node)
  if (!element) return null
  if (element.tag === null) return null

  if (element.isDomElement) {
    if (element.tagName === null) return null
    return {
      resolution: "resolved",
      descriptor: {
        tagName: element.tagName,
        staticAttributes: collectStaticAttributes(element),
        staticClassTokens: getStaticClassTokensForElementEntity(graph, element),
        forwardsChildren: detectChildrenForwarding(element),
      },
      hostElementRef: { solid: graph, element },
    }
  }

  // SolidJS Context providers (e.g., SomeContext.Provider) are transparent wrappers
  // that render children directly without adding DOM elements. When the root JSX
  // element is a provider, look through its children to find the actual host element.
  if (isContextProviderTag(element.tag)) {
    const children = ts.isJsxElement(node) ? node.children : []
    return resolveHostEntryFromJSXChildren(graph, children)
  }

  return {
    resolution: "deferred",
    innerTag: element.tag,
    filePath: graph.file,
    staticAttributes: collectStaticAttributes(element),
    staticClassTokens: getStaticClassTokensForElementEntity(graph, element),
    forwardsChildren: detectChildrenForwarding(element),
  }
}

/**
 * Checks if a JSX tag represents a SolidJS Context provider.
 *
 * Context providers (e.g., `SomeContext.Provider`) are transparent wrappers
 * that render children directly without adding DOM elements.
 */
function isContextProviderTag(tag: string): boolean {
  return tag.endsWith(".Provider")
}

/**
 * Resolves a host entry from the children of a transparent wrapper (context provider).
 *
 * Iterates through JSX children to find a single consistent host entry,
 * using the same logic as fragment resolution.
 */
function resolveHostEntryFromJSXChildren(graph: SolidGraph, children: readonly ts.JsxChild[]): ComponentHostEntry | null {
  let candidate: ComponentHostEntry | null = null

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    const resolved = resolveHostEntryFromJSXChild(graph, child)
    if (resolved === "ignore") continue
    if (resolved === null) return null
    if (candidate !== null) {
      if (!areComponentHostEntriesEqual(candidate, resolved)) return null
    }
    candidate = resolved
  }

  return candidate
}

function resolveHostEntryFromJSXFragment(graph: SolidGraph, node: ts.JsxFragment): ComponentHostEntry | null {
  return resolveHostEntryFromJSXChildren(graph, [...node.children])
}

function resolveHostEntryFromJSXChild(
  graph: SolidGraph,
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
    return resolveHostEntryFromJSXElement(graph, child)
  }

  if (!ts.isJsxFragment(child)) return null
  return resolveHostEntryFromJSXFragment(graph, child)
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

const MAX_CHILDREN_REFERENCE_QUEUE_SIZE = 512

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

function collectTopLevelVariableInitializers(graph: SolidGraph): ReadonlyMap<string, ts.Expression> {
  const out = new Map<string, ts.Expression>()

  for (let i = 0; i < graph.variables.length; i++) {
    const variable = graph.variables[i]
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

function collectImportBindingsByLocalName(graph: SolidGraph): ReadonlyMap<string, ImportBinding> {
  const out = new Map<string, ImportBinding>()

  for (let i = 0; i < graph.imports.length; i++) {
    const importEntity = graph.imports[i]
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

function collectTransparentPrimitiveNames(graph: SolidGraph): ReadonlySet<string> {
  const out = new Set<string>()

  for (let i = 0; i < graph.imports.length; i++) {
    const importEntity = graph.imports[i]
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

function collectExportsByName(graph: SolidGraph): ReadonlyMap<string, readonly ExportEntity[]> {
  const out = new Map<string, ExportEntity[]>()

  for (let i = 0; i < graph.exports.length; i++) {
    const exportEntity = graph.exports[i]
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

function areHostDescriptorsEqual(
  left: LayoutComponentHostDescriptor,
  right: LayoutComponentHostDescriptor,
): boolean {
  if (left.tagName !== right.tagName) return false
  if (left.forwardsChildren !== right.forwardsChildren) return false
  if (!areStringListsEqual(left.staticClassTokens, right.staticClassTokens)) return false
  return areAttributeMapsEqual(left.staticAttributes, right.staticAttributes)
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

/**
 * Merges static attributes from an outer component layer with those of an inner
 * component layer. Outer attributes take precedence (they are closer to the call site
 * and override what the inner component sets on its own root).
 */
function mergeStaticAttributes(
  outer: ReadonlyMap<string, string | null>,
  inner: ReadonlyMap<string, string | null>,
): ReadonlyMap<string, string | null> {
  if (inner.size === 0) return outer
  if (outer.size === 0) return inner

  const out = new Map<string, string | null>()

  for (const [name, value] of inner) {
    out.set(name, value)
  }

  for (const [name, value] of outer) {
    out.set(name, value)
  }

  return out
}

/**
 * Standard HTML element tag names used to validate polymorphic `as` prop values.
 * Only includes element names that produce concrete DOM elements (no MathML/SVG).
 */
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

/**
 * Extracts a tag name from the `as` prop in a component's static attributes.
 *
 * This handles the Kobalte/Polymorphic pattern where a component like
 * `<Polymorphic as="button" ...>` renders a `<button>` element at runtime.
 * The `as` prop must be a static string literal that is a valid HTML tag name.
 *
 * Returns null if no `as` prop exists, the value is dynamic, or the value
 * is not a recognized HTML tag name (e.g., a component reference).
 */
function resolveTagNameFromPolymorphicProp(
  staticAttributes: ReadonlyMap<string, string | null>,
): string | null {
  const asValue = staticAttributes.get("as")
  if (asValue === undefined || asValue === null) return null
  const normalized = asValue.toLowerCase()
  if (!HTML_TAG_NAMES.has(normalized)) return null
  return normalized
}

/**
 * Merges static class tokens from an outer component layer with those of an inner
 * component layer. Deduplicates tokens while preserving order (outer tokens first).
 */
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
