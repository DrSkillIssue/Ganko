import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const map = new Map<string, string>([
  ["margin-left", "margin-inline-start"],
  ["margin-right", "margin-inline-end"],
  ["padding-left", "padding-inline-start"],
  ["padding-right", "padding-inline-end"],
  ["left", "inset-inline-start"],
  ["right", "inset-inline-end"],
])

const messages = {
  preferLogical: "Use logical property `{{logical}}` instead of `{{physical}}`.",
} as const

export const cssPreferLogicalProperties = defineCSSRule({
  id: "css-prefer-logical-properties",
  severity: "warn",
  messages,
  meta: {
    description: "Prefer logical properties over physical left/right properties.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    const decls = graph.declarationsForProperties(
      "margin-left", "margin-right", "padding-left", "padding-right", "left", "right",
    )
    for (let i = 0; i < decls.length; i++) {
      const d = decls[i]
      if (!d) continue
      const physical = d.property.toLowerCase()
      const logical = map.get(physical)
      if (!logical) continue

      emitCSSDiagnostic(
        emit,
        d.file.path,
        d.startLine,
        d.startColumn,
        cssPreferLogicalProperties,
        "preferLogical",
        resolveMessage(messages.preferLogical, { logical, physical }),
      )
    }
  },
})
