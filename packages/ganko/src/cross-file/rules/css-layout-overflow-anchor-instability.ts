import {
  readElementsByKnownSignalValue,
  readFlowParticipationFact,
  readScrollContainerFact,
} from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, isDynamicContainerLike } from "./rule-runtime"

const messages = {
  unstableOverflowAnchor:
    "Element '{{tag}}' sets `overflow-anchor: none` on a {{context}} container; disabling scroll anchoring can amplify visible layout shifts.",
} as const

export const cssLayoutOverflowAnchorInstability = defineCrossRule({
  id: "css-layout-overflow-anchor-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow overflow-anchor none on dynamic or scrollable containers prone to visible layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsByKnownSignalValue(context.layout, "overflow-anchor", "none")
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue

      const flow = readFlowParticipationFact(context.layout, node)
      if (!flow.inFlow) continue

      const scroll = readScrollContainerFact(context.layout, node)
      const isScrollable = scroll.isScrollContainer
      const isDynamicContainer = isDynamicContainerLike(node)
      if (!isScrollable && !isDynamicContainer) continue

      const containerContext = isScrollable ? "scrollable" : "dynamic"
      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutOverflowAnchorInstability.id, "unstableOverflowAnchor", messages.unstableOverflowAnchor, cssLayoutOverflowAnchorInstability.severity, { context: containerContext })) continue
    }
  },
})
