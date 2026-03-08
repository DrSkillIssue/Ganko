import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"
import { parseContainerQueryName } from "../../parser/value-util"

const messages = {
  unknownContainer: "Unknown container name `{{name}}` in @container query.",
} as const

export const cssNoUnknownContainerName = defineCSSRule({
  id: "css-no-unknown-container-name",
  severity: "error",
  messages,
  meta: {
    description: "Disallow unknown named containers in @container queries.",
    fixable: false,
    category: "css-structure",
  },
  options: {},
  check(graph, emit) {
    for (let i = 0; i < graph.unknownContainerQueries.length; i++) {
      const at = graph.unknownContainerQueries[i]
      if (!at) continue
      const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params)
      if (!name) continue

      emitCSSDiagnostic(
        emit,
        at.file.path,
        at.startLine,
        1,
        cssNoUnknownContainerName,
        "unknownContainer",
        resolveMessage(messages.unknownContainer, { name }),
      )
    }
  },
})
