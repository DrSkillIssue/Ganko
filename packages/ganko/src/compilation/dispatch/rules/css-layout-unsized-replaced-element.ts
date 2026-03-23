import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { parsePxValue } from "../../../css/parser/value-util"
import { getStaticNumericValue, getStaticStringFromJSXValue } from "../../../solid/util/static-value"
import { getJSXAttributeEntity } from "../../../solid/queries/jsx"
import type { JSXElementEntity } from "../../../solid/entities/jsx"
import type { SolidSyntaxTree } from "../../core/solid-syntax-tree"
import type { ElementNode } from "../../binding/element-builder"
import type { ReservedSpaceFact } from "../../analysis/layout-fact"
import type { FileSemanticModel } from "../../binding/semantic-model"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unsizedReplacedElement:
    "Replaced element '{{tag}}' has no stable reserved size (width/height or aspect-ratio with a dimension), which can cause CLS.",
} as const

const REPLACED_MEDIA_TAGS = new Set(["img", "video", "iframe", "canvas", "svg"])

export const cssLayoutUnsizedReplacedElement = defineAnalysisRule({
  id: "css-layout-unsized-replaced-element",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable reserved geometry for replaced media elements to prevent layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    registry.registerFactAction("reservedSpace", (element, reservedSpaceFact, semanticModel, emit) => {
      if (element.tagName === null || !REPLACED_MEDIA_TAGS.has(element.tagName)) return

      if (hasReservedSize(semanticModel.solidTree, element, reservedSpaceFact, semanticModel)) return

      emit(
        createDiagnostic(
          element.solidFile,
          element.jsxEntity.node,
          semanticModel.solidTree.sourceFile,
          cssLayoutUnsizedReplacedElement.id,
          "unsizedReplacedElement",
          resolveMessage(messages.unsizedReplacedElement, { tag: element.tagName }),
          "warn",
        ),
      )
    })
  },
})

function hasReservedSize(
  solidTree: SolidSyntaxTree,
  element: ElementNode,
  reservedSpaceFact: ReservedSpaceFact,
  semanticModel: FileSemanticModel,
): boolean {
  if (reservedSpaceFact.hasReservedSpace) return true

  const attrWidth = parsePositiveLength(element.attributes.get("width"))
  const attrHeight = parsePositiveLength(element.attributes.get("height"))
  const jsxAttrWidth = readPositiveJsxAttribute(solidTree, element.jsxEntity, "width")
  const jsxAttrHeight = readPositiveJsxAttribute(solidTree, element.jsxEntity, "height")

  // Host DOM element JSX attributes — populated when the node is a component call
  // site resolved to a concrete DOM element.
  const hostRef = resolveHostElementRef(element, semanticModel)
  const hostJsxWidth = hostRef !== null
    ? readPositiveJsxAttribute(hostRef.solidTree, hostRef.element, "width")
    : false
  const hostJsxHeight = hostRef !== null
    ? readPositiveJsxAttribute(hostRef.solidTree, hostRef.element, "height")
    : false

  if ((attrWidth && attrHeight) || (jsxAttrWidth && jsxAttrHeight) || (hostJsxWidth && hostJsxHeight)) return true

  const hasAnyWidth = attrWidth || jsxAttrWidth || hostJsxWidth || reservedSpaceFact.hasDeclaredInlineDimension
  const hasAnyHeight = attrHeight || jsxAttrHeight || hostJsxHeight || reservedSpaceFact.hasDeclaredBlockDimension || reservedSpaceFact.hasContainIntrinsicSize

  if (reservedSpaceFact.hasUsableAspectRatio && (hasAnyWidth || hasAnyHeight)) return true
  if (reservedSpaceFact.hasContainIntrinsicSize && (hasAnyWidth || hasAnyHeight)) return true

  return false
}

function parsePositiveLength(raw: string | null | undefined): boolean {
  if (!raw) return false
  const px = parsePxValue(raw)
  if (px === null) return false
  return px > 0
}

function readPositiveJsxAttribute(
  solidTree: SolidSyntaxTree,
  element: JSXElementEntity,
  name: string,
): boolean {
  const attribute = getJSXAttributeEntity(solidTree, element, name)
  if (!attribute || !attribute.valueNode) return false

  const staticString = getStaticStringFromJSXValue(attribute.valueNode)
  if (staticString !== null) return parsePositiveLength(staticString)

  if (!ts.isJsxExpression(attribute.valueNode)) return false
  if (!attribute.valueNode.expression) return false
  const staticNumeric = getStaticNumericValue(attribute.valueNode.expression)
  if (staticNumeric === null) return false
  return staticNumeric > 0
}

interface ResolvedHostRef {
  readonly solidTree: SolidSyntaxTree
  readonly element: JSXElementEntity
}

function resolveHostElementRef(_element: ElementNode, _semanticModel: FileSemanticModel): ResolvedHostRef | null {
  return null
}
