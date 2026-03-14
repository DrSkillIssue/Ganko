import { readElementRef, readElementRefById, readKnownPx, LayoutTextualContentState } from "../layout"
import type { LayoutElementNode, LayoutGraph, LayoutSignalName, LayoutSignalSnapshot } from "../layout"
import { createDiagnostic, resolveMessage, effectiveSeverity } from "../../diagnostic"
import type { Emit } from "../../graph"
import { toKebabCase, type RuleSeverityOverride } from "@drskillissue/ganko-shared"

const SECTIONING_CONTAINER_TAGS = new Set(["section", "article", "main"])
const VIEWPORT_CONTAINER_TAGS = new Set(["html", "body", "main", "section", "article", "div"])

export function normalizeStylePropertyKey(key: string): string {
  if (key.includes("-")) return key.toLowerCase()
  return toKebabCase(key)
}

export function readNodeRef(layout: LayoutGraph, node: LayoutElementNode) {
  return readElementRef(layout, node)
}

export function readNodeRefById(layout: LayoutGraph, solidFile: string, elementId: number) {
  return readElementRefById(layout, solidFile, elementId)
}

export function isFlowRelevantBySiblingsOrText(
  node: LayoutElementNode,
  textualContent: LayoutSignalSnapshot["textualContent"],
): boolean {
  if (node.siblingCount >= 2) return true
  return textualContent === LayoutTextualContentState.Yes || textualContent === LayoutTextualContentState.Unknown || textualContent === LayoutTextualContentState.DynamicText
}

export function isDeferredContainerLike(
  node: LayoutElementNode,
  textualContent: LayoutSignalSnapshot["textualContent"],
): boolean {
  if (node.siblingCount >= 2) return true
  if (textualContent === LayoutTextualContentState.Unknown) return true
  if (node.tagName !== null && SECTIONING_CONTAINER_TAGS.has(node.tagName)) return true
  return false
}

export function isDynamicContainerLike(node: LayoutElementNode): boolean {
  return node.textualContent === LayoutTextualContentState.Unknown && node.siblingCount >= 2
}

export function isLikelyViewportAffectingContainer(node: LayoutElementNode): boolean {
  if (node.siblingCount >= 2) return true
  if (node.parentElementNode === null) return true
  if (node.tagName !== null && VIEWPORT_CONTAINER_TAGS.has(node.tagName)) return true
  return false
}

export function hasAnyPositiveKnownPx(
  snapshot: LayoutSignalSnapshot,
  properties: readonly LayoutSignalName[],
): boolean {
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    if (!prop) continue
    const value = readKnownPx(snapshot, prop)
    if (value !== null && value > 0) return true
  }
  return false
}

export function formatFixed(value: number, digits = 2): string {
  return value.toFixed(digits)
}

export function formatRounded(value: number, digits = 2): string {
  const scale = 10 ** digits
  return String(Math.round(value * scale) / scale)
}

/**
 * Resolve a layout element to its source ref and emit a diagnostic.
 * Returns false when the element has no source ref (caller should `continue`).
 */
export function emitLayoutDiagnostic(
  layout: LayoutGraph,
  node: LayoutElementNode,
  emit: Emit,
  ruleId: string,
  messageId: string,
  template: string,
  severity: RuleSeverityOverride,
  data?: Record<string, string>,
): boolean {
  const ref = readElementRef(layout, node)
  if (!ref) return false
  const tag = node.tagName ?? "element"
  const merged = data ? { tag, ...data } : { tag }
  emit(
    createDiagnostic(
      ref.solid.file,
      ref.element.node,
      ruleId,
      messageId,
      resolveMessage(template, merged),
      effectiveSeverity(severity),
    ),
  )
  return true
}
