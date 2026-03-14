import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { LAYOUT_POSITIONED_OFFSET_SIGNALS } from "../../css/layout-taxonomy"
import {
  collectSignalSnapshot,
  hasEffectivePosition,
  isEquivalentOffset,
  layoutOffsetSignals,
  LayoutSignalGuard,
  type LayoutGraph,
  type LayoutSignalName,
  type LayoutSignalSnapshot,
  readBaselineOffsetFacts,
  readConditionalSignalDeltaFact,
  readElementsWithConditionalOffsetDelta,
} from "../layout"
import type { LayoutElementNode } from "../layout"
import { defineCrossRule } from "../rule"
import { formatFixed, readNodeRef } from "./rule-runtime"

const messages = {
  conditionalOffsetShift:
    "Conditional style applies non-zero '{{property}}' offset ({{value}}), which can cause layout shifts when conditions toggle.",
} as const

export const cssLayoutConditionalOffsetShift = defineCrossRule({
  id: "css-layout-conditional-offset-shift",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional non-zero block-axis offsets that can trigger layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsWithConditionalOffsetDelta(context.layout)
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)
      const baselineBySignal = readBaselineOffsetFacts(context.layout, node)

      const matches = collectConditionalOffsets(context.layout, node, snapshot)
      if (matches.length === 0) continue

      const match = firstActionableOffset(snapshot, baselineBySignal, matches)
      if (!match) continue

      const ref = readNodeRef(context.layout, node)
      if (!ref) continue

      emit(
        createDiagnostic(
          ref.solid.file,
          ref.element.node,
          cssLayoutConditionalOffsetShift.id,
          "conditionalOffsetShift",
          resolveMessage(messages.conditionalOffsetShift, {
            property: match.property,
            value: `${formatFixed(match.value)}px`,
          }),
          "warn",
        ),
      )
    }
  },
})

function collectConditionalOffsets(
  layout: LayoutGraph,
  node: LayoutElementNode,
  snapshot: LayoutSignalSnapshot,
): readonly { property: (typeof layoutOffsetSignals)[number]; value: number; guardKey: string }[] {
  const out: { property: (typeof layoutOffsetSignals)[number]; value: number; guardKey: string }[] = []

  for (let i = 0; i < layoutOffsetSignals.length; i++) {
    const name = layoutOffsetSignals[i]
    if (!name) continue
    const delta = readConditionalSignalDeltaFact(layout, node, name)
    if (!delta.hasConditional || !delta.hasDelta) continue

    const signal = snapshot.signals.get(name)
    if (!signal) continue
    if (signal.guard.kind !== LayoutSignalGuard.Conditional) continue
    if (signal.kind !== "known") continue
    if (signal.px === null) continue
    if (Math.abs(signal.px) <= 0.25) continue
    out.push({ property: name, value: signal.px, guardKey: signal.guard.key })
  }

  return out
}

function firstActionableOffset(
  snapshot: LayoutSignalSnapshot,
  baselineBySignal: ReadonlyMap<LayoutSignalName, readonly number[]>,
  matches: readonly { property: (typeof layoutOffsetSignals)[number]; value: number; guardKey: string }[],
): { property: (typeof layoutOffsetSignals)[number]; value: number; guardKey: string } | null {
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match) continue
    if (LAYOUT_POSITIONED_OFFSET_SIGNALS.has(match.property) && !hasEffectivePositionForConditionalOffset(snapshot, match.guardKey)) {
      continue
    }
    if (hasStableBaseline(baselineBySignal, match.property, match.value)) continue
    return match
  }

  return null
}

function hasEffectivePositionForConditionalOffset(
  snapshot: LayoutSignalSnapshot,
  guardKey: string,
): boolean {
  if (hasEffectivePosition(snapshot)) return true

  const position = snapshot.signals.get("position")
  if (!position) return false
  if (position.kind !== "known") return false
  if (position.guard.kind !== LayoutSignalGuard.Conditional) return false
  if (position.guard.key !== guardKey) return false
  return position.normalized !== "static"
}

function hasStableBaseline(
  baselineBySignal: ReadonlyMap<LayoutSignalName, readonly number[]>,
  property: (typeof layoutOffsetSignals)[number],
  expectedPx: number,
): boolean {
  const values = baselineBySignal.get(property)
  if (!values) return false

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val === undefined) continue
    if (isEquivalentOffset(val, expectedPx)) return true
  }
  return false
}
