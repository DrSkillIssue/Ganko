import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const FOCUS_NOT_VISIBLE_G = /:focus(?!-visible)/g
const messages = { missingFocusVisible: "Focus outline removed without matching `:focus-visible` replacement." } as const

function removesOutline(value: string): boolean { const v = value.trim().toLowerCase(); return v === "none" || v === "0" }
function hasVisibleFocusIndicator(declarations: readonly { property: string; value: string }[]): boolean {
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]; if (!d) continue; const p = d.property.toLowerCase(); const v = d.value.trim().toLowerCase()
    if (p === "outline" && v !== "none" && v !== "0") return true
    if (p === "box-shadow" && v !== "none") return true
    if (p === "border" && v !== "none" && v !== "0") return true
  }
  return false
}

export const cssNoOutlineNoneWithoutFocusVisible = defineAnalysisRule({
  id: "css-no-outline-none-without-focus-visible",
  severity: "error",
  messages,
  meta: { description: "Disallow removing outline without explicit focus-visible replacement.", fixable: false, category: "css-a11y" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const focusVisibleSelectors = tree.selectorsByPseudoClass.get("focus-visible")
      const focusVisibleWithIndicator = new Set<string>()
      if (focusVisibleSelectors) {
        for (let i = 0; i < focusVisibleSelectors.length; i++) { const sel = focusVisibleSelectors[i]; if (sel && hasVisibleFocusIndicator(sel.rule.declarations)) focusVisibleWithIndicator.add(sel.raw) }
      }
      const focusSelectors = tree.selectorsByPseudoClass.get("focus")
      if (!focusSelectors) return
      const checked = new Set<number>()
      for (let i = 0; i < focusSelectors.length; i++) {
        const s = focusSelectors[i]; if (!s) continue; const rule = s.rule; if (checked.has(rule.id)) continue; checked.add(rule.id)
        const outlineDecls = rule.declarationIndex.get("outline"); if (!outlineDecls) continue
        let stripsOutline = false
        for (let j = 0; j < outlineDecls.length; j++) { const od = outlineDecls[j]; if (od && removesOutline(od.value)) stripsOutline = true }
        if (!stripsOutline) continue
        for (let j = 0; j < rule.selectors.length; j++) {
          const sel = rule.selectors[j]; if (!sel || !sel.raw.includes(":focus") || sel.raw.includes(":focus-visible")) continue
          const expected = sel.raw.replace(FOCUS_NOT_VISIBLE_G, ":focus-visible")
          if (focusVisibleWithIndicator.has(expected)) continue
          emit(createCSSDiagnostic(
            rule.file.path, rule.startLine, rule.startColumn,
            cssNoOutlineNoneWithoutFocusVisible.id, "missingFocusVisible",
            resolveMessage(messages.missingFocusVisible), "error",
          ))
        }
      }
    })
  },
})
