import ts from "typescript"
import { parsePxValue } from "../../../css/parser/value-util"
import { LAYOUT_INLINE_STYLE_TOGGLE_PROPERTIES } from "../../../css/layout-taxonomy"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { constantTruthiness, getStaticValue } from "../../../solid/util/static-value"
import { toKebabCase } from "@drskillissue/ganko-shared"
import type { ElementNode } from "../../binding/element-builder"
import type { FileSemanticModel } from "../../binding/semantic-model"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unstableLayoutStyleToggle:
    "Dynamic style value for '{{property}}' can toggle layout geometry at runtime and cause CLS.",
} as const

const PX_NUMBER_PROPERTIES = new Set([
  "top", "bottom", "margin-top", "margin-bottom", "padding-top", "padding-bottom",
  "height", "min-height", "width", "min-width", "font-size",
])

const POSITIONED_OFFSET_PROPERTIES = new Set(["top", "bottom"])

export const jsxLayoutUnstableStyleToggle = defineAnalysisRule({
  id: "jsx-layout-unstable-style-toggle",
  severity: "warn",
  messages,
  meta: {
    description: "Flag dynamic inline style values on layout-sensitive properties that can trigger CLS.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    registry.registerFactAction("flowParticipation", (element, flowFact, semanticModel, emit) => {
      const solidTree = semanticModel.solidTree
      const properties = solidTree.styleProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        if (entry.element.id !== element.jsxEntity.id) continue
        const p = entry.property
        if (!ts.isPropertyAssignment(p)) continue
        const key = getPropertyKeyName(p.name)
        if (!key) continue

        const normalized = normalizeStylePropertyKey(key)
        if (!LAYOUT_INLINE_STYLE_TOGGLE_PROPERTIES.has(normalized)) continue
        if (!hasUnstableLayoutDelta(normalized, p.initializer)) continue
        if (isExemptFromCLS(element, flowFact, normalized, semanticModel)) continue

        emit(
          createDiagnostic(
            solidTree.filePath,
            p.initializer,
            solidTree.sourceFile,
            jsxLayoutUnstableStyleToggle.id,
            "unstableLayoutStyleToggle",
            resolveMessage(messages.unstableLayoutStyleToggle, { property: normalized }),
            "warn",
          ),
        )
      }
    })
  },
})

function normalizeStylePropertyKey(key: string): string {
  if (key.includes("-")) return key.toLowerCase()
  return toKebabCase(key)
}

function isExemptFromCLS(
  element: ElementNode,
  flowFact: import("../../analysis/layout-fact").FlowParticipationFact,
  property: string,
  _semanticModel: FileSemanticModel,
): boolean {
  if (!flowFact.inFlow) return true

  if (POSITIONED_OFFSET_PROPERTIES.has(property) && flowFact.position !== null && flowFact.position !== "static") {
    return true
  }

  if (hasLayoutContainment(element) || (element.parentElementNode !== null && hasLayoutContainment(element.parentElementNode))) {
    return true
  }

  return false
}

function hasLayoutContainment(node: ElementNode): boolean {
  const contain = node.inlineStyleValues.get("contain")
  if (contain === undefined) return false
  return contain === "layout"
    || contain === "strict"
    || contain === "content"
    || contain.includes("layout")
}

function hasUnstableLayoutDelta(property: string, node: ts.Node): boolean {
  const unwrapped = unwrapTypeWrapper(node)

  if (isStaticComparable(property, unwrapped)) return false

  if (ts.isConditionalExpression(unwrapped)) {
    return conditionalHasDelta(property, unwrapped)
  }

  if (ts.isBinaryExpression(unwrapped) && isLogicalOperator(unwrapped.operatorToken.kind)) {
    return logicalHasDelta(property, unwrapped)
  }

  return true
}

function conditionalHasDelta(property: string, node: ts.ConditionalExpression): boolean {
  const consequent = unwrapTypeWrapper(node.whenTrue)
  const alternate = unwrapTypeWrapper(node.whenFalse)

  const consequentValue = readComparableStaticValue(property, consequent)
  const alternateValue = readComparableStaticValue(property, alternate)
  if (consequentValue !== null && alternateValue !== null) {
    return consequentValue !== alternateValue
  }

  return true
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.AmpersandAmpersandToken
    || kind === ts.SyntaxKind.BarBarToken
}

function logicalHasDelta(property: string, node: ts.BinaryExpression): boolean {
  const left = unwrapTypeWrapper(node.left)
  const right = unwrapTypeWrapper(node.right)
  const leftTruthiness = constantTruthiness(left)

  if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (leftTruthiness === false) return hasUnstableLayoutDelta(property, left)
    if (leftTruthiness === true) return hasUnstableLayoutDelta(property, right)
    return true
  }

  if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    if (leftTruthiness === true) return hasUnstableLayoutDelta(property, left)
    if (leftTruthiness === false) return hasUnstableLayoutDelta(property, right)
    return true
  }

  return true
}

function isStaticComparable(property: string, node: ts.Node): boolean {
  return readComparableStaticValue(property, node) !== null
}

function readComparableStaticValue(property: string, node: ts.Node): string | null {
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

function unwrapTypeWrapper(node: ts.Node): ts.Node {
  let current = node

  while (true) {
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression
      continue
    }

    if (ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }

    return current
  }
}
