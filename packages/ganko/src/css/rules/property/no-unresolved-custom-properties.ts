import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { isBlank } from "@drskillissue/ganko-shared"

const messages = {
  unresolvedCustomProperty:
    "Custom property reference `{{name}}` is unresolved in `{{property}}`. Define it or provide a fallback value.",
} as const

export const noUnresolvedCustomProperties = defineCSSRule({
  id: "no-unresolved-custom-properties",
  severity: "error",
  messages,
  meta: {
    description: "Disallow unresolved custom property references.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    for (const ref of graph.unresolvedRefs) {
      if (ref.fallback && !isBlank(ref.fallback)) continue

      emitCSSDiagnostic(
        emit,
        ref.file.path,
        ref.declaration.startLine,
        ref.declaration.startColumn,
        noUnresolvedCustomProperties,
        "unresolvedCustomProperty",
        resolveMessage(messages.unresolvedCustomProperty, {
          name: ref.name,
          property: ref.declaration.property,
        }),
      )
    }
  },
})
