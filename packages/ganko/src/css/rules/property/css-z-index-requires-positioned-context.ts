import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  zIndexNoContext: "`z-index` has no guaranteed effect without a positioned context.",
} as const

export const cssZIndexRequiresPositionedContext = defineCSSRule({
  id: "css-z-index-requires-positioned-context",
  severity: "warn",
  messages,
  meta: {
    description: "Require positioned context when using z-index.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    const zDecls = graph.declarationsByProperty.get("z-index")
    if (!zDecls) return

    for (let i = 0; i < zDecls.length; i++) {
      const zIndexDecl = zDecls[i]
      if (!zIndexDecl) continue
      if (zIndexDecl.value.trim() === "auto") continue
      const rule = zIndexDecl.rule
      if (!rule) continue

      const posDecls = rule.declarationIndex.get("position")
      if (!posDecls) continue
      const lastPos = posDecls[posDecls.length - 1]
      if (!lastPos) continue
      const positionValue = lastPos.value.trim().toLowerCase()

      if (positionValue !== "static") continue

      emitCSSDiagnostic(
        emit,
        zIndexDecl.file.path,
        zIndexDecl.startLine,
        zIndexDecl.startColumn,
        cssZIndexRequiresPositionedContext,
        "zIndexNoContext",
        resolveMessage(messages.zIndexNoContext),
      )
    }
  },
})
