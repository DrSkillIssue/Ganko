import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import type { DeclarationEntity, RuleEntity } from "../../entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../entities"
import { emitCSSDiagnostic } from "../util"

const messages = {
  redundantOverride:
    "Declaration `{{property}}` is always overridden later by the same selector in the same cascade context.",
} as const

function isSameCascadeContext(a: RuleEntity, b: RuleEntity): boolean {
  if (a.file.path !== b.file.path) return false
  if (a.parent !== b.parent) return false
  if (a.selectorText !== b.selectorText) return false
  return true
}

function getRule(declaration: DeclarationEntity): RuleEntity | null {
  return declaration.rule
}

export const noRedundantOverridePairs = defineCSSRule({
  id: "no-redundant-override-pairs",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow declarations that are deterministically overridden in the same selector context.",
    fixable: false,
    category: "css-cascade",
  },
  options: {},
  check(graph, emit) {
    const seen = new Set<number>()

    for (const declaration of graph.declarations) {
      if (declaration.overriddenBy.length === 0) continue
      const rule = getRule(declaration)
      if (!rule) continue

      let redundant = false
      for (let i = 0; i < declaration.overriddenBy.length; i++) {
        const override = declaration.overriddenBy[i]
        if (!override) continue
        const overrideRule = getRule(override)
        if (!overrideRule) continue
        if (override.property !== declaration.property) continue
        if (hasFlag(override._flags, DECL_IS_IMPORTANT) !== hasFlag(declaration._flags, DECL_IS_IMPORTANT)) continue
        if (override.cascadePosition.layerOrder !== declaration.cascadePosition.layerOrder) continue
        if (!isSameCascadeContext(rule, overrideRule)) continue
        redundant = true
        break
      }

      if (!redundant) continue
      if (seen.has(declaration.id)) continue
      seen.add(declaration.id)

      emitCSSDiagnostic(
        emit,
        declaration.file.path,
        declaration.startLine,
        declaration.startColumn,
        noRedundantOverridePairs,
        "redundantOverride",
        resolveMessage(messages.redundantOverride, {
          property: declaration.property,
        }),
      )
    }
  },
})
