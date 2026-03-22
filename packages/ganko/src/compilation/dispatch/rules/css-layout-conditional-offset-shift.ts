import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { LAYOUT_POSITIONED_OFFSET_SIGNALS } from "../../../css/layout-taxonomy"
import { SignalValueKind } from "../../binding/signal-builder"
import { SignalGuardKind } from "../../binding/cascade-binder"
import type { SignalSnapshot, LayoutSignalName } from "../../binding/signal-builder"
import type { ConditionalSignalDelta } from "../../analysis/cascade-analyzer"
import { layoutOffsetSignals, type LayoutOffsetSignal } from "../../analysis/alignment"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  conditionalOffsetShift:
    "Conditional style applies non-zero '{{property}}' offset ({{value}}), which can cause layout shifts when conditions toggle.",
} as const

export const cssLayoutConditionalOffsetShift = defineAnalysisRule({
  id: "css-layout-conditional-offset-shift",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional non-zero block-axis offsets that can trigger layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.FullCascade },
  register(registry) {
    registry.registerConditionalDeltaAction((element, delta, semanticModel, emit) => {
      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      const baselineBySignal = semanticModel.getBaselineOffsets(element.elementId)

      const matches = collectConditionalOffsets(delta, snapshot)
      if (matches.length === 0) return

      const match = firstActionableOffset(snapshot, baselineBySignal, matches)
      if (!match) return

      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutConditionalOffsetShift.id,
          "conditionalOffsetShift",
          resolveMessage(messages.conditionalOffsetShift, {
            property: match.property,
            value: `${formatFixed(match.value)}px`,
          }),
          "warn",
        ),
      )
    })
  },
})

function collectConditionalOffsets(
  delta: ReadonlyMap<string, ConditionalSignalDelta>,
  snapshot: SignalSnapshot,
): readonly { property: LayoutOffsetSignal; value: number; guardKey: string }[] {
  const out: { property: LayoutOffsetSignal; value: number; guardKey: string }[] = []

  for (let i = 0; i < layoutOffsetSignals.length; i++) {
    const name = layoutOffsetSignals[i]
    if (!name) continue
    const offsetDelta = delta.get(name)
    if (!offsetDelta || !offsetDelta.hasConditional || !offsetDelta.hasDelta) continue

    const signal = snapshot.signals.get(name)
    if (!signal) continue
    if (signal.guard.kind !== SignalGuardKind.Conditional) continue
    if (signal.kind !== SignalValueKind.Known) continue
    if (signal.px === null) continue
    if (Math.abs(signal.px) <= 0.25) continue
    out.push({ property: name, value: signal.px, guardKey: signal.guard.key })
  }

  return out
}

function firstActionableOffset(
  snapshot: SignalSnapshot,
  baselineBySignal: ReadonlyMap<LayoutSignalName, readonly number[]> | null,
  matches: readonly { property: LayoutOffsetSignal; value: number; guardKey: string }[],
): { property: LayoutOffsetSignal; value: number; guardKey: string } | null {
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match) continue
    if (LAYOUT_POSITIONED_OFFSET_SIGNALS.has(match.property) && !hasEffectivePositionForConditionalOffset(snapshot, match.guardKey)) {
      continue
    }
    if (baselineBySignal !== null && hasStableBaseline(baselineBySignal, match.property, match.value)) continue
    return match
  }

  return null
}

function hasEffectivePositionForConditionalOffset(
  snapshot: SignalSnapshot,
  guardKey: string,
): boolean {
  const position = snapshot.signals.get("position")
  if (!position) return false
  if (position.kind !== SignalValueKind.Known) return false
  if (position.normalized !== "static") return true
  if (position.guard.kind !== SignalGuardKind.Conditional) return false
  if (position.guard.key !== guardKey) return false
  return position.normalized !== "static"
}

function hasStableBaseline(
  baselineBySignal: ReadonlyMap<LayoutSignalName, readonly number[]>,
  property: LayoutOffsetSignal,
  expectedPx: number,
): boolean {
  const values = baselineBySignal.get(property)
  if (!values) return false

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val === undefined) continue
    if (Math.abs(val - expectedPx) <= 0.25) return true
  }
  return false
}

function formatFixed(value: number, digits = 2): string {
  return value.toFixed(digits)
}
