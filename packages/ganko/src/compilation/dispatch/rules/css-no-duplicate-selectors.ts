import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  duplicateSelector: "Selector `{{selector}}` is duplicated {{count}} times. Merge declarations to avoid cascade ambiguity.",
} as const

export const cssNoDuplicateSelectors = defineAnalysisRule({
  id: "no-duplicate-selectors",
  severity: "warn",
  messages,
  meta: { description: "Disallow duplicate selector blocks.", fixable: false, category: "css-selector" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      // Duplicate detection needs workspace-wide dedup index
      // Build per-file selector dedup
      for (const [, tree] of compilation.cssTrees) {
        const dedupIndex = new Map<string, import("../../../css/entities/rule").RuleEntity[]>()
        for (let i = 0; i < tree.rules.length; i++) {
          const rule = tree.rules[i]
          if (!rule) continue
          // Skip keyframe selectors
          let isKeyframe = false
          for (let p = rule.parent; p !== null; p = p.kind === "rule" ? p.parent : null) {
            if (p.kind === "keyframes") { isKeyframe = true; break }
          }
          if (isKeyframe) continue
          const key = `${rule.file.path}\0${rule.selectorText}`
          const existing = dedupIndex.get(key)
          if (existing) existing.push(rule)
          else dedupIndex.set(key, [rule])
        }
        for (const [, rules] of dedupIndex) {
          if (rules.length < 2) continue
          const count = String(rules.length)
          const selector = rules[0]!.selectorText
          const msg = resolveMessage(messages.duplicateSelector, { selector, count })
          for (let i = 0; i < rules.length; i++) {
            const rule = rules[i]
            if (!rule) continue
            emit(createDiagnosticFromLoc(rule.file.path, { start: { line: rule.startLine, column: rule.startColumn }, end: { line: rule.startLine, column: rule.startColumn + 1 } }, cssNoDuplicateSelectors.id, "duplicateSelector", msg, "warn"))
          }
        }
      }
    })
  },
})
