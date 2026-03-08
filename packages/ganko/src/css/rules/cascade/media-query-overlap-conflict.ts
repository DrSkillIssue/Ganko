import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import type { AtRuleEntity, DeclarationEntity } from "../../entities"
import { hasFlag, DECL_IS_IMPORTANT } from "../../entities"
import { emitCSSDiagnostic } from "../util"
import { splitMediaQueries, WHITESPACE_SPLIT } from "@drskillissue/ganko-shared"

const PX_VALUE = /^([0-9]+(?:\.[0-9]+)?)px$/
const MIN_WIDTH_FEATURE = /^min-width\s*:\s*(.+)$/i
const MAX_WIDTH_FEATURE = /^max-width\s*:\s*(.+)$/i
const WIDTH_FEATURE = /^width\s*:\s*(.+)$/i

const messages = {
  mediaOverlapConflict:
    "Overlapping media queries set different `{{property}}` values for `{{selector}}` in the same overlap range.",
} as const

interface WidthRange {
  readonly min: number
  readonly max: number
}

const BOOLEAN_MEDIA_CONJUNCTION = new Set(["and", ""])

function parsePx(value: string): number | null {
  const m = PX_VALUE.exec(value.trim())
  if (!m) return null
  return Number(m[1])
}

function rangeFromMediaCondition(condition: NonNullable<AtRuleEntity["parsedParams"]["mediaConditions"]>[number]): WidthRange | null {
  if (condition.isNot) return null
  if (condition.type !== "all") return null

  let min = Number.NEGATIVE_INFINITY
  let max = Number.POSITIVE_INFINITY
  let hasWidth = false

  for (let i = 0; i < condition.features.length; i++) {
    const feature = condition.features[i]
    if (!feature) return null
    if (feature.name !== "width") return null
    if (!feature.value) return null
    const v = parsePx(feature.value)
    if (v === null) return null
    if (!feature.operator) return null

    hasWidth = true

    if (feature.operator === "min") {
      if (v > min) min = v
      continue
    }
    if (feature.operator === "max") {
      if (v < max) max = v
      continue
    }
    if (feature.operator === "exact") {
      min = v
      max = v
      continue
    }
    return null
  }

  if (!hasWidth) return null
  if (min > max) return null
  return { min, max }
}

function parseWidthRange(params: string): WidthRange | null {
  if (params.includes(">") || params.includes("<")) return null

  const featurePattern = /\(([^)]+)\)/g
  let min = Number.NEGATIVE_INFINITY
  let max = Number.POSITIVE_INFINITY
  let hasWidth = false

  let match: RegExpExecArray | null
  while ((match = featurePattern.exec(params)) !== null) {
    const content = match[1]
    if (!content) continue
    const trimmedContent = content.trim()

    const minMatch = MIN_WIDTH_FEATURE.exec(trimmedContent)
    if (minMatch) {
      const minVal = minMatch[1]
      if (!minVal) return null
      const v = parsePx(minVal)
      if (v === null) return null
      if (v > min) min = v
      hasWidth = true
      continue
    }

    const maxMatch = MAX_WIDTH_FEATURE.exec(trimmedContent)
    if (maxMatch) {
      const maxVal = maxMatch[1]
      if (!maxVal) return null
      const v = parsePx(maxVal)
      if (v === null) return null
      if (v < max) max = v
      hasWidth = true
      continue
    }

    const exactMatch = WIDTH_FEATURE.exec(trimmedContent)
    if (exactMatch) {
      const exactVal = exactMatch[1]
      if (!exactVal) return null
      const v = parsePx(exactVal)
      if (v === null) return null
      min = v
      max = v
      hasWidth = true
      continue
    }

    return null
  }

  if (!hasWidth) return null

  const remainder = params.replace(featurePattern, " ").toLowerCase().trim()
  if (remainder.length > 0) {
    const parts = remainder.split(WHITESPACE_SPLIT)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue
      if (BOOLEAN_MEDIA_CONJUNCTION.has(part)) continue
      return null
    }
  }

  if (min > max) return null
  return { min, max }
}

function parseWidthRanges(params: string): readonly WidthRange[] | null {
  const queries = splitMediaQueries(params)
  if (queries.length === 0) return null

  const ranges: WidthRange[] = []

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    if (!query) continue
    const range = parseWidthRange(query.trim())
    if (!range) return null
    ranges.push(range)
  }

  return ranges.length > 0 ? ranges : null
}

function rangesOverlap(a: WidthRange, b: WidthRange): boolean {
  return a.min <= b.max && b.min <= a.max
}

