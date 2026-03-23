import type { SolidSyntaxTree } from "../core/solid-syntax-tree"
import type { StyleCompilation } from "../core/compilation"
import type { SymbolTable } from "../symbols/symbol-table"
import type { ClassNameSymbol } from "../symbols/class-name"
import type { SelectorSymbol } from "../symbols/selector"
import type { CustomPropertySymbol } from "../symbols/custom-property"
import type { ComponentHostSymbol } from "../symbols/component-host"
import type { DependencyGraph } from "../incremental/dependency-graph"
import type { VariableEntity } from "../../solid/entities/variable"
import type { ComputationEntity, DependencyEdge } from "../../solid/entities/computation"
import type { ImportEntity } from "../../solid/entities/import"
import type { VariableReferenceEntity } from "../../css/entities/variable"
import type { RuleEntity } from "../../css/entities/rule"
import type { ElementNode } from "./element-builder"
import { buildElementNodes } from "./element-builder"
import type { ElementCascade, MonitoredDeclaration, SelectorMatch } from "./cascade-binder"
import { bind, computeLayoutFact, getOrBuildBindState } from "./cascade-binder"
import { buildScopedSelectorIndex } from "./scope-resolver"
import type { SignalSnapshot, LayoutSignalName } from "./signal-builder"
import { buildSignalSnapshot, SignalValueKind } from "./signal-builder"
import type { ScopedSelectorIndex } from "./scope-resolver"
import type { LayoutFactKind, LayoutFactMap } from "../analysis/layout-fact"
import { computeScrollContainerFact } from "../analysis/layout-fact"
import type { ConditionalSignalDelta } from "../analysis/cascade-analyzer"
import { computeConditionalDelta, type ConditionalDeltaIndex } from "../analysis/cascade-analyzer"
import type { AlignmentContext, CohortStats, SnapshotHotSignals } from "../analysis/alignment"
import { createAlignmentContextForParent, buildCohortIndex, computeHotSignals, buildMeasurementNodeIndex, finalizeTableCellBaselineRelevance } from "../analysis/alignment"
import type { StatefulSelectorEntry, NormalizedRuleDeclaration } from "../analysis/statefulness"
import { buildStatefulRuleIndexes, type StatefulRuleIndexes } from "../analysis/statefulness"

// ── Types owned by semantic-model ────────────────────────────────────────

export interface CustomPropertyResolution {
  readonly resolved: boolean
  readonly symbol: CustomPropertySymbol | null
  readonly value: string | null
  readonly unresolvedReferences: readonly VariableReferenceEntity[]
}

export type ReactiveKind = "signal" | "props" | "store" | "resource" | "memo" | "derived"

// ── FileSemanticModel interface ──────────────────────────────────────────

export interface FileSemanticModel {
  readonly filePath: string
  readonly compilation: StyleCompilation
  readonly solidTree: SolidSyntaxTree

  getElementNode(elementId: number): ElementNode | null
  getElementNodes(): readonly ElementNode[]
  getElementCascade(elementId: number): ElementCascade
  getMatchingSelectors(elementId: number): readonly SelectorMatch[]
  getComponentHost(importSource: string, exportName: string): ComponentHostSymbol | null
  getElementsByTagName(tag: string): readonly ElementNode[]
  getLayoutFact<K extends LayoutFactKind>(elementId: number, factKind: K): LayoutFactMap[K]

  getSignalSnapshot(elementId: number): SignalSnapshot
  getConditionalDelta(elementId: number): ReadonlyMap<string, ConditionalSignalDelta> | null
  getBaselineOffsets(elementId: number): ReadonlyMap<LayoutSignalName, readonly number[]> | null

  getClassNameInfo(name: string): ClassNameSymbol | null
  getCustomPropertyResolution(name: string): CustomPropertyResolution
  getSelectorOverrides(selectorId: number): readonly SelectorSymbol[]

  getScopedCSSFiles(): readonly string[]
  getScopedSelectors(): ScopedSelectorIndex
  getImportChain(): readonly ImportEntity[]

