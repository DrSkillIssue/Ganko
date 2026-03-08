import {
  collectSignalSnapshot,
  readConditionalSignalDeltaFact,
  readElementsWithConditionalSignalDelta,
  readKnownNormalizedWithGuard,
} from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, hasAnyPositiveKnownPx } from "./rule-runtime"

const messages = {
  boxSizingToggleWithChrome:
    "Conditional `box-sizing` toggle on '{{tag}}' combines with non-zero padding/border, which can shift layout and trigger CLS.",
} as const

const BOX_SIZING_VALUES = new Set(["content-box", "border-box"])
const CHROME_PROPERTIES = [
  "padding-top",
  "padding-left",
  "padding-right",
  "padding-bottom",
  "border-top-width",
  "border-left-width",
  "border-right-width",
  "border-bottom-width",
] as const

export const cssLayoutBoxSizingToggleWithChrome = defineCrossRule({
  id: "css-layout-box-sizing-toggle-with-chrome",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conditional box-sizing mode toggles when box chrome contributes to geometry shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsWithConditionalSignalDelta(context.layout, "box-sizing")
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)

      const boxSizing = readKnownNormalizedWithGuard(snapshot, "box-sizing")
      if (!boxSizing || !BOX_SIZING_VALUES.has(boxSizing)) continue

      const boxSizingDelta = readConditionalSignalDeltaFact(context.layout, node, "box-sizing")
      if (!boxSizingDelta.hasConditional) continue
      if (!boxSizingDelta.hasDelta) continue
      if (!hasNonZeroChrome(snapshot)) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutBoxSizingToggleWithChrome.id, "boxSizingToggleWithChrome", messages.boxSizingToggleWithChrome, cssLayoutBoxSizingToggleWithChrome.severity)) continue
    }
  },
})

function hasNonZeroChrome(snapshot: ReturnType<typeof collectSignalSnapshot>): boolean {
  return hasAnyPositiveKnownPx(snapshot, CHROME_PROPERTIES)
}
