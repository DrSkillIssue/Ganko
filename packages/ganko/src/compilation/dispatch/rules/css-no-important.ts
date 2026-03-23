import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import type { DeclarationEntity } from "../../../css/entities/declaration"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  avoidImportant: "Avoid `!important` on `{{property}}`. It increases override cost and usually signals specificity debt.",
} as const

const SYSTEM_LEVEL_MEDIA_RE = /prefers-reduced-motion|prefers-contrast|prefers-color-scheme|forced-colors|hover\s*:|pointer\s*:/

function isSystemLevelOverride(decl: DeclarationEntity): boolean {
  const rule = decl.rule
  if (!rule) return false
  for (let i = 0; i < rule.containingMediaStack.length; i++) {
    const media = rule.containingMediaStack[i]
    if (!media) continue
    if (SYSTEM_LEVEL_MEDIA_RE.test(media.params.toLowerCase())) return true
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
        emit(createCSSDiagnostic(
          decl.file.path, decl.startLine, decl.startColumn,
          cssNoImportant.id, "avoidImportant",
          resolveMessage(messages.avoidImportant, { property: decl.property }), "warn",
        ))
      }
    })
  },
})
