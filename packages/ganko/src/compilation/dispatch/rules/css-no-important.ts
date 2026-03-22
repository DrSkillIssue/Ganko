import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import type { DeclarationEntity } from "../../../css/entities/declaration"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  avoidImportant: "Avoid `!important` on `{{property}}`. It increases override cost and usually signals specificity debt.",
} as const

function isSystemLevelOverride(decl: DeclarationEntity): boolean {
  const rule = decl.rule
  if (!rule) return false
  for (let i = 0; i < rule.containingMediaStack.length; i++) {
    const media = rule.containingMediaStack[i]
    if (!media) continue
    const params = media.params.toLowerCase()
    if (params.includes("prefers-reduced-motion") || params.includes("prefers-contrast") || params.includes("prefers-color-scheme") || params.includes("forced-colors") || params.includes("hover:") || params.includes("hover :") || params.includes("pointer:") || params.includes("pointer :")) return true
  }
  if (rule.selectorText.toLowerCase().includes("[hidden]")) return true
  return false
}

export const cssNoImportant = defineAnalysisRule({
  id: "no-important",
  severity: "warn",
  messages,
  meta: { description: "Disallow !important declarations.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      for (let i = 0; i < tree.declarations.length; i++) {
        const decl = tree.declarations[i]
        if (!decl) continue
        if (!hasFlag(decl._flags, DECL_IS_IMPORTANT) && !decl.node.important) continue
        if (isSystemLevelOverride(decl)) continue
        emit(createDiagnosticFromLoc(decl.file.path, { start: { line: decl.startLine, column: decl.startColumn }, end: { line: decl.startLine, column: decl.startColumn + 1 } }, cssNoImportant.id, "avoidImportant", resolveMessage(messages.avoidImportant, { property: decl.property }), "warn"))
      }
    })
  },
})
