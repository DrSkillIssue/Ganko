/**
 * Cross-File Policy: Touch Targets
 *
 * Enforces minimum heights, widths, and padding for interactive elements
 * (buttons, inputs, links) based on the active accessibility policy template.
 *
 * Unlike the CSS-only predecessor, this rule uses the Layout graph to resolve
 * cascade-applied values (including Tailwind utilities and component-scoped
 * CSS) onto concrete JSX elements, catching class-based sizing violations
 * that pure selector-pattern matching cannot detect.
 */

import { defineCrossRule } from "../rule"
import {
  type LayoutElementNode,
  type LayoutGraph,
  type LayoutSignalSnapshot,
  type LayoutSignalName,
  collectSignalSnapshot,
  readKnownPx,
  readKnownNormalized,
  readKnownSignalWithGuard,
  readElementRef,
  readReservedSpaceFact,
  readConditionalSignalDeltaFact,
  LayoutSignalGuard,
} from "../layout"
import { getActivePolicy, getActivePolicyName } from "../../css/policy"
import { parsePxValue } from "../../css/parser/value-util"
import { emitLayoutDiagnostic, formatRounded } from "./rule-runtime"
import { getJSXAttributeEntity } from "../../solid/queries/jsx"
import { getStaticStringFromJSXValue } from "../../solid/util/static-value"
import type { SolidGraph } from "../../solid/impl"
import type { JSXElementEntity } from "../../solid/entities/jsx"

const messages = {
  heightTooSmall: "`{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  widthTooSmall: "`{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  paddingTooSmall: "Horizontal padding `{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  noReservedBlockSize: "Interactive element `<{{tag}}>` has no declared height (minimum `{{min}}px` required by policy `{{policy}}`). The element is content-sized and may not meet the touch-target threshold.",
  noReservedInlineSize: "Interactive element `<{{tag}}>` has no declared width (minimum `{{min}}px` required by policy `{{policy}}`). The element is content-sized and may not meet the touch-target threshold.",
} as const

/** Native HTML tags that are inherently interactive touch targets. */
const INTERACTIVE_HTML_TAGS = new Set(["button", "a", "input", "select", "textarea", "label", "summary"])

/**
 * ARIA roles whose purpose is direct user interaction. Elements with these roles
 * are touch targets and must meet minimum-size thresholds.
 */
const INTERACTIVE_ARIA_ROLES = new Set([
  "button", "link", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "tab",
])

type InteractiveKind = "button" | "input"

function classifyInteractive(
  node: LayoutElementNode,
  solid: SolidGraph,
  element: JSXElementEntity,
  layout: LayoutGraph,
): InteractiveKind | null {
  const tag = node.tagName

  // Native DOM tag check
  if (tag !== null && INTERACTIVE_HTML_TAGS.has(tag)) {
    if (tag === "input" || tag === "select" || tag === "textarea") return "input"
    return "button"
  }

  // Explicit ARIA role attribute on the call site
  const roleAttr = getJSXAttributeEntity(solid, element, "role")
  if (roleAttr !== null && roleAttr.valueNode !== null) {
    const role = getStaticStringFromJSXValue(roleAttr.valueNode)
    if (role !== null && INTERACTIVE_ARIA_ROLES.has(role)) return "button"
  }

  // Component call site that resolves to a native interactive DOM element
  const hostRef = layout.hostElementRefsByNode.get(node) ?? null
  if (hostRef !== null && hostRef.element.tagName !== null) {
    const hostTag = hostRef.element.tagName
    if (INTERACTIVE_HTML_TAGS.has(hostTag)) {
      if (hostTag === "input" || hostTag === "select" || hostTag === "textarea") return "input"
      return "button"
    }
  }

  return null
}

/**
 * Detects visually hidden interactive elements — inputs or buttons removed from
 * visual presentation via known accessible hidden patterns:
 *
 * 1. `position: absolute/fixed` + `opacity: 0` — standard hidden input pattern
 * 2. `position: absolute/fixed` + `width: 1px; height: 1px` — sr-only pattern
 *    used by Tailwind sr-only, Kobalte, Radix, and most component libraries
 *    where the actual touch target is a parent `<label>` or sibling control.
 */
function isVisuallyHidden(snapshot: LayoutSignalSnapshot): boolean {
  const position = readKnownNormalized(snapshot, "position")
  if (position !== "absolute" && position !== "fixed") return false

  // Opacity is not a layout signal tracked by the layout graph.
  // Fall back to checking the raw cascade for opacity: 0.
  const node = snapshot.node
  const opacityAttr = node.inlineStyleValues.get("opacity")
  if (opacityAttr === "0") return true

  // Check if any class token resolves to opacity: 0 via the class token set.
  // Tailwind `opacity-0` class is a common pattern.
  if (node.classTokenSet.has("opacity-0")) return true

  // sr-only pattern: position: absolute + exactly 1px × 1px dimensions.
  // Used by Kobalte, Radix, Tailwind sr-only, Bootstrap visually-hidden.
  // Uses exact 1px check — 0px indicates a collapsed element, not sr-only.
  const width = readKnownPx(snapshot, "width")
  const height = readKnownPx(snapshot, "height")
  if (width === 1 && height === 1) return true

  return false
}

export const jsxLayoutPolicyTouchTarget = defineCrossRule({
  id: "jsx-layout-policy-touch-target",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum interactive element sizes per accessibility policy via resolved layout signals.",
    fixable: false,
    category: "css-a11y",
  },
  check(context, emit) {
    const policy = getActivePolicy()
    if (policy === null) return
    const policyName = getActivePolicyName() ?? ""

    const { layout } = context
    const elements = layout.elements

    for (let i = 0; i < elements.length; i++) {
      const node = elements[i]
      if (!node) continue

      const ref = readElementRef(layout, node)
      if (!ref) continue

      const kind = classifyInteractive(node, ref.solid, ref.element, layout)
      if (kind === null) continue

      const snapshot = collectSignalSnapshot(context, node)

      // Skip visually hidden elements (accessible hidden input pattern)
      if (isVisuallyHidden(snapshot)) continue

      const tag = node.tagName ?? node.tag ?? "element"

      // --- Height checks ---
      checkDimension(
        snapshot, "height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        layout, node, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName,
      )
      checkDimension(
        snapshot, "min-height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        layout, node, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName,
      )
      checkDimension(
        snapshot, "max-height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        layout, node, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName,
      )

      // --- Width checks ---
      checkDimension(
        snapshot, "width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        layout, node, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName,
      )
      checkDimension(
        snapshot, "min-width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        layout, node, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName,
      )
      checkDimension(
        snapshot, "max-width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        layout, node, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName,
      )

      // --- Horizontal padding checks (buttons only) ---
      if (kind === "button") {
        checkDimension(
          snapshot, "padding-left", policy.minButtonHorizontalPadding,
          layout, node, emit, "paddingTooSmall", messages.paddingTooSmall, tag, policyName,
        )
        checkDimension(
          snapshot, "padding-right", policy.minButtonHorizontalPadding,
          layout, node, emit, "paddingTooSmall", messages.paddingTooSmall, tag, policyName,
        )
      }

      // --- No reserved size checks ---
      // Interactive elements with no declared dimensions are content-sized and
      // may not meet touch-target thresholds. Use ReservedSpaceFact to detect
      // elements that lack any usable block or inline dimension declaration.
      const reservedSpace = readReservedSpaceFact(layout, node)
      const minBlock = kind === "button" ? policy.minButtonHeight : policy.minInputHeight
      const minInline = kind === "button" ? policy.minButtonWidth : policy.minTouchTarget

      if (!reservedSpace.hasDeclaredBlockDimension) {
        emitLayoutDiagnostic(
          layout, node, emit,
          jsxLayoutPolicyTouchTarget.id, "noReservedBlockSize", messages.noReservedBlockSize,
          "warn",
          { tag, min: String(minBlock), policy: policyName },
        )
      }

      if (!reservedSpace.hasDeclaredInlineDimension) {
        emitLayoutDiagnostic(
          layout, node, emit,
          jsxLayoutPolicyTouchTarget.id, "noReservedInlineSize", messages.noReservedInlineSize,
          "warn",
          { tag, min: String(minInline), policy: policyName },
        )
      }
    }
  },
})