  getReactiveKind(variable: VariableEntity): ReactiveKind | null
  getDependencyEdges(computation: ComputationEntity): readonly DependencyEdge[]

  getAlignmentContext(parentElementId: number): AlignmentContext | null
  getCohortStats(parentElementId: number): CohortStats | null

  getElementsWithConditionalDelta(signal: string): readonly ElementNode[]
  getScrollContainerElements(): readonly ElementNode[]
  getDynamicSlotCandidates(): readonly ElementNode[]
  getElementsByKnownSignalValue(signal: LayoutSignalName, value: string): readonly ElementNode[]

  getStatefulSelectorEntries(ruleId: number): readonly StatefulSelectorEntry[]
  getStatefulNormalizedDeclarations(ruleId: number): readonly NormalizedRuleDeclaration[]
  getStatefulBaseValueIndex(): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
}

// ── Factory ──────────────────────────────────────────────────────────────

const EMPTY_SCOPED_INDEX: ScopedSelectorIndex = {
  byDispatchKey: new Map(),
  byTagName: new Map(),
  requirements: { needsClassTokens: false, needsAttributes: false },
}

export function createFileSemanticModel(
  solidTree: SolidSyntaxTree,
  symbolTable: SymbolTable,
  dependencyGraph: DependencyGraph,
  compilation: StyleCompilation,
): FileSemanticModel {
  const filePath = solidTree.filePath

  let cachedCSSScope: readonly string[] | null = null
  let cachedScopedSelectors: ScopedSelectorIndex | null = null
  let cachedElementNodes: readonly ElementNode[] | null = null
  let cachedElementNodeById: Map<number, ElementNode> | null = null
  const cachedCascadeByElementId = new Map<number, ElementCascade>()

  // Phase 7 caches
  let cachedSnapshotByElementId: Map<number, SignalSnapshot> | null = null
  let cachedConditionalDeltaIndex: ConditionalDeltaIndex | null = null
  let cachedContextByParentId: Map<number, AlignmentContext> | null = null
  let cachedCohortStatsByParentId: ReadonlyMap<number, CohortStats> | null = null
  let cachedStatefulIndexes: StatefulRuleIndexes | null = null
  let cachedHotSignalsByElementId: Map<number, SnapshotHotSignals> | null = null

  function ensureSnapshotIndex(model: FileSemanticModel): Map<number, SignalSnapshot> {
    if (cachedSnapshotByElementId !== null) return cachedSnapshotByElementId
    const elements = model.getElementNodes()
    const snapshotById = new Map<number, SignalSnapshot>()

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (!el) continue
      const cascade = model.getElementCascade(el.elementId)
      const parentSnapshot = el.parentElementNode
        ? snapshotById.get(el.parentElementNode.elementId) ?? null
        : null
      const snapshot = buildSignalSnapshot(el.elementId, cascade, parentSnapshot)
      snapshotById.set(el.elementId, snapshot)
    }
    cachedSnapshotByElementId = snapshotById
    return snapshotById
  }

  function ensureHotSignals(model: FileSemanticModel): Map<number, SnapshotHotSignals> {
    if (cachedHotSignalsByElementId !== null) return cachedHotSignalsByElementId
    const snapshotIndex = ensureSnapshotIndex(model)
    const out = new Map<number, SnapshotHotSignals>()
    for (const [id, snapshot] of snapshotIndex) {
      out.set(id, computeHotSignals(snapshot))
    }
    cachedHotSignalsByElementId = out
    return out
  }

  function ensureConditionalDeltaIndex(model: FileSemanticModel): ConditionalDeltaIndex {
    if (cachedConditionalDeltaIndex !== null) return cachedConditionalDeltaIndex
    const elements = model.getElementNodes()
    const cascadeByElementId = new Map<number, ElementCascade>()
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (!el) continue
      cascadeByElementId.set(el.elementId, model.getElementCascade(el.elementId))
    }

    // Get monitored declarations from cascade-binder's bind state
    const bindState = getBindMonitoredDeclarations()
    cachedConditionalDeltaIndex = computeConditionalDelta(elements, cascadeByElementId, bindState, symbolTable)
    return cachedConditionalDeltaIndex
  }

  function getBindMonitoredDeclarations(): ReadonlyMap<number, readonly MonitoredDeclaration[]> {
    return getOrBuildBindState(symbolTable).monitoredDeclarationsBySelectorId
  }

  function ensureContextIndex(model: FileSemanticModel): Map<number, AlignmentContext> {
    if (cachedContextByParentId !== null) return cachedContextByParentId
    const elements = model.getElementNodes()
    const snapshotIndex = ensureSnapshotIndex(model)
    const childrenByParentId = buildChildrenByParentId(elements)
    const out = new Map<number, AlignmentContext>()

    for (const [parentId, children] of childrenByParentId) {
      if (children.length < 2) continue
      const snapshot = snapshotIndex.get(parentId)
      if (!snapshot) continue
      const parent = cachedElementNodeById?.get(parentId)
      if (!parent) continue
      out.set(parentId, createAlignmentContextForParent(parent, snapshot))
    }

    cachedContextByParentId = out
    return out
  }

  function ensureCohortStats(model: FileSemanticModel): ReadonlyMap<number, CohortStats> {
    if (cachedCohortStatsByParentId !== null) return cachedCohortStatsByParentId
    const elements = model.getElementNodes()
    const snapshotIndex = ensureSnapshotIndex(model)
    const hotSignals = ensureHotSignals(model)
    const childrenByParentId = buildChildrenByParentId(elements)
    const contextByParentId = ensureContextIndex(model)
    const measurementNodeByRootKey = buildMeasurementNodeIndex(elements, childrenByParentId, snapshotIndex)

    const cohortIndex = buildCohortIndex({
      childrenByParentId,
      contextByParentId,
      measurementNodeByRootKey,
      snapshotByElementId: snapshotIndex,
      hotSignalsByElementId: hotSignals,
    })

    finalizeTableCellBaselineRelevance(contextByParentId, cohortIndex.verticalAlignConsensusByParentId)
    cachedCohortStatsByParentId = cohortIndex.statsByParentId
    return cohortIndex.statsByParentId
  }

  function ensureStatefulIndexes(): StatefulRuleIndexes {
    if (cachedStatefulIndexes !== null) return cachedStatefulIndexes
    // Collect all CSS rules from the symbol table's selectors
    const rulesSeen = new Set<number>()
    const rules: RuleEntity[] = []
    for (const [, selector] of symbolTable.selectors) {
      const rule = selector.entity.rule
      if (rulesSeen.has(rule.id)) continue
      rulesSeen.add(rule.id)
      rules.push(rule)
    }
    cachedStatefulIndexes = buildStatefulRuleIndexes(rules)
    return cachedStatefulIndexes
  }

  function buildChildrenByParentId(elements: readonly ElementNode[]): Map<number, ElementNode[]> {
    const out = new Map<number, ElementNode[]>()
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (!el) continue
      const parent = el.parentElementNode
      if (!parent) continue
      let bucket = out.get(parent.elementId)
      if (!bucket) { bucket = []; out.set(parent.elementId, bucket) }
      bucket.push(el)
    }
    return out
  }

  const reactiveVariables = solidTree.reactiveVariables
  const VALID_REACTIVE_KINDS = new Map<string, ReactiveKind>([
    ["signal", "signal"], ["props", "props"], ["store", "store"],
    ["resource", "resource"], ["memo", "memo"], ["derived", "derived"],
  ])
  const reactiveKindByVariableId = new Map<number, ReactiveKind>()
  for (let i = 0; i < reactiveVariables.length; i++) {
    const v = reactiveVariables[i]
    if (!v) continue
    if (v.reactiveKind !== null) {
      const validated = VALID_REACTIVE_KINDS.get(v.reactiveKind)
      if (validated !== undefined) reactiveKindByVariableId.set(v.id, validated)
    }
  }

  const edges = solidTree.dependencyEdges
  const edgesByConsumerId = new Map<number, DependencyEdge[]>()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!edge) continue
    const consumerId = edge.consumer.id
    let bucket = edgesByConsumerId.get(consumerId)
    if (bucket === undefined) {
      bucket = []
      edgesByConsumerId.set(consumerId, bucket)
    }
    bucket.push(edge)
  }

  const EMPTY_EDGES: readonly DependencyEdge[] = []

  return {
    filePath,
    compilation,
    solidTree,

    // ── Tier 0-1: Symbol queries ───────────────────────────────────────

    getClassNameInfo(name: string): ClassNameSymbol | null {
      return symbolTable.getClassName(name)
    },

    getCustomPropertyResolution(name: string): CustomPropertyResolution {
      const symbol = symbolTable.getCustomProperty(name)
      return {
        resolved: symbol !== null,
        symbol,
        value: symbol !== null ? symbol.resolvedValue : null,
        unresolvedReferences: [],
      }
    },

    getSelectorOverrides(_selectorId: number): readonly SelectorSymbol[] {
      return [] // Phase 6
    },

    // ── Tier 0-1: Scope queries ────────────────────────────────────────

    getScopedCSSFiles(): readonly string[] {
      if (cachedCSSScope !== null) return cachedCSSScope
      cachedCSSScope = dependencyGraph.getCSSScope(filePath)
      return cachedCSSScope
    },

    getScopedSelectors(): ScopedSelectorIndex {
      if (cachedScopedSelectors !== null) return cachedScopedSelectors

      const scopedFiles = this.getScopedCSSFiles()
      if (scopedFiles.length === 0) {
        cachedScopedSelectors = EMPTY_SCOPED_INDEX
        return cachedScopedSelectors
      }

      cachedScopedSelectors = buildScopedSelectorIndex(scopedFiles, symbolTable)
      return cachedScopedSelectors
    },

    getImportChain(): readonly ImportEntity[] {
      return solidTree.imports
    },

    // ── Tier 0-1: Reactive queries ─────────────────────────────────────

    getReactiveKind(variable: VariableEntity): ReactiveKind | null {
      return reactiveKindByVariableId.get(variable.id) ?? null
    },

    getDependencyEdges(computation: ComputationEntity): readonly DependencyEdge[] {
      return edgesByConsumerId.get(computation.id) ?? EMPTY_EDGES
    },

    // ── Tier 2-3: Element + cascade queries ────────────────────────────

    getElementNode(elementId: number): ElementNode | null {
      const nodes = this.getElementNodes()
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node && node.elementId === elementId) return node
      }
      return null
    },

    getElementNodes(): readonly ElementNode[] {
      if (cachedElementNodes !== null) return cachedElementNodes
      cachedElementNodes = buildElementNodes(solidTree, this.compilation)
      cachedElementNodeById = new Map()
      for (let i = 0; i < cachedElementNodes.length; i++) {
        const node = cachedElementNodes[i]
        if (node) cachedElementNodeById.set(node.elementId, node)
      }
      return cachedElementNodes
    },

    getElementCascade(elementId: number): ElementCascade {
      const cached = cachedCascadeByElementId.get(elementId)
      if (cached !== undefined) return cached

      const element = cachedElementNodeById?.get(elementId) ?? this.getElementNode(elementId)
      if (element === null) {
        const empty: ElementCascade = { elementId, declarations: new Map(), edges: [] }
        cachedCascadeByElementId.set(elementId, empty)
        return empty
      }

      const scopedSelectors = this.getScopedSelectors()
      const cascade = bind(element, scopedSelectors, symbolTable)
      cachedCascadeByElementId.set(elementId, cascade)
      return cascade
    },

    getMatchingSelectors(elementId: number): readonly SelectorMatch[] {
      return this.getElementCascade(elementId).edges
    },

    getComponentHost(_importSource: string, _exportName: string): ComponentHostSymbol | null {
      return symbolTable.componentHosts.get(`${_importSource}::${_exportName}`) ?? null
    },

    getElementsByTagName(tag: string): readonly ElementNode[] {
      const nodes = this.getElementNodes()
      const out: ElementNode[] = []
      const lowerTag = tag.toLowerCase()
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node && node.tagName === lowerTag) out.push(node)
      }
      return out
    },

    getLayoutFact<K extends LayoutFactKind>(elementId: number, factKind: K): LayoutFactMap[K] {
      const cascade = this.getElementCascade(elementId)
      const allElements = this.getElementNodes()
      return computeLayoutFact(
        factKind,
        elementId,
        cascade.declarations,
        allElements,
        (id) => this.getElementCascade(id).declarations,
      )
    },

    // ── Tier 4-5: Signal + fact + alignment queries ────────────────────

    getSignalSnapshot(elementId: number): SignalSnapshot {
      const index = ensureSnapshotIndex(this)
      const snapshot = index.get(elementId)
      if (!snapshot) throw new Error(`No signal snapshot for element ${elementId}`)
      return snapshot
    },

    getConditionalDelta(elementId: number): ReadonlyMap<string, ConditionalSignalDelta> | null {
      const index = ensureConditionalDeltaIndex(this)
      return index.deltaByElementId.get(elementId) ?? null
    },

    getBaselineOffsets(elementId: number): ReadonlyMap<LayoutSignalName, readonly number[]> | null {
      const index = ensureConditionalDeltaIndex(this)
      return index.baselineOffsetsByElementId.get(elementId) ?? null
    },

    getAlignmentContext(parentElementId: number): AlignmentContext | null {
      const contexts = ensureContextIndex(this)
      return contexts.get(parentElementId) ?? null
    },

    getCohortStats(parentElementId: number): CohortStats | null {
      const stats = ensureCohortStats(this)
      return stats.get(parentElementId) ?? null
    },

    getElementsWithConditionalDelta(signal: string): readonly ElementNode[] {
      const index = ensureConditionalDeltaIndex(this)
      return index.elementsWithDeltaBySignal.get(signal as LayoutSignalName) ?? []
    },

    getScrollContainerElements(): readonly ElementNode[] {
      const elements = this.getElementNodes()
      const snapshotIndex = ensureSnapshotIndex(this)
      const out: ElementNode[] = []
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (!el) continue
        const snapshot = snapshotIndex.get(el.elementId)
        if (!snapshot) continue
        const fact = computeScrollContainerFact(snapshot)
        if (fact.isScrollContainer) out.push(el)
      }
      return out
    },

    getDynamicSlotCandidates(): readonly ElementNode[] {
      const elements = this.getElementNodes()
      const out: ElementNode[] = []
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (!el) continue
        if (el.tagName === "slot") out.push(el)
      }
      return out
    },

    getElementsByKnownSignalValue(signal: LayoutSignalName, value: string): readonly ElementNode[] {
      const elements = this.getElementNodes()
      const snapshotIndex = ensureSnapshotIndex(this)
      const out: ElementNode[] = []
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (!el) continue
        const snapshot = snapshotIndex.get(el.elementId)
        if (!snapshot) continue
        const sv = snapshot.signals.get(signal)
        if (!sv || sv.kind !== SignalValueKind.Known) continue
        if (sv.normalized === value) out.push(el)
      }
      return out
    },

    getStatefulSelectorEntries(ruleId: number): readonly StatefulSelectorEntry[] {
      const indexes = ensureStatefulIndexes()
      return indexes.selectorEntriesByRuleId.get(ruleId) ?? []
    },

    getStatefulNormalizedDeclarations(ruleId: number): readonly NormalizedRuleDeclaration[] {
      const indexes = ensureStatefulIndexes()
      return indexes.normalizedDeclarationsByRuleId.get(ruleId) ?? []
    },

    getStatefulBaseValueIndex(): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
      const indexes = ensureStatefulIndexes()
      return indexes.baseValueIndex
    },
  }
}
