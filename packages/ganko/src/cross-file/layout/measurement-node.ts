import type { LayoutElementNode } from "./graph"
import type { LayoutSignalSnapshot } from "./signal-model"
import { isLayoutHidden } from "./signal-access"

interface MeasurementCandidateSet {
  readonly firstControlOrReplacedDescendant: LayoutElementNode | null
  readonly firstTextualDescendant: LayoutElementNode | null
}

const EMPTY_NODE_LIST: readonly LayoutElementNode[] = []

export function buildMeasurementNodeIndex(
  elements: readonly LayoutElementNode[],
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
): ReadonlyMap<string, LayoutElementNode> {
  const candidateCache = new Map<LayoutElementNode, MeasurementCandidateSet>()
  const measurementByRootKey = new Map<string, LayoutElementNode>()

  for (let i = 0; i < elements.length; i++) {
    const root = elements[i]
    if (!root) continue
    const candidates = resolveMeasurementCandidates(root, childrenByParentNode, snapshotByElementNode, candidateCache)
    const measurement = resolveMeasurementNode(root, candidates)
    measurementByRootKey.set(root.key, measurement)

  }

  return measurementByRootKey
}

/**
 * Determines whether an element establishes an independent formatting context,
 * which prevents baseline propagation from its descendants to its parent.
 *
 * Per CSS 2.1 §10.8.1 and CSS Display Level 3, baseline propagation follows the
 * first in-flow child's baseline recursively, but ONLY within the same formatting
 * context. Elements that establish a new block formatting context (BFC) terminate
 * this chain: their own box determines the alignment baseline, not their contents.
 *
 * BFC establishment occurs when any of these hold:
 *  - The element is a replaced element (intrinsic sizing, no baseline from children)
 *  - The computed `display` outer value is not `inline` (block, flex, grid, table, etc.)
 *  - The computed `display` is `inline-block` or `inline-table` (inline-level but BFC inside)
 *  - The computed `overflow` is not `visible` and not `clip`
 *  - The computed `display` is `flow-root`
 *
 * When no explicit `display` signal exists, the element's tag determines its inherent
 * display category. Block-level elements (`div`, `p`, `section`, table internals, etc.)
 * establish a BFC. Inline-level elements (`span`, `em`, `strong`, `a`, `b`, `i`, etc.)
 * are transparent to baseline propagation and do not.
 */
function establishesFormattingContext(
  node: LayoutElementNode,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
): boolean {
  if (node.isReplaced) return true

  const snapshot = snapshotByElementNode.get(node)
  if (snapshot) {
    const displaySignal = snapshot.signals.get("display")
    if (displaySignal && displaySignal.kind === "known") {
      return !isInlineLevelDisplay(displaySignal.normalized)
    }

    const overflowSignal = snapshot.signals.get("overflow")
    if (overflowSignal && overflowSignal.kind === "known") {
      const ov = overflowSignal.normalized
      if (ov !== "visible" && ov !== "clip") return true
    }

    const overflowYSignal = snapshot.signals.get("overflow-y")
    if (overflowYSignal && overflowYSignal.kind === "known") {
      const ov = overflowYSignal.normalized
      if (ov !== "visible" && ov !== "clip") return true
    }
  }

  return isInherentlyBlockLevel(node.tagName)
}

/**
 * Returns true when the normalized display value participates in the parent's inline
 * formatting context and is transparent to baseline propagation. All other display
 * values (block, flex, grid, table, inline-block, inline-flex, flow-root, etc.)
 * establish an independent formatting context internally.
 */
function isInlineLevelDisplay(normalized: string): boolean {
  const v = normalized.trim().toLowerCase()
  return v === "inline" || v === "contents"
}

const INHERENTLY_INLINE_TAGS = new Set([
  "a", "abbr", "acronym", "b", "bdo", "big", "br", "cite", "code",
  "dfn", "em", "i", "kbd", "label", "mark", "output", "q", "ruby",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time",
  "tt", "u", "var", "wbr", "data", "slot",
])

/**
 * When no explicit `display` CSS signal exists, determines whether a tag's UA default
 * display is inline-level. Returns true (block-level / BFC-establishing) for all tags
 * NOT in the inline set, including unknown/component tags. This is conservative:
 * unknown elements are treated as formatting-context boundaries, preventing
 * measurement-node recursion from crossing component abstractions.
 */
function isInherentlyBlockLevel(tagName: string | null): boolean {
  if (tagName === null) return true
  return !INHERENTLY_INLINE_TAGS.has(tagName)
}

function resolveMeasurementCandidates(
  root: LayoutElementNode,
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  cache: Map<LayoutElementNode, MeasurementCandidateSet>,
): MeasurementCandidateSet {
  const existing = cache.get(root)
  if (existing) return existing

  const children = childrenByParentNode.get(root) ?? EMPTY_NODE_LIST
  let firstControlOrReplacedDescendant: LayoutElementNode | null = null
  let firstTextualDescendant: LayoutElementNode | null = null

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue

    // Skip children that generate no boxes (display: none / hidden attribute).
    // These elements cannot contribute to baseline propagation or alignment.
    if (isLayoutHidden(child, snapshotByElementNode)) continue

    if (firstControlOrReplacedDescendant === null && (child.isControl || child.isReplaced)) {
      firstControlOrReplacedDescendant = child
    }

    if (firstTextualDescendant === null && child.textualContent === "yes") {
      firstTextualDescendant = child
    }

    if (firstControlOrReplacedDescendant !== null && firstTextualDescendant !== null) break
  }

  const firstChild = children.length === 1 ? children[0] : undefined
  if (firstChild && !establishesFormattingContext(firstChild, snapshotByElementNode)) {
    const childCandidates = resolveMeasurementCandidates(firstChild, childrenByParentNode, snapshotByElementNode, cache)
    if (firstControlOrReplacedDescendant === null) {
      firstControlOrReplacedDescendant = childCandidates.firstControlOrReplacedDescendant
    }
    if (firstTextualDescendant === null) {
      firstTextualDescendant = childCandidates.firstTextualDescendant
    }
  }

  const out: MeasurementCandidateSet = {
    firstControlOrReplacedDescendant,
    firstTextualDescendant,
  }
  cache.set(root, out)
  return out
}

function resolveMeasurementNode(root: LayoutElementNode, candidates: MeasurementCandidateSet): LayoutElementNode {
  if (candidates.firstControlOrReplacedDescendant !== null) return candidates.firstControlOrReplacedDescendant
  if (root.isControl || root.isReplaced) return root
  if (candidates.firstTextualDescendant !== null) return candidates.firstTextualDescendant
  if (root.textualContent === "yes") return root
  return root
}
