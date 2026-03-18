import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { parsePxValue } from "../../css/parser/value-util"
import { defineCrossRule } from "../rule"
import { type LayoutGraph, readElementsByTagName, readReservedSpaceFact } from "../layout"
import { getStaticNumericValue, getStaticStringFromJSXValue } from "../../solid/util/static-value"
import type { JSXElementEntity } from "../../solid/entities/jsx"
import type { SolidGraph } from "../../solid/impl"
import { getJSXAttributeEntity } from "../../solid/queries/jsx"
import { readNodeRef } from "./rule-runtime"

const messages = {
  unsizedReplacedElement:
    "Replaced element '{{tag}}' has no stable reserved size (width/height or aspect-ratio with a dimension), which can cause CLS.",
} as const

const REPLACED_MEDIA_TAGS = new Set(["img", "video", "iframe", "canvas", "svg"])

export const cssLayoutUnsizedReplacedElement = defineCrossRule({
  id: "css-layout-unsized-replaced-element",
  severity: "warn",
  messages,
  meta: {
    description: "Require stable reserved geometry for replaced media elements to prevent layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = collectReplacedMediaCandidates(context.layout)
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const tag = node.tagName
      if (!tag) continue

      const ref = readNodeRef(context.layout, node)
      if (!ref) continue

      const reservedSpace = readReservedSpaceFact(context.layout, node)
      if (hasReservedSize(ref.solid, node.attributes, ref.element, reservedSpace)) continue

      emit(
        createDiagnostic(
          ref.solid.file,
          ref.element.node,
          ref.solid.sourceFile,
          cssLayoutUnsizedReplacedElement.id,
          "unsizedReplacedElement",
          resolveMessage(messages.unsizedReplacedElement, { tag }),
          "warn",
        ),
      )
    }
  },
})

function hasReservedSize(
  solid: SolidGraph,
  attributes: ReadonlyMap<string, string | null>,
  element: JSXElementEntity,
  reservedSpaceFact: ReturnType<typeof readReservedSpaceFact>,
): boolean {
  if (reservedSpaceFact.hasReservedSpace) return true

  const attrWidth = parsePositiveLength(attributes.get("width"))
  const attrHeight = parsePositiveLength(attributes.get("height"))
  const jsxAttrWidth = readPositiveJsxAttribute(solid, element, "width")
  const jsxAttrHeight = readPositiveJsxAttribute(solid, element, "height")

  if ((attrWidth && attrHeight) || (jsxAttrWidth && jsxAttrHeight)) return true

  // Both width and height are declared via dynamic (non-static-string) expressions
  // on the element or its resolved component host. `null` in the merged attributes
  // map means the attribute is explicitly authored but not resolvable to a static
  // string literal (e.g. `width={props.size ?? 24}`). Component call sites resolved
  // to a replaced-media tag carry the host element's dynamic dimensions through the
  // merged attribute map. Treat any element with both attributes explicitly declared
  // — even as runtime expressions — as intentionally sized.
  if (attributes.get("width") === null && attributes.get("height") === null) return true

  const hasAnyWidth = attrWidth || jsxAttrWidth || reservedSpaceFact.hasUsableInlineDimension
  const hasAnyHeight = attrHeight || jsxAttrHeight || reservedSpaceFact.hasUsableBlockDimension || reservedSpaceFact.hasContainIntrinsicSize

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

function collectReplacedMediaCandidates(
  layout: LayoutGraph,
): readonly JSXElementNode[] {
  const out: JSXElementNode[] = []

  for (const tag of REPLACED_MEDIA_TAGS) {
    const matches = readElementsByTagName(layout, tag)
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      if (!match) continue
      out.push(match)
    }
  }

  return out
}

function readPositiveJsxAttribute(
  solid: SolidGraph,
  element: JSXElementEntity,
  name: string,
): boolean {
  const attribute = getJSXAttributeEntity(solid, element, name)
  if (!attribute || !attribute.valueNode) return false

  const staticString = getStaticStringFromJSXValue(attribute.valueNode)
  if (staticString !== null) return parsePositiveLength(staticString)

  if (!ts.isJsxExpression(attribute.valueNode)) return false
  if (!attribute.valueNode.expression) return false
  const staticNumeric = getStaticNumericValue(attribute.valueNode.expression)
  if (staticNumeric === null) return false
  return staticNumeric > 0
}

type JSXElementNode = LayoutGraph["elements"][number]
