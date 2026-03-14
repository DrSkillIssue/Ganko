import {
  collectSignalSnapshot,
  readElementsWithConditionalSignalDelta,
  readConditionalSignalDeltaFact,
  readFlowParticipationFact,
  readKnownNormalizedWithGuard,
  LayoutSignalGuard,
} from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, hasAnyPositiveKnownPx, isFlowRelevantBySiblingsOrText } from "./rule-runtime"

const messages = {
  conditionalWhiteSpaceShift:
    "Conditional white-space '{{whiteSpace}}' on '{{tag}}' can reflow text and shift siblings; keep wrapping behavior stable or reserve geometry.",
} as const

const WRAP_SHIFT_VALUES = new Set(["nowrap", "pre"])
const INLINE_SIZE_PROPERTIES = ["width", "min-width"] as const
const BLOCK_SIZE_PROPERTIES = ["height", "min-height"] as const

export const cssLayoutConditionalWhiteSpaceWrapShift = defineCrossRule({
  id: "css-layout-conditional-white-space-wrap-shift",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional white-space wrapping mode toggles that can trigger CLS.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsWithConditionalSignalDelta(context.layout, "white-space")
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)

      const whiteSpace = readKnownNormalizedWithGuard(snapshot, "white-space")
      const whiteSpaceDelta = readConditionalSignalDeltaFact(context.layout, node, "white-space")
      if (!whiteSpaceDelta.hasConditional || !whiteSpaceDelta.hasDelta) continue
      if (!hasWrapShiftDelta(whiteSpaceDelta)) continue
      if (!whiteSpace) continue

      const whiteSpaceSignal = snapshot.signals.get("white-space")
      if (!whiteSpaceSignal || whiteSpaceSignal.guard !== LayoutSignalGuard.Conditional) continue
      const flow = readFlowParticipationFact(context.layout, node)
      if (!flow.inFlow) continue
      if (!isFlowRelevantBySiblingsOrText(node, snapshot.textualContent)) continue
      if (hasStableTextShell(snapshot)) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutConditionalWhiteSpaceWrapShift.id, "conditionalWhiteSpaceShift", messages.conditionalWhiteSpaceShift, cssLayoutConditionalWhiteSpaceWrapShift.severity, { whiteSpace })) continue
    }
  },
})

function hasStableTextShell(snapshot: ReturnType<typeof collectSignalSnapshot>): boolean {
  const stableInline = hasAnyPositiveKnownPx(snapshot, INLINE_SIZE_PROPERTIES)
  const stableBlock = hasAnyPositiveKnownPx(snapshot, BLOCK_SIZE_PROPERTIES)
  return stableInline && stableBlock
}

function hasWrapShiftDelta(delta: ReturnType<typeof readConditionalSignalDeltaFact>): boolean {
  for (let i = 0; i < delta.conditionalValues.length; i++) {
    const val = delta.conditionalValues[i]
    if (val && WRAP_SHIFT_VALUES.has(val)) return true
  }
  for (let i = 0; i < delta.unconditionalValues.length; i++) {
    const val = delta.unconditionalValues[i]
    if (val && WRAP_SHIFT_VALUES.has(val)) return true
  }
  return false
}
