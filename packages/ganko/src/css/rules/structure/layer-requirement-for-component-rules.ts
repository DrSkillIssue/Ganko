import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  missingLayer:
    "Rule `{{selector}}` is not inside any @layer block while this file uses @layer. Place component rules inside an explicit layer.",
} as const

export const layerRequirementForComponentRules = defineCSSRule({
  id: "layer-requirement-for-component-rules",
  severity: "warn",
  messages,
  meta: {
    description: "Require style rules to be inside @layer when the file defines layers.",
    fixable: false,
    category: "css-structure",
  },
  options: {},
  check(graph, emit) {
    if (graph.filesWithLayers.size === 0) return

    for (const rule of graph.rules) {
      if (!graph.filesWithLayers.has(rule.file.path)) continue
      if (rule.containingLayer) continue

      emitCSSDiagnostic(
        emit,
        rule.file.path,
        rule.startLine,
        rule.startColumn,
        layerRequirementForComponentRules,
        "missingLayer",
        resolveMessage(messages.missingLayer, {
          selector: rule.selectorText,
        }),
      )
    }
  },
})
