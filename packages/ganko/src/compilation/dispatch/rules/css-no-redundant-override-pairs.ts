import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import type { RuleEntity } from "../../../css/entities/rule"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  redundantOverride: "Declaration `{{property}}` is always overridden later by the same selector in the same cascade context.",
} as const

function isSameCascadeContext(a: RuleEntity, b: RuleEntity): boolean {
  return a.file.path === b.file.path && a.parent === b.parent && a.selectorText === b.selectorText
}

export const cssNoRedundantOverridePairs = defineAnalysisRule({
  id: "no-redundant-override-pairs",
  severity: "warn",
  messages,
  meta: { description: "Disallow declarations that are deterministically overridden in the same selector context.", fixable: false, category: "css-cascade" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const seen = new Set<number>()
      for (let i = 0; i < tree.declarations.length; i++) {
        const declaration = tree.declarations[i]
        if (!declaration || declaration.overriddenBy.length === 0) continue
        const rule = declaration.rule
        if (!rule) continue

        let redundant = false
        for (let j = 0; j < declaration.overriddenBy.length; j++) {
          const override = declaration.overriddenBy[j]
          if (!override) continue
          const overrideRule = override.rule
          if (!overrideRule) continue
          if (override.property !== declaration.property) continue
          if (hasFlag(override._flags, DECL_IS_IMPORTANT) !== hasFlag(declaration._flags, DECL_IS_IMPORTANT)) continue
          if (override.cascadePosition.layerOrder !== declaration.cascadePosition.layerOrder) continue
          if (!isSameCascadeContext(rule, overrideRule)) continue
          redundant = true
          break
        }

        if (!redundant || seen.has(declaration.id)) continue
        seen.add(declaration.id)
        emit(createDiagnosticFromLoc(declaration.file.path, { start: { line: declaration.startLine, column: declaration.startColumn }, end: { line: declaration.startLine, column: declaration.startColumn + 1 } }, cssNoRedundantOverridePairs.id, "redundantOverride", resolveMessage(messages.redundantOverride, { property: declaration.property }), "warn"))
      }
    })
  },
})
