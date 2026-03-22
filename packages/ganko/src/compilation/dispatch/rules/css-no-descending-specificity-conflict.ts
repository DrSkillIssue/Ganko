import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import type { SelectorEntity, DeclarationEntity } from "../../../css/entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = { descendingSpecificity: "Lower-specificity selector `{{laterSelector}}` appears after `{{earlierSelector}}` for `{{property}}`, creating brittle cascade behavior." } as const

interface Compound { readonly tag: string | null; readonly classes: readonly string[]; readonly ids: readonly string[] }

function extractCompounds(selector: SelectorEntity): readonly Compound[] | null {
  const sc = selector.compounds; if (sc.length === 0) return null
  for (let i = 0; i < sc.length; i++) { const c = sc[i]; if (!c) continue; for (let j = 0; j < c.parts.length; j++) { const p = c.parts[j]; if (!p) continue; if (p.type === "attribute" || p.type === "pseudo-class" || p.type === "pseudo-element" || p.type === "universal" || p.type === "nesting") return null } }
  const compounds: Compound[] = []
  for (let i = 0; i < sc.length; i++) { const c = sc[i]; if (!c) continue; const ids: string[] = []; if (c.idValue !== null) ids.push(c.idValue); if (!c.tagName && c.classes.length === 0 && ids.length === 0) return null; compounds.push({ tag: c.tagName, classes: c.classes, ids }) }
  return compounds
}

function hasToken(list: readonly string[], token: string): boolean { for (let i = 0; i < list.length; i++) { if (list[i] === token) return true } return false }

function isCompoundSuperset(superset: Compound, subset: Compound): boolean {
  if (subset.tag && superset.tag !== subset.tag) return false
  for (let i = 0; i < subset.classes.length; i++) { const cls = subset.classes[i]; if (cls && !hasToken(superset.classes, cls)) return false }
  for (let i = 0; i < subset.ids.length; i++) { const id = subset.ids[i]; if (id && !hasToken(superset.ids, id)) return false }
  return true
}

function isExactMatch(a: Compound, b: Compound): boolean {
  if (a.tag !== b.tag || a.classes.length !== b.classes.length || a.ids.length !== b.ids.length) return false
  for (let i = 0; i < a.classes.length; i++) { const c = a.classes[i]; if (c && !hasToken(b.classes, c)) return false }
  for (let i = 0; i < a.ids.length; i++) { const id = a.ids[i]; if (id && !hasToken(b.ids, id)) return false }
  return true
}

function isProvableDescendingPair(earlier: SelectorEntity, later: SelectorEntity): boolean {
  const ec = extractCompounds(earlier); if (!ec) return false
  const lc = extractCompounds(later); if (!lc) return false
  if (ec.length !== lc.length || earlier.combinators.length !== later.combinators.length) return false
  for (let i = 0; i < earlier.combinators.length; i++) { if (earlier.combinators[i] !== later.combinators[i]) return false }
  const last = ec.length - 1
  for (let i = 0; i < last; i++) { const a = ec[i]; const b = lc[i]; if (!a || !b || !isExactMatch(a, b)) return false }
  const et = ec[last]; const lt = lc[last]; if (!et || !lt) return false
  return isCompoundSuperset(et, lt) && !isExactMatch(et, lt)
}

export const cssNoDescendingSpecificityConflict = defineAnalysisRule({
  id: "no-descending-specificity-conflict",
  severity: "warn",
  messages,
  meta: { description: "Disallow lower-specificity selectors after higher-specificity selectors for the same property.", fixable: false, category: "css-cascade" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      const declarationsByProperty = new Map<string, DeclarationEntity[]>()
      for (const [, tree] of compilation.cssTrees) {
        for (const [property, decls] of tree.declarationsByProperty) {
          const existing = declarationsByProperty.get(property)
          if (existing) { for (let i = 0; i < decls.length; i++) { const d = decls[i]; if (d) existing.push(d) } }
          else { const arr: DeclarationEntity[] = []; for (let i = 0; i < decls.length; i++) { const d = decls[i]; if (d) arr.push(d) }; declarationsByProperty.set(property, arr) }
        }
      }
      for (const [, decls] of declarationsByProperty) decls.sort((a, b) => a.sourceOrder - b.sourceOrder)

      for (const [property, declarations] of declarationsByProperty) {
        if (declarations.length < 2) continue
        const seen = new Set<number>()
        for (let i = 1; i < declarations.length; i++) {
          const later = declarations[i]; if (!later) continue; const laterRule = later.rule; if (!laterRule) continue
          for (let j = 0; j < i; j++) {
            const earlier = declarations[j]; if (!earlier) continue
            if (earlier.file.path !== later.file.path) continue
            if (hasFlag(earlier._flags, DECL_IS_IMPORTANT) !== hasFlag(later._flags, DECL_IS_IMPORTANT)) continue
            if (earlier.cascadePosition.layerOrder !== later.cascadePosition.layerOrder) continue
            if (later.cascadePosition.specificityScore >= earlier.cascadePosition.specificityScore) continue
            const earlierRule = earlier.rule; if (!earlierRule) continue
            if (earlierRule.selectors.length !== 1 || laterRule.selectors.length !== 1) continue
            const es = earlierRule.selectors[0]; const ls = laterRule.selectors[0]; if (!es || !ls) continue
            if (!isProvableDescendingPair(es, ls) || seen.has(later.id)) continue
            seen.add(later.id)
            emit(createDiagnosticFromLoc(later.file.path, { start: { line: later.startLine, column: later.startColumn }, end: { line: later.startLine, column: later.startColumn + 1 } }, cssNoDescendingSpecificityConflict.id, "descendingSpecificity", resolveMessage(messages.descendingSpecificity, { laterSelector: ls.raw, earlierSelector: es.raw, property }), "warn"))
          }
        }
      }
    })
  },
})