function checkDimension(
  snapshot: LayoutSignalSnapshot,
  signal: "height" | "min-height" | "max-height" | "width" | "min-width" | "max-width" | "padding-left" | "padding-right",
  min: number,
  layout: LayoutGraph,
  node: LayoutElementNode,
  emit: Parameters<typeof emitLayoutDiagnostic>[2],
  messageId: string,
  template: string,
  tag: string,
  policyName: string,
): void {
  let px = readKnownPx(snapshot, signal)

  // When readKnownPx returns null because a conditional selector (higher
  // specificity) shadowed the unconditional value, fall back to the guaranteed
  // unconditional base value from the delta fact system. This prevents false
  // 0px reports when component CSS has a conditional variant (e.g., [data-icon])
  // that shadows the base sizing (e.g., [data-size="md"]).
  if (px === null) {
    const signalValue = readKnownSignalWithGuard(snapshot, signal)
    if (signalValue !== null && signalValue.guard.kind === LayoutSignalGuard.Conditional) {
      px = resolveUnconditionalFallbackPx(layout, node, signal)
    }
  }

  if (px === null) return
  if (px >= min) return

  emitLayoutDiagnostic(
    layout, node, emit,
    jsxLayoutPolicyTouchTarget.id, messageId, template,
    "warn",
    {
      signal,
      value: formatRounded(px),
      min: String(min),
      tag,
      policy: policyName,
    },
  )
}

/**
 * Resolves the best unconditional px value for a signal from the conditional
 * delta fact system. When a conditional selector shadows the unconditional
 * cascade winner, the delta fact's `unconditionalValues` retains the guaranteed
 * base values (already var()-substituted at declaration collection time).
 */
function resolveUnconditionalFallbackPx(
  layout: LayoutGraph,
  node: LayoutElementNode,
  signal: LayoutSignalName,
): number | null {
  const delta = readConditionalSignalDeltaFact(layout, node, signal)
  if (!delta.hasConditional) return null

  const values = delta.unconditionalValues
  let bestPx: number | null = null

  for (let i = 0; i < values.length; i++) {
    const raw = values[i]
    if (!raw) continue
    const px = parsePxValue(raw)
    if (px === null) continue
    // Use the largest unconditional value — it's the highest-specificity
    // unconditional declaration that would have won without conditional shadowing
    if (bestPx === null || px > bestPx) bestPx = px
  }

  return bestPx
}
