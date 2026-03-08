import { createDiagnosticFromLoc, resolveMessage } from "../../diagnostic"
import { LAYOUT_POSITIONED_OFFSET_PROPERTIES } from "../../css/layout-taxonomy"
import { parseBlockShorthand, parseQuadShorthand } from "../../css/parser/value-tokenizer"
import {
  readStatefulBaseValueIndex,
  readStatefulNormalizedDeclarationsByRuleId,
  readStatefulSelectorEntriesByRuleId,
} from "../layout"
import type { LayoutNormalizedRuleDeclaration, LayoutStatefulSelectorEntry } from "../layout"
import { defineCrossRule } from "../rule"

const messages = {
  statefulBoxModelShift:
    "State selector '{{selector}}' changes layout-affecting '{{property}}'. Keep geometry stable across states to avoid CLS.",
} as const

export const cssLayoutStatefulBoxModelShift = defineCrossRule({
  id: "css-layout-stateful-box-model-shift",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow stateful selector changes that alter element geometry and trigger layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const baseValueIndex = readStatefulBaseValueIndex(context.layout)
    const reported = new Set<number>()

    for (let i = 0; i < context.css.rules.length; i++) {
      const rule = context.css.rules[i]
      if (!rule) continue
      const selectors = readStatefulSelectorEntriesByRuleId(context.layout, rule.id)
      if (selectors.length === 0) continue

      const declarations = readStatefulNormalizedDeclarationsByRuleId(context.layout, rule.id)
      if (declarations.length === 0) continue

      for (let j = 0; j < declarations.length; j++) {
        const declaration = declarations[j]
        if (!declaration) continue
        if (declaration.property === "position") continue
        if (reported.has(declaration.declarationId)) continue

        const match = firstStatefulSelectorWithDelta(
          selectors,
          declaration.property,
          declaration.normalizedValue,
          baseValueIndex,
        )
        if (!match) continue
        if (LAYOUT_POSITIONED_OFFSET_PROPERTIES.has(declaration.property)
          && !hasStatefulPositionContext(selectors, declarations, baseValueIndex)) {
          continue
        }

        // Transform/translate on direct-interaction selectors (hover, active, focus)
        // is intentional visual feedback, not unexpected CLS.
        if (isVisualFeedbackTransform(declaration.property, match.isDirectInteraction)) continue

        emit(
          createDiagnosticFromLoc(
            declaration.filePath,
            {
              start: { line: declaration.startLine, column: declaration.startColumn },
              end: { line: declaration.startLine, column: declaration.startColumn + declaration.propertyLength },
            },
            cssLayoutStatefulBoxModelShift.id,
            "statefulBoxModelShift",
            resolveMessage(messages.statefulBoxModelShift, {
              selector: match.raw,
              property: declaration.property,
            }),
            "warn",
          ),
        )
        reported.add(declaration.declarationId)
      }
    }
  },
})

/**
 * Returns true when a property change is purely visual feedback on a direct-interaction
 * selector. `transform` and `translate` operate on the GPU compositing layer without
 * triggering layout reflow. When the state trigger is a direct user interaction (hover,
 * active, focus), the visual shift is an expected response and not an unexpected CLS event.
 */
function isVisualFeedbackTransform(property: string, isDirectInteraction: boolean): boolean {
  if (!isDirectInteraction) return false
  return property === "transform" || property === "translate"
}

interface StatefulSelectorMatch {
  readonly raw: string
  readonly isDirectInteraction: boolean
}

function firstStatefulSelectorWithDelta(
  selectors: readonly LayoutStatefulSelectorEntry[],
  property: string,
  stateValue: string,
  baseValueIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
): StatefulSelectorMatch | null {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]
    if (!selector) continue
    if (!selector.isStateful) continue
    if (selector.baseLookupKeys.length === 0) return { raw: selector.raw, isDirectInteraction: selector.isDirectInteraction }

    const baseByProperty = lookupBaseByProperty(baseValueIndex, selector.baseLookupKeys)
    if (!baseByProperty) return { raw: selector.raw, isDirectInteraction: selector.isDirectInteraction }

    if (!matchesBasePropertyValue(baseByProperty, property, stateValue)) return { raw: selector.raw, isDirectInteraction: selector.isDirectInteraction }
  }

  return null
}

function hasStatefulPositionContext(
  selectors: readonly LayoutStatefulSelectorEntry[],
  declarations: readonly LayoutNormalizedRuleDeclaration[],
  baseValueIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
): boolean {
  if (hasNonStaticPositionInDeclarations(declarations)) return true

  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]
    if (!selector) continue
    if (!selector.isStateful) continue
    if (selector.baseLookupKeys.length === 0) continue

    const baseByProperty = lookupBaseByProperty(baseValueIndex, selector.baseLookupKeys)
    if (!baseByProperty) continue
    const positionValues = baseByProperty.get("position")
    if (!positionValues) continue

    for (const value of positionValues) {
      if (value !== "static") return true
    }
  }

  return false
}

function hasNonStaticPositionInDeclarations(
  declarations: readonly LayoutNormalizedRuleDeclaration[],
): boolean {
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    if (!decl) continue
    if (decl.property !== "position") continue
    if (decl.normalizedValue !== "static") return true
  }
  return false
}

function matchesBasePropertyValue(
  baseByProperty: ReadonlyMap<string, ReadonlySet<string>>,
  property: string,
  stateValue: string,
): boolean {
  if (hasBaseValue(baseByProperty, property, stateValue)) return true

  if (property === "padding" || property === "margin" || property === "border-width" || property === "inset") {
    const quad = parseQuadShorthand(stateValue)
    if (!quad) return false

    if (property === "padding") {
      return hasBaseValue(baseByProperty, "padding-top", quad.top)
        && hasBaseValue(baseByProperty, "padding-bottom", quad.bottom)
        && hasBaseValue(baseByProperty, "padding-left", quad.left)
        && hasBaseValue(baseByProperty, "padding-right", quad.right)
    }

    if (property === "margin") {
      return hasBaseValue(baseByProperty, "margin-top", quad.top)
        && hasBaseValue(baseByProperty, "margin-bottom", quad.bottom)
        && hasBaseValue(baseByProperty, "margin-left", quad.left)
        && hasBaseValue(baseByProperty, "margin-right", quad.right)
    }

    if (property === "border-width") {
      return hasBaseValue(baseByProperty, "border-top-width", quad.top)
        && hasBaseValue(baseByProperty, "border-bottom-width", quad.bottom)
        && hasBaseValue(baseByProperty, "border-left-width", quad.left)
        && hasBaseValue(baseByProperty, "border-right-width", quad.right)
    }

    return hasBaseValue(baseByProperty, "top", quad.top)
      && hasBaseValue(baseByProperty, "bottom", quad.bottom)
  }

  if (property === "inset-block") {
    const block = parseBlockShorthand(stateValue)
    if (!block) return false
    return hasBaseValue(baseByProperty, "inset-block-start", block.start)
      && hasBaseValue(baseByProperty, "inset-block-end", block.end)
  }

  return false
}

function hasBaseValue(
  baseByProperty: ReadonlyMap<string, ReadonlySet<string>>,
  property: string,
  expectedValue: string,
): boolean {
  const values = baseByProperty.get(property)
  if (!values) return false
  return values.has(expectedValue)
}

function lookupBaseByProperty(
  baseValueIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
  selectorKeys: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> | null {
  for (let i = 0; i < selectorKeys.length; i++) {
    const key = selectorKeys[i]
    if (!key) continue
    const value = baseValueIndex.get(key)
    if (value) return value
  }
  return null
}
