import { defineCrossRule } from "../rule"
import { collectSignalSnapshot, readKnownNormalized, readScrollContainerElements, readScrollContainerFact, LayoutScrollAxis } from "../layout"
import { emitLayoutDiagnostic } from "./rule-runtime"

const messages = {
  missingScrollbarGutter:
    "Scrollable container '{{tag}}' uses overflow auto/scroll without `scrollbar-gutter: stable`, which can trigger CLS when scrollbars appear.",
} as const

export const cssLayoutScrollbarGutterInstability = defineCrossRule({
  id: "css-layout-scrollbar-gutter-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable scrollbar gutters for scrollable containers to reduce layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readScrollContainerElements(context.layout)
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)
      const scroll = readScrollContainerFact(context.layout, node)
      if (!scroll.isScrollContainer) continue
      if (scroll.axis !== LayoutScrollAxis.Y && scroll.axis !== LayoutScrollAxis.Both) continue

      // scrollbar-width: none means no scrollbar is rendered, so no CLS from scrollbar appearance
      const scrollbarWidth = readKnownNormalized(snapshot, "scrollbar-width")
      if (scrollbarWidth === "none") continue

      const gutter = readKnownNormalized(snapshot, "scrollbar-gutter")
      if (gutter !== null && gutter.startsWith("stable")) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutScrollbarGutterInstability.id, "missingScrollbarGutter", messages.missingScrollbarGutter, cssLayoutScrollbarGutterInstability.severity)) continue
    }
  },
})
