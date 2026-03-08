import type { CrossRuleContext } from "../rule"
import type { LayoutCascadedDeclaration } from "./graph"
import type { LayoutElementNode } from "./graph"
import type { LayoutPerfStatsMutable } from "./perf"
import type { LayoutSignalName, LayoutSignalSnapshot, LayoutSignalValue } from "./signal-model"
import { normalizeSignalMapWithCounts } from "./signal-normalization"

const INHERITED_SIGNAL_NAMES: readonly LayoutSignalName[] = [
  "font-size",
  "line-height",
  "writing-mode",
  "direction",
]

interface InheritedSignalsResult {
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownDelta: number
  readonly unknownDelta: number
  readonly conditionalDelta: number
}

export function collectSignalSnapshot(
  context: CrossRuleContext,
  node: LayoutElementNode,
): LayoutSignalSnapshot {
  const existing = context.layout.snapshotByElementNode.get(node)
  if (existing) {
    context.layout.perf.signalSnapshotCacheHits++
    return existing
  }

  throw new Error(`missing precomputed layout snapshot for ${node.key}`)
}

export function buildSignalSnapshotIndex(
  elements: readonly LayoutElementNode[],
  cascadeByElementNode: WeakMap<LayoutElementNode, ReadonlyMap<string, LayoutCascadedDeclaration>>,
  perf: LayoutPerfStatsMutable,
): WeakMap<LayoutElementNode, LayoutSignalSnapshot> {
  const snapshotByElementNode = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    if (!element) continue
    buildSnapshotForNode(element, cascadeByElementNode, snapshotByElementNode, perf)
  }

  return snapshotByElementNode
}

function buildSnapshotForNode(
  node: LayoutElementNode,
  cascadeByElementNode: WeakMap<LayoutElementNode, ReadonlyMap<string, LayoutCascadedDeclaration>>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  perf: LayoutPerfStatsMutable,
): LayoutSignalSnapshot {
  const existing = snapshotByElementNode.get(node)
  if (existing) {
    perf.signalSnapshotCacheHits++
    return existing
  }

  const raw = cascadeByElementNode.get(node)
  if (!raw) {
    throw new Error(`missing cascade map for ${node.key}`)
  }
  const normalized = normalizeSignalMapWithCounts(raw)
  const parent = node.parentElementNode
  const parentSnapshot = parent
    ? buildSnapshotForNode(parent, cascadeByElementNode, snapshotByElementNode, perf)
    : null
  const inherited = inheritSignalsFromParent(parentSnapshot, normalized.signals)
  const knownSignalCount = normalized.knownSignalCount + inherited.knownDelta
  const unknownSignalCount = normalized.unknownSignalCount + inherited.unknownDelta
  const conditionalSignalCount = normalized.conditionalSignalCount + inherited.conditionalDelta

  const snapshot: LayoutSignalSnapshot = {
    solidFile: node.solidFile,
    elementId: node.elementId,
    elementKey: node.key,
    tag: node.tag,
    textualContent: node.textualContent,
    isControl: node.isControl,
    isReplaced: node.isReplaced,
    signals: inherited.signals,
    knownSignalCount,
    unknownSignalCount,
    conditionalSignalCount,
  }

  snapshotByElementNode.set(node, snapshot)
  perf.signalSnapshotsBuilt++
  return snapshot
}

function inheritSignalsFromParent(
  parentSnapshot: LayoutSignalSnapshot | null,
  local: ReadonlyMap<LayoutSignalName, LayoutSignalValue>,
): InheritedSignalsResult {
  if (!parentSnapshot) {
    return {
      signals: local,
      knownDelta: 0,
      unknownDelta: 0,
      conditionalDelta: 0,
    }
  }

  let out: Map<LayoutSignalName, LayoutSignalValue> | null = null
  let knownDelta = 0
  let unknownDelta = 0
  let conditionalDelta = 0

  for (let i = 0; i < INHERITED_SIGNAL_NAMES.length; i++) {
    const signal = INHERITED_SIGNAL_NAMES[i]
    if (!signal) continue
    if (local.has(signal)) continue

    const inheritedValue = parentSnapshot.signals.get(signal)
    if (!inheritedValue) continue
    if (out === null) out = new Map(local)
    out.set(signal, inheritedValue)

    if (inheritedValue.guard === "conditional") {
      conditionalDelta++
      continue
    }

    if (inheritedValue.kind === "known") {
      knownDelta++
      continue
    }
    unknownDelta++
  }

  if (out === null) {
    return {
      signals: local,
      knownDelta: 0,
      unknownDelta: 0,
      conditionalDelta: 0,
    }
  }

  return {
    signals: out,
    knownDelta,
    unknownDelta,
    conditionalDelta,
  }
}
