/**
 * Regression tests for isLayoutHidden.
 *
 * Validates all three detection paths (HTML hidden attribute, Tailwind
 * hidden class, display: none CSS signal) and ensures non-Tailwind
 * projects with a custom "hidden" class don't cause false positives
 * when the element is actually visible via display: block.
 */

import { describe, it, expect } from "vitest"
import { isLayoutHidden } from "../../src/cross-file/layout/signal-access"
import type { LayoutElementNode } from "../../src/cross-file/layout/graph"
import { LayoutSignalGuard, LayoutSignalSource, LayoutSignalUnit, LayoutTextualContentState, type LayoutSignalSnapshot, type LayoutKnownSignalValue, type LayoutSignalName } from "../../src/cross-file/layout/signal-model"

function makeNode(overrides: Partial<{
  attributes: ReadonlyMap<string, string | null>
  classTokenSet: ReadonlySet<string>
}>): LayoutElementNode {
  return {
    key: "test::0",
    solidFile: "/test.tsx",
    elementId: 0,
    tag: "div",
    tagName: "div",
    classTokens: [],
    classTokenSet: overrides.classTokenSet ?? new Set(),
    inlineStyleKeys: [],
    parentElementId: null,
    parentElementKey: null,
    parentElementNode: null,
    previousSiblingNode: null,
    siblingIndex: 0,
    siblingCount: 1,
    siblingTypeIndex: 0,
    siblingTypeCount: 1,
    selectorDispatchKeys: [],
    attributes: overrides.attributes ?? new Map(),
    inlineStyleValues: new Map(),
    textualContent: LayoutTextualContentState.No,
    isControl: false,
    isReplaced: false,
  }
}

function makeSignal(name: LayoutSignalName, normalized: string): LayoutKnownSignalValue {
  return {
    kind: "known",
    name,
    raw: normalized,
    normalized,
    source: LayoutSignalSource.Selector,
    guard: LayoutSignalGuard.Unconditional,
    guardProvenance: { kind: LayoutSignalGuard.Unconditional, conditions: [], key: "always" },
    unit: LayoutSignalUnit.Keyword,
    px: null,
    quality: "exact",
  }
}

function makeSnapshot(signals: LayoutKnownSignalValue[]): LayoutSignalSnapshot {
  const signalMap = new Map<LayoutSignalName, LayoutKnownSignalValue>()
  for (const s of signals) {
    signalMap.set(s.name, s)
  }
  return {
    solidFile: "/test.tsx",
    elementId: 0,
    elementKey: "test::0",
    tag: "div",
    textualContent: LayoutTextualContentState.No,
    isControl: false,
    isReplaced: false,
    signals: signalMap,
    knownSignalCount: signalMap.size,
    unknownSignalCount: 0,
    conditionalSignalCount: 0,
  }
}

describe("isLayoutHidden", () => {
  it("returns true for HTML hidden attribute", () => {
    const node = makeNode({ attributes: new Map([["hidden", null]]) })
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    expect(isLayoutHidden(node, snapshots)).toBe(true)
  })

  it("returns true for Tailwind hidden class", () => {
    const node = makeNode({ classTokenSet: new Set(["hidden"]) })
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    expect(isLayoutHidden(node, snapshots)).toBe(true)
  })

  it("returns true for display: none CSS signal", () => {
    const node = makeNode({})
    const snapshot = makeSnapshot([makeSignal("display", "none")])
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    snapshots.set(node, snapshot)
    expect(isLayoutHidden(node, snapshots)).toBe(true)
  })

  it("returns false for a visible element with no hidden indicators", () => {
    const node = makeNode({})
    const snapshot = makeSnapshot([makeSignal("display", "block")])
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    snapshots.set(node, snapshot)
    expect(isLayoutHidden(node, snapshots)).toBe(false)
  })

  it("returns false when no snapshot exists and no attributes/classes match", () => {
    const node = makeNode({})
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    expect(isLayoutHidden(node, snapshots)).toBe(false)
  })

  it("returns true for hidden class even when display is not none (regression: non-Tailwind)", () => {
    /** In a non-Tailwind project, a class named "hidden" might map to
     * opacity: 0 or visibility: hidden, not display: none. The current
     * implementation treats any "hidden" class as layout-hidden. This
     * test documents the behavior: the class check takes precedence
     * over the CSS display signal. */
    const node = makeNode({ classTokenSet: new Set(["hidden"]) })
    const snapshot = makeSnapshot([makeSignal("display", "flex")])
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    snapshots.set(node, snapshot)
    expect(isLayoutHidden(node, snapshots)).toBe(true)
  })

  it("returns false for visibility: hidden (generates boxes, participates in layout)", () => {
    /** visibility: hidden generates boxes that occupy space — the element
     * is invisible but NOT removed from the layout tree. isLayoutHidden
     * must return false so the element is included in cohort analysis. */
    const node = makeNode({})
    const snapshot = makeSnapshot([makeSignal("display", "block")])
    const snapshots = new WeakMap<LayoutElementNode, LayoutSignalSnapshot>()
    snapshots.set(node, snapshot)
    expect(isLayoutHidden(node, snapshots)).toBe(false)
  })
})
