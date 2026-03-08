import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  hardcodedZ: "Use a z-index token variable instead of literal `{{value}}`.",
} as const

const DIGITS_ONLY = /^[0-9]+$/

function isHardcodedPositive(value: string): boolean {
  const t = value.trim()
  if (t.includes("var(")) return false
  if (!DIGITS_ONLY.test(t)) return false
  return Number(t) > 0
}

export const cssNoHardcodedZIndex = defineCSSRule({
  id: "css-no-hardcoded-z-index",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow hardcoded positive z-index literals.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    const decls = graph.declarationsByProperty.get("z-index")
    if (!decls) return
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (!d) continue
      if (!isHardcodedPositive(d.value)) continue
      emitCSSDiagnostic(
        emit,
        d.file.path,
        d.startLine,
        d.startColumn,
        cssNoHardcodedZIndex,
        "hardcodedZ",
        resolveMessage(messages.hardcodedZ, { value: d.value.trim() }),
      )
    }
  },
})
