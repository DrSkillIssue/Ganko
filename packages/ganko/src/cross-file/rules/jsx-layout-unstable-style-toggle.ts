import type { TSESTree as T } from "@typescript-eslint/utils"
import { parsePxValue } from "../../css/parser/value-util"
import { LAYOUT_INLINE_STYLE_TOGGLE_PROPERTIES } from "../../css/layout-taxonomy"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { forEachStylePropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"
import { constantTruthiness, getStaticValue } from "../../solid/util/static-value"
import { defineCrossRule } from "../rule"
import { normalizeStylePropertyKey } from "./rule-runtime"
import type { LayoutGraph } from "../layout"
import { readFlowParticipationFact } from "../layout/signal-access"
import type { JSXElementEntity } from "../../solid/entities/jsx"

const messages = {
  unstableLayoutStyleToggle:
    "Dynamic style value for '{{property}}' can toggle layout geometry at runtime and cause CLS.",
} as const

const PX_NUMBER_PROPERTIES = new Set([
  "top",
  "bottom",
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-bottom",
  "height",
  "min-height",
  "width",
  "min-width",
  "font-size",
])

/**
 * Properties that only affect positioned offset within the containing block,
 * not the geometry of surrounding in-flow content. These are only meaningful
 * on elements that have effective positioning (absolute/fixed/relative/sticky),
 * so when the element is out of flow they cannot cause CLS.
 */
const POSITIONED_OFFSET_PROPERTIES = new Set([
  "top",
  "bottom",
])

export const jsxLayoutUnstableStyleToggle = defineCrossRule({
  id: "jsx-layout-unstable-style-toggle",
  severity: "warn",
  messages,
  meta: {
    description: "Flag dynamic inline style values on layout-sensitive properties that can trigger CLS.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    forEachStylePropertyAcross(context.solids, (solid, property, element) => {
      if (property.type !== "Property") return
      const key = objectKeyName(property.key)
      if (!key) return

      const normalized = normalizeStylePropertyKey(key)
      if (!LAYOUT_INLINE_STYLE_TOGGLE_PROPERTIES.has(normalized)) return
      if (!hasUnstableLayoutDelta(normalized, property.value)) return
      if (isExemptFromCLS(context.layout, solid.file, element, normalized)) return

      emit(
        createDiagnostic(
          solid.file,
          property.value,
          jsxLayoutUnstableStyleToggle.id,
          "unstableLayoutStyleToggle",
          resolveMessage(messages.unstableLayoutStyleToggle, { property: normalized }),
          "warn",
        ),
      )
    })
  },
})

/**
 * Determines whether a dynamic inline style property on this element is exempt
 * from CLS warnings based on its layout context.
 *
 * Elements that are unconditionally out of normal flow (position: absolute/fixed)
 * do not participate in the document's layout flow. Changing their geometry
 * properties (width, height, top, etc.) cannot shift surrounding content because
 * they are removed from flow and rendered in their own containing block.
 *
 * For positioned offset properties (top, bottom), changes on any positioned
 * element (including relative/sticky) do not cause CLS — they only move the
 * element within its containing block without affecting sibling layout.
 */
function isExemptFromCLS(
  layout: LayoutGraph,
  solidFile: string,
  element: JSXElementEntity,
  property: string,
): boolean {
  const elementsByFile = layout.elementBySolidFileAndId.get(solidFile)
  if (!elementsByFile) return false
  const node = elementsByFile.get(element.id)
  if (!node) return false

  const flowFact = readFlowParticipationFact(layout, node)

  // Out-of-flow elements (position: absolute/fixed) cannot cause CLS — their
  // geometry changes are isolated to their containing block layer.
  if (!flowFact.inFlow) return true

  // Positioned offset properties (top, bottom) on elements with any effective
  // position (relative, sticky, absolute, fixed) don't shift sibling content.
  if (POSITIONED_OFFSET_PROPERTIES.has(property) && flowFact.position !== null && flowFact.position !== "static") {
    return true
  }

  return false
}

function hasUnstableLayoutDelta(property: string, node: T.Node): boolean {
  const unwrapped = unwrapTypeWrapper(node)

  if (isStaticComparable(property, unwrapped)) return false

  if (unwrapped.type === "ConditionalExpression") {
    return conditionalHasDelta(property, unwrapped)
  }

  if (unwrapped.type === "LogicalExpression") {
    return logicalHasDelta(property, unwrapped)
  }

  return true
}

function conditionalHasDelta(property: string, node: T.ConditionalExpression): boolean {
  const consequent = unwrapTypeWrapper(node.consequent)
  const alternate = unwrapTypeWrapper(node.alternate)

  const consequentValue = readComparableStaticValue(property, consequent)
  const alternateValue = readComparableStaticValue(property, alternate)
  if (consequentValue !== null && alternateValue !== null) {
    return consequentValue !== alternateValue
  }

  return true
}

function logicalHasDelta(property: string, node: T.LogicalExpression): boolean {
  const left = unwrapTypeWrapper(node.left)
  const right = unwrapTypeWrapper(node.right)
  const leftTruthiness = constantTruthiness(left)

  if (node.operator === "&&") {
    if (leftTruthiness === false) return hasUnstableLayoutDelta(property, left)
    if (leftTruthiness === true) return hasUnstableLayoutDelta(property, right)
    return true
  }

  if (node.operator === "||") {
    if (leftTruthiness === true) return hasUnstableLayoutDelta(property, left)
    if (leftTruthiness === false) return hasUnstableLayoutDelta(property, right)
    return true
  }

  return true
}

function isStaticComparable(property: string, node: T.Node): boolean {
  return readComparableStaticValue(property, node) !== null
}

function readComparableStaticValue(property: string, node: T.Node): string | null {
  const staticValue = getStaticValue(node)
  if (staticValue === null) return null
  return normalizeComparableValue(property, staticValue.value)
}

function normalizeComparableValue(
  property: string,
  value: string | number | boolean | null | undefined,
): string | null {
  const isPxProperty = PX_NUMBER_PROPERTIES.has(property)
  const isLineHeightProperty = property === "line-height"

  if (typeof value === "number") {
    if (isLineHeightProperty) return `line-height:${value}`
    if (isPxProperty) return `px:${value}`
    return `num:${value}`
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (isPxProperty) {
      const px = parsePxValue(normalized)
      if (px !== null) return `px:${px}`
    }
    if (isLineHeightProperty) {
      const unitless = Number(normalized)
      if (Number.isFinite(unitless)) return `line-height:${unitless}`
    }
    return `str:${normalized}`
  }

  if (typeof value === "boolean") return value ? "bool:true" : "bool:false"
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  return null
}

function unwrapTypeWrapper(node: T.Node): T.Node {
  let current = node

  while (true) {
    if (current.type === "TSAsExpression" || current.type === "TSTypeAssertion") {
      current = current.expression
      continue
    }

    if (current.type === "TSNonNullExpression") {
      current = current.expression
      continue
    }

    return current
  }
}
