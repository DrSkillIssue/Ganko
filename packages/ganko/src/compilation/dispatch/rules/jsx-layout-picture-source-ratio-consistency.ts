import type { JSXElementEntity } from "../../../solid/entities/jsx"
import type { SolidSyntaxTree } from "../../core/solid-syntax-tree"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getJSXElementsByTag, getStaticNumericJSXAttributeValue } from "../../../solid/queries"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  inconsistentPictureRatio:
    "`<picture>` source ratio {{sourceRatio}} differs from fallback img ratio {{imgRatio}}, which can cause reserved-space mismatch and CLS.",
} as const

const RATIO_DELTA_THRESHOLD = 0.02

export const jsxLayoutPictureSourceRatioConsistency = defineAnalysisRule({
  id: "jsx-layout-picture-source-ratio-consistency",
  severity: "warn",
  messages,
  meta: {
    description: "Require consistent intrinsic aspect ratios across <picture> sources and fallback image.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      const pictures = getJSXElementsByTag(solidTree, "picture")
      for (let j = 0; j < pictures.length; j++) {
        const picture = pictures[j]
        if (!picture) continue
        const mismatch = firstPictureRatioMismatch(solidTree, picture)
        if (!mismatch) continue

        emit(createDiagnostic(
          solidTree.filePath,
          picture.node,
          solidTree.sourceFile,
          jsxLayoutPictureSourceRatioConsistency.id,
          "inconsistentPictureRatio",
          resolveMessage(messages.inconsistentPictureRatio, {
            sourceRatio: mismatch.sourceRatio,
            imgRatio: mismatch.imgRatio,
          }),
          "warn",
        ))
      }
    })
  },
})

function firstPictureRatioMismatch(tree: SolidSyntaxTree, picture: JSXElementEntity): { sourceRatio: string; imgRatio: string } | null {
  let fallbackRatio: number | null = null
  const pendingSourceRatios: number[] = []

  for (let i = 0; i < picture.childElements.length; i++) {
    const child = picture.childElements[i]
    if (!child) continue
    const tag = child.tagName
    if (!tag) continue

    if (tag === "source") {
      const sourceRatio = elementIntrinsicRatio(tree, child)
      if (sourceRatio === null) continue
      if (fallbackRatio === null) { pendingSourceRatios.push(sourceRatio); continue }
      if (isRatioEquivalent(sourceRatio, fallbackRatio)) continue
      return { sourceRatio: formatRatio(sourceRatio), imgRatio: formatRatio(fallbackRatio) }
    }

    if (tag !== "img") continue
    if (fallbackRatio !== null) continue
    fallbackRatio = elementIntrinsicRatio(tree, child)
    if (fallbackRatio === null) continue

    for (let j = 0; j < pendingSourceRatios.length; j++) {
      const sourceRatio = pendingSourceRatios[j]
      if (sourceRatio === undefined) continue
      if (isRatioEquivalent(sourceRatio, fallbackRatio)) continue
      return { sourceRatio: formatRatio(sourceRatio), imgRatio: formatRatio(fallbackRatio) }
    }
  }

  return null
}

function elementIntrinsicRatio(tree: SolidSyntaxTree, element: JSXElementEntity): number | null {
  const width = getStaticNumericJSXAttributeValue(tree, element, "width")
  const height = getStaticNumericJSXAttributeValue(tree, element, "height")
  if (width === null || height === null || width <= 0 || height <= 0) return null
  return width / height
}

function isRatioEquivalent(left: number, right: number): boolean {
  const delta = Math.abs(left - right)
  const baseline = Math.max(Math.abs(left), Math.abs(right), 1)
  return delta / baseline <= RATIO_DELTA_THRESHOLD
}

function formatRatio(value: number): string {
  return value.toFixed(3)
}
