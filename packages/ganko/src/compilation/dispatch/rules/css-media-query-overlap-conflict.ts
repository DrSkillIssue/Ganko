import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import type { AtRuleEntity, DeclarationEntity } from "../../../css/entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const PX_VALUE = /^([0-9]+(?:\.[0-9]+)?)px$/
const messages = { mediaOverlapConflict: "Overlapping media queries set different `{{property}}` values for `{{selector}}` in the same overlap range." } as const

interface WidthRange { readonly min: number; readonly max: number }

function parsePx(value: string): number | null { const m = PX_VALUE.exec(value.trim()); return m ? Number(m[1]) : null }

function rangeFromMediaCondition(condition: NonNullable<AtRuleEntity["parsedParams"]["mediaConditions"]>[number]): WidthRange | null {
  if (condition.isNot || condition.type !== "all") return null
  let min = -Infinity; let max = Infinity; let hasWidth = false
  for (let i = 0; i < condition.features.length; i++) {
    const f = condition.features[i]; if (!f || f.name !== "width" || !f.value || !f.operator) return null
    const v = parsePx(f.value); if (v === null) return null; hasWidth = true
    if (f.operator === "min" && v > min) min = v
    else if (f.operator === "max" && v < max) max = v
    else if (f.operator === "exact") { min = v; max = v }
    else return null
  }
  return hasWidth && min <= max ? { min, max } : null
}

function mediaRanges(media: AtRuleEntity): readonly WidthRange[] | null {
  if (media.params.includes(">") || media.params.includes("<")) return null
  const conditions = media.parsedParams.mediaConditions
  if (conditions && conditions.length > 0) {
    const ranges: WidthRange[] = []
    for (let i = 0; i < conditions.length; i++) { const c = conditions[i]; if (!c) continue; const r = rangeFromMediaCondition(c); if (!r) return null; ranges.push(r) }
    if (ranges.length > 0) return ranges
  }
  return null
}

function declarationRanges(declaration: DeclarationEntity): readonly WidthRange[] | null {
  const rule = declaration.rule; if (!rule) return null
  const stack = rule.containingMediaStack; if (stack.length === 0) return null
  let effective: WidthRange[] = [{ min: -Infinity, max: Infinity }]
  for (let i = 0; i < stack.length; i++) {
    const media = stack[i]; if (!media) continue; const ranges = mediaRanges(media); if (!ranges) return null
    const next: WidthRange[] = []
    for (let a = 0; a < effective.length; a++) { const ea = effective[a]; if (!ea) continue; for (let b = 0; b < ranges.length; b++) { const rb = ranges[b]; if (!rb) continue; const min = ea.min > rb.min ? ea.min : rb.min; const max = ea.max < rb.max ? ea.max : rb.max; if (min <= max) next.push({ min, max }) } }
    if (next.length === 0) return []; effective = next
  }
  return effective
}

function isPartialOverlap(a: WidthRange, b: WidthRange): boolean {
  if (a.min > b.max || b.min > a.max) return false
  if (a.min <= b.min && a.max >= b.max) return false
  if (b.min <= a.min && b.max >= a.max) return false
  return true
}

export const cssMediaQueryOverlapConflict = defineAnalysisRule({
  id: "media-query-overlap-conflict",
  severity: "warn",
  messages,
  meta: { description: "Disallow conflicting declarations in partially overlapping media queries.", fixable: false, category: "css-cascade" },
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

      const seen = new Set<number>()
      for (const [property, declarations] of declarationsByProperty) {
        if (declarations.length < 2) continue
        for (let i = 0; i < declarations.length; i++) {
          const a = declarations[i]; if (!a) continue; const aRule = a.rule; if (!aRule) continue
          const aRanges = declarationRanges(a); if (!aRanges || aRanges.length === 0) continue
          for (let j = i + 1; j < declarations.length; j++) {
            const b = declarations[j]; if (!b) continue; const bRule = b.rule; if (!bRule) continue
            if (a.file.path !== b.file.path || aRule.selectorText !== bRule.selectorText || a.value === b.value) continue
            if (hasFlag(a._flags, DECL_IS_IMPORTANT) !== hasFlag(b._flags, DECL_IS_IMPORTANT)) continue
            if (a.cascadePosition.layerOrder !== b.cascadePosition.layerOrder) continue
            const bRanges = declarationRanges(b); if (!bRanges || bRanges.length === 0) continue
            let hasOverlap = false
            for (let ai = 0; ai < aRanges.length && !hasOverlap; ai++) { const ar = aRanges[ai]; if (!ar) continue; for (let bi = 0; bi < bRanges.length; bi++) { const br = bRanges[bi]; if (br && isPartialOverlap(ar, br)) { hasOverlap = true; break } } }
            if (!hasOverlap) continue
            if (!seen.has(a.id)) { seen.add(a.id); emit(createDiagnosticFromLoc(a.file.path, { start: { line: a.startLine, column: a.startColumn }, end: { line: a.startLine, column: a.startColumn + 1 } }, cssMediaQueryOverlapConflict.id, "mediaOverlapConflict", resolveMessage(messages.mediaOverlapConflict, { property, selector: aRule.selectorText }), "warn")) }
            if (!seen.has(b.id)) { seen.add(b.id); emit(createDiagnosticFromLoc(b.file.path, { start: { line: b.startLine, column: b.startColumn }, end: { line: b.startLine, column: b.startColumn + 1 } }, cssMediaQueryOverlapConflict.id, "mediaOverlapConflict", resolveMessage(messages.mediaOverlapConflict, { property, selector: bRule.selectorText }), "warn")) }
          }
        }
      }
    })
  },
})
