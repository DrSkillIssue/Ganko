import {
  collectSignalSnapshot,
  readElementsWithConditionalSignalDelta,
  readFlowParticipationFact,
  readKnownNormalizedWithGuard,
  readReservedSpaceFact,
} from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, isFlowRelevantBySiblingsOrText } from "./rule-runtime"

const messages = {
  conditionalDisplayCollapse:
    "Conditional display sets '{{display}}' on '{{tag}}' without stable reserved space, which can collapse/expand layout and cause CLS.",
} as const

const COLLAPSING_DISPLAYS = new Set(["none", "contents"])

export const cssLayoutConditionalDisplayCollapse = defineCrossRule({
  id: "css-layout-conditional-display-collapse",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional display collapse in flow without reserved geometry.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsWithConditionalSignalDelta(context.layout, "display")
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)

      const display = readKnownNormalizedWithGuard(snapshot, "display")
      if (!display || !COLLAPSING_DISPLAYS.has(display)) continue

      const displaySignal = snapshot.signals.get("display")
      if (!displaySignal || displaySignal.guard !== "conditional") continue
      const flow = readFlowParticipationFact(context.layout, node)
      if (!flow.inFlow) continue
      if (!isFlowRelevantBySiblingsOrText(node, snapshot.textualContent)) continue
      const reservedSpace = readReservedSpaceFact(context.layout, node)
      if (reservedSpace.hasReservedSpace) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutConditionalDisplayCollapse.id, "conditionalDisplayCollapse", messages.conditionalDisplayCollapse, cssLayoutConditionalDisplayCollapse.severity, { display })) continue
    }
  },
})
