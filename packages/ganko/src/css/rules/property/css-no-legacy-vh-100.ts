import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  avoidLegacyVh: "Use 100dvh/100svh instead of `100vh` for mobile-safe viewport sizing.",
} as const

const LEGACY_VH_100 = /(^|\s|,)100vh($|\s|;|,)/

function hasLegacyVh(value: string): boolean {
  return LEGACY_VH_100.test(value)
}

export const cssNoLegacyVh100 = defineCSSRule({
  id: "css-no-legacy-vh-100",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow 100vh in viewport sizing declarations.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    const decls = graph.declarationsForProperties("height", "min-height", "max-height")
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (!d) continue
      if (!hasLegacyVh(d.value)) continue

      emitCSSDiagnostic(
        emit,
        d.file.path,
        d.startLine,
        d.startColumn,
        cssNoLegacyVh100,
        "avoidLegacyVh",
        resolveMessage(messages.avoidLegacyVh),
      )
    }
  },
})
