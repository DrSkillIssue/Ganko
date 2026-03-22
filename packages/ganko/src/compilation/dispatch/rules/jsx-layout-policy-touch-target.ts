import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getActivePolicy, getActivePolicyName } from "../../../css/policy"
import { parsePxValue } from "../../../css/parser/value-util"
import { getJSXAttributeEntity } from "../../../solid/queries/jsx"
import { getStaticStringFromJSXValue } from "../../../solid/util/static-value"
import type { ElementNode } from "../../binding/element-builder"
import type { SignalSnapshot, LayoutSignalName } from "../../binding/signal-builder"
import { SignalValueKind } from "../../binding/signal-builder"
import { SignalGuardKind } from "../../binding/cascade-binder"
import type { FileSemanticModel } from "../../binding/semantic-model"
import { defineAnalysisRule, ComputationTier, type Emit } from "../rule"

const messages = {
  heightTooSmall: "`{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  widthTooSmall: "`{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  paddingTooSmall: "Horizontal padding `{{signal}}` of `{{value}}px` is below the minimum `{{min}}px` for interactive element `<{{tag}}>` in policy `{{policy}}`.",
  noReservedBlockSize: "Interactive element `<{{tag}}>` has no declared height (minimum `{{min}}px` required by policy `{{policy}}`). The element is content-sized and may not meet the touch-target threshold.",
  noReservedInlineSize: "Interactive element `<{{tag}}>` has no declared width (minimum `{{min}}px` required by policy `{{policy}}`). The element is content-sized and may not meet the touch-target threshold.",
} as const

const INTERACTIVE_HTML_TAGS = new Set(["button", "a", "input", "select", "textarea", "label", "summary"])
const INTERACTIVE_ARIA_ROLES = new Set([
  "button", "link", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "tab",
])

type InteractiveKind = "button" | "input"

export const jsxLayoutPolicyTouchTarget = defineAnalysisRule({
  id: "jsx-layout-policy-touch-target",
  severity: "warn",
  messages,
  meta: {
    description: "Enforce minimum interactive element sizes per accessibility policy via resolved layout signals.",
    fixable: false,
    category: "css-a11y",
  },
  requirement: { tier: ComputationTier.SelectiveLayoutFacts },
  register(registry) {
    registry.registerFactAction("reservedSpace", (element, reservedSpaceFact, semanticModel, emit) => {
      const policy = getActivePolicy()
      if (policy === null) return
      const policyName = getActivePolicyName() ?? ""

      const kind = classifyInteractive(element, semanticModel)
      if (kind === null) return

      const snapshot = semanticModel.getSignalSnapshot(element.elementId)
      if (isVisuallyHidden(element, snapshot)) return

      const tag = element.tagName ?? element.tag ?? "element"

      // Height checks
      checkDimension(snapshot, "height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        element, semanticModel, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName)
      checkDimension(snapshot, "min-height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        element, semanticModel, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName)
      checkDimension(snapshot, "max-height", kind === "button" ? policy.minButtonHeight : policy.minInputHeight,
        element, semanticModel, emit, "heightTooSmall", messages.heightTooSmall, tag, policyName)

      // Width checks
      checkDimension(snapshot, "width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        element, semanticModel, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName)
      checkDimension(snapshot, "min-width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        element, semanticModel, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName)
      checkDimension(snapshot, "max-width", kind === "button" ? policy.minButtonWidth : policy.minTouchTarget,
        element, semanticModel, emit, "widthTooSmall", messages.widthTooSmall, tag, policyName)

      // Horizontal padding checks (buttons only)
      if (kind === "button") {
        checkDimension(snapshot, "padding-left", policy.minButtonHorizontalPadding,
          element, semanticModel, emit, "paddingTooSmall", messages.paddingTooSmall, tag, policyName)
        checkDimension(snapshot, "padding-right", policy.minButtonHorizontalPadding,
          element, semanticModel, emit, "paddingTooSmall", messages.paddingTooSmall, tag, policyName)
      }

      // No reserved size checks
      const minBlock = kind === "button" ? policy.minButtonHeight : policy.minInputHeight
      const minInline = kind === "button" ? policy.minButtonWidth : policy.minTouchTarget

      if (!reservedSpaceFact.hasDeclaredBlockDimension) {
        emit(createDiagnostic(
          element.solidFile, element.jsxEntity.node, semanticModel.solidTree.sourceFile,
          jsxLayoutPolicyTouchTarget.id, "noReservedBlockSize",
          resolveMessage(messages.noReservedBlockSize, { tag, min: String(minBlock), policy: policyName }),
          "warn",
        ))
      }

      if (!reservedSpaceFact.hasDeclaredInlineDimension) {
        emit(createDiagnostic(
          element.solidFile, element.jsxEntity.node, semanticModel.solidTree.sourceFile,
          jsxLayoutPolicyTouchTarget.id, "noReservedInlineSize",
          resolveMessage(messages.noReservedInlineSize, { tag, min: String(minInline), policy: policyName }),
          "warn",
        ))
      }
    })
  },
})

function classifyInteractive(element: ElementNode, semanticModel: FileSemanticModel): InteractiveKind | null {
  const tag = element.tagName
  if (tag !== null && INTERACTIVE_HTML_TAGS.has(tag)) {
    if (tag === "input" || tag === "select" || tag === "textarea") return "input"
    return "button"
  }

  const roleAttr = getJSXAttributeEntity(semanticModel.solidTree, element.jsxEntity, "role")
  if (roleAttr !== null && roleAttr.valueNode !== null) {
    const role = getStaticStringFromJSXValue(roleAttr.valueNode)
    if (role !== null && INTERACTIVE_ARIA_ROLES.has(role)) return "button"
  }

  // Component call site resolved to a native interactive DOM element
  const hostSymbol = resolveHostTag(element, semanticModel)
  if (hostSymbol !== null && INTERACTIVE_HTML_TAGS.has(hostSymbol)) {
    if (hostSymbol === "input" || hostSymbol === "select" || hostSymbol === "textarea") return "input"
    return "button"
  }

  return null
}

function resolveHostTag(_element: ElementNode, _semanticModel: FileSemanticModel): string | null {
  return null
}

function isVisuallyHidden(element: ElementNode, snapshot: SignalSnapshot): boolean {
  const posSignal = snapshot.signals.get("position")
  if (!posSignal || posSignal.kind !== SignalValueKind.Known) return false
  if (posSignal.normalized !== "absolute" && posSignal.normalized !== "fixed") return false

  const opacityAttr = element.inlineStyleValues.get("opacity")
  if (opacityAttr === "0") return true

  if (element.classTokenSet.has("opacity-0")) return true

  const widthSignal = snapshot.signals.get("width")
  const heightSignal = snapshot.signals.get("height")
  if (widthSignal && widthSignal.kind === SignalValueKind.Known && widthSignal.px === 1
    && heightSignal && heightSignal.kind === SignalValueKind.Known && heightSignal.px === 1) return true

  return false
}

type DimensionSignal = "height" | "min-height" | "max-height" | "width" | "min-width" | "max-width" | "padding-left" | "padding-right"

function checkDimension(
  snapshot: SignalSnapshot,
  signal: DimensionSignal,
  min: number,
  element: ElementNode,
  semanticModel: FileSemanticModel,
  emit: Emit,
  messageId: string,
  template: string,
  tag: string,
  policyName: string,
): void {
  let px = readKnownPx(snapshot, signal)

  if (px === null) {
    const signalValue = snapshot.signals.get(signal)
    if (signalValue !== null && signalValue !== undefined && signalValue.guard.kind === SignalGuardKind.Conditional) {
      px = resolveUnconditionalFallbackPx(semanticModel, element.elementId, signal)
    }
  }

  if (px === null) return
  if (px >= min) return

  emit(createDiagnostic(
    element.solidFile, element.jsxEntity.node, semanticModel.solidTree.sourceFile,
    jsxLayoutPolicyTouchTarget.id, messageId,
    resolveMessage(template, {
      signal,
      value: formatRounded(px),
      min: String(min),
      tag,
      policy: policyName,
    }),
    "warn",
  ))
}

function readKnownPx(snapshot: SignalSnapshot, name: LayoutSignalName): number | null {
  const sig = snapshot.signals.get(name)
  if (!sig || sig.kind !== SignalValueKind.Known) return null
  return sig.px
}

function formatRounded(value: number, digits = 2): string {
  const scale = 10 ** digits
  return String(Math.round(value * scale) / scale)
}

function resolveUnconditionalFallbackPx(
  semanticModel: FileSemanticModel,
  elementId: number,
  signal: LayoutSignalName,
): number | null {
  const deltaMap = semanticModel.getConditionalDelta(elementId)
  if (!deltaMap) return null
  const delta = deltaMap.get(signal)
  if (!delta || !delta.hasConditional) return null

  const values = delta.unconditionalValues
  let bestPx: number | null = null

  for (let i = 0; i < values.length; i++) {
    const raw = values[i]
    if (!raw) continue
    const px = parsePxValue(raw)
    if (px === null) continue
    if (bestPx === null || px > bestPx) bestPx = px
  }

  return bestPx
}
