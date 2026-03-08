import type { JSXElementEntity } from "../../solid/entities/jsx"
import type { SolidGraph } from "../../solid/impl"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import {
  getJSXElementsByTag,
  getStaticNumericJSXAttributeValue,
} from "../../solid/queries"
import { defineCrossRule } from "../rule"
import { formatFixed } from "./rule-runtime"

const messages = {
  inconsistentPictureRatio:
    "`<picture>` source ratio {{sourceRatio}} differs from fallback img ratio {{imgRatio}}, which can cause reserved-space mismatch and CLS.",
} as const

const RATIO_DELTA_THRESHOLD = 0.02

export const jsxLayoutPictureSourceRatioConsistency = defineCrossRule({
  id: "jsx-layout-picture-source-ratio-consistency",
  severity: "warn",
  messages,
  meta: {
    description: "Require consistent intrinsic aspect ratios across <picture> sources and fallback image.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    for (let i = 0; i < context.solids.length; i++) {
      const solid = context.solids[i]
      if (!solid) continue

      const pictures = getJSXElementsByTag(solid, "picture")
      for (let j = 0; j < pictures.length; j++) {
        const picture = pictures[j]
        if (!picture) continue
        const mismatch = firstPictureRatioMismatch(solid, picture)
        if (!mismatch) continue

        emit(
          createDiagnostic(
            solid.file,
            picture.node,
            jsxLayoutPictureSourceRatioConsistency.id,
            "inconsistentPictureRatio",
            resolveMessage(messages.inconsistentPictureRatio, {
              sourceRatio: mismatch.sourceRatio,
              imgRatio: mismatch.imgRatio,
            }),
            "warn",
          ),
        )
      }
    }
  },
})

function firstPictureRatioMismatch(
  graph: SolidGraph,
  picture: JSXElementEntity,
): { sourceRatio: string; imgRatio: string } | null {
  let fallbackRatio: number | null = null
  const pendingSourceRatios: number[] = []

  for (let i = 0; i < picture.childElements.length; i++) {
    const child = picture.childElements[i]
    if (!child) continue
    const tag = child.tagName
    if (!tag) continue

    if (tag === "source") {
      const sourceRatio = elementIntrinsicRatio(graph, child)
      if (sourceRatio === null) continue
      if (fallbackRatio === null) {
        pendingSourceRatios.push(sourceRatio)
        continue
      }
      if (isRatioEquivalent(sourceRatio, fallbackRatio)) continue
      return {
        sourceRatio: formatRatio(sourceRatio),
        imgRatio: formatRatio(fallbackRatio),
      }
    }

    if (tag !== "img") continue
    if (fallbackRatio !== null) continue
    fallbackRatio = elementIntrinsicRatio(graph, child)
    if (fallbackRatio === null) continue

    for (let j = 0; j < pendingSourceRatios.length; j++) {
      const sourceRatio = pendingSourceRatios[j]
      if (sourceRatio === undefined) continue
      if (isRatioEquivalent(sourceRatio, fallbackRatio)) continue
      return {
        sourceRatio: formatRatio(sourceRatio),
        imgRatio: formatRatio(fallbackRatio),
      }
    }
  }

  return null
}

function elementIntrinsicRatio(graph: SolidGraph, element: JSXElementEntity): number | null {
  const width = readPositiveAttributeNumber(graph, element, "width")
  const height = readPositiveAttributeNumber(graph, element, "height")
  if (width === null || height === null) return null
  return width / height
}

function readPositiveAttributeNumber(
  graph: SolidGraph,
  element: JSXElementEntity,
  name: string,
): number | null {
  const numeric = getStaticNumericJSXAttributeValue(graph, element, name)
  if (numeric === null) return null
  if (numeric <= 0) return null
  return numeric
}

function isRatioEquivalent(left: number, right: number): boolean {
  const delta = Math.abs(left - right)
  const baseline = Math.max(Math.abs(left), Math.abs(right), 1)
  return delta / baseline <= RATIO_DELTA_THRESHOLD
}

function formatRatio(value: number): string {
  return formatFixed(value, 3)
}
