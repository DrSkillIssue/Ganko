import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  zIndexNoContext: "`z-index` has no guaranteed effect without a positioned context.",
} as const

export const cssZIndexRequiresPositionedContext = defineAnalysisRule({
  id: "css-z-index-requires-positioned-context",
  severity: "warn",
  messages,
  meta: { description: "Require positioned context when using z-index.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const zDecls = tree.declarationsByProperty.get("z-index")
      if (!zDecls) return
      for (let i = 0; i < zDecls.length; i++) {
        const zd = zDecls[i]
        if (!zd || zd.value.trim() === "auto") continue
        const rule = zd.rule
        if (!rule) continue
        const posDecls = rule.declarationIndex.get("position")
        if (!posDecls) continue
        const lastPos = posDecls[posDecls.length - 1]
        if (!lastPos || lastPos.value.trim().toLowerCase() !== "static") continue
        emit(createCSSDiagnostic(
          zd.file.path, zd.startLine, zd.startColumn,
          cssZIndexRequiresPositionedContext.id, "zIndexNoContext",
          resolveMessage(messages.zIndexNoContext), "warn",
        ))
      }
    })
  },
})
