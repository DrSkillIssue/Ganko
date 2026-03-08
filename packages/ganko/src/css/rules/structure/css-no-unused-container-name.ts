import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  unusedContainer: "Container name `{{name}}` is declared but never queried.",
} as const

export const cssNoUnusedContainerName = defineCSSRule({
  id: "css-no-unused-container-name",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow unused named containers.",
    fixable: false,
    category: "css-structure",
  },
  options: {},
  check(graph, emit) {
    for (const [name, decls] of graph.unusedContainerNames) {
      const seen = new Set<string>()
      for (let i = 0; i < decls.length; i++) {
        const d = decls[i]
        if (!d) continue
        const key = `${d.file.path}:${d.startLine}:${d.startColumn}`
        if (seen.has(key)) continue
        seen.add(key)
        emitCSSDiagnostic(
          emit,
          d.file.path,
          d.startLine,
          d.startColumn,
          cssNoUnusedContainerName,
          "unusedContainer",
          resolveMessage(messages.unusedContainer, { name }),
        )
      }
    }
  },
})