function isPartialOverlap(a: WidthRange, b: WidthRange): boolean {
  if (!rangesOverlap(a, b)) return false
  const aContainsB = a.min <= b.min && a.max >= b.max
  const bContainsA = b.min <= a.min && b.max >= a.max
  if (aContainsB) return false
  if (bContainsA) return false
  return true
}

function intersectRange(a: WidthRange, b: WidthRange): WidthRange | null {
  const min = a.min > b.min ? a.min : b.min
  const max = a.max < b.max ? a.max : b.max
  if (min > max) return null
  return { min, max }
}

function intersectRangeLists(a: readonly WidthRange[], b: readonly WidthRange[]): readonly WidthRange[] {
  const out: WidthRange[] = []
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    if (!ai) continue
    for (let j = 0; j < b.length; j++) {
      const bj = b[j]
      if (!bj) continue
      const range = intersectRange(ai, bj)
      if (!range) continue
      out.push(range)
    }
  }
  return out
}

function mediaRanges(media: AtRuleEntity): readonly WidthRange[] | null {
  if (media.params.includes(">") || media.params.includes("<")) return null

  const conditions = media.parsedParams.mediaConditions
  if (conditions && conditions.length > 0) {
    const ranges: WidthRange[] = []
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i]
      if (!condition) continue
      const range = rangeFromMediaCondition(condition)
      if (!range) return null
      ranges.push(range)
    }
    if (ranges.length > 0) return ranges
  }

  return parseWidthRanges(media.params)
}

function declarationRanges(declaration: DeclarationEntity): readonly WidthRange[] | null {
  const rule = declaration.rule
  if (!rule) return null

  const containingMedia = rule.containingMediaStack
  if (containingMedia.length === 0) return null

  let effective: readonly WidthRange[] = [{ min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY }]

  for (let i = 0; i < containingMedia.length; i++) {
    const media = containingMedia[i]
    if (!media) continue
    const ranges = mediaRanges(media)
    if (!ranges || ranges.length === 0) return null

    effective = intersectRangeLists(effective, ranges)
    if (effective.length === 0) return []
  }

  return effective
}

function hasPartialOverlapBetweenLists(a: readonly WidthRange[], b: readonly WidthRange[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    if (!ai) continue
    for (let j = 0; j < b.length; j++) {
      const bj = b[j]
      if (!bj) continue
      if (isPartialOverlap(ai, bj)) return true
    }
  }
  return false
}

export const mediaQueryOverlapConflict = defineCSSRule({
  id: "media-query-overlap-conflict",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow conflicting declarations in partially overlapping media queries.",
    fixable: false,
    category: "css-cascade",
  },
  options: {},
  check(graph, emit) {
    const seen = new Set<number>()

    for (const [property, declarations] of graph.multiDeclarationProperties) {
      for (let i = 0; i < declarations.length; i++) {
        const a = declarations[i]
        if (!a) continue
        const aRule = a.rule
        if (!aRule) continue
        const aRanges = declarationRanges(a)
        if (!aRanges || aRanges.length === 0) continue

        for (let j = i + 1; j < declarations.length; j++) {
          const b = declarations[j]
          if (!b) continue
          const bRule = b.rule
          if (!bRule) continue
          if (a.file.path !== b.file.path) continue
          if (aRule.selectorText !== bRule.selectorText) continue
          if (a.value === b.value) continue
          if (hasFlag(a._flags, DECL_IS_IMPORTANT) !== hasFlag(b._flags, DECL_IS_IMPORTANT)) continue
          if (a.cascadePosition.layerOrder !== b.cascadePosition.layerOrder) continue

          const bRanges = declarationRanges(b)
          if (!bRanges || bRanges.length === 0) continue
          if (!hasPartialOverlapBetweenLists(aRanges, bRanges)) continue

          if (!seen.has(a.id)) {
            seen.add(a.id)
            emitCSSDiagnostic(
              emit,
              a.file.path,
              a.startLine,
              a.startColumn,
              mediaQueryOverlapConflict,
              "mediaOverlapConflict",
              resolveMessage(messages.mediaOverlapConflict, {
                property,
                selector: aRule.selectorText,
              }),
            )
          }

          if (!seen.has(b.id)) {
            seen.add(b.id)
            emitCSSDiagnostic(
              emit,
              b.file.path,
              b.startLine,
              b.startColumn,
              mediaQueryOverlapConflict,
              "mediaOverlapConflict",
              resolveMessage(messages.mediaOverlapConflict, {
                property,
                selector: bRule.selectorText,
              }),
            )
          }
        }
      }
    }
  },
})
