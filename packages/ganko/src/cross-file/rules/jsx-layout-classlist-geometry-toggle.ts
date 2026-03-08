import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SelectorEntity } from "../../css/entities/selector"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { LAYOUT_CLASS_GEOMETRY_PROPERTIES } from "../../css/layout-taxonomy"
import { forEachClassListPropertyAcross, objectKeyName } from "../../solid/queries/jsx-derived"
import { constantTruthiness } from "../../solid/util/static-value"
import { defineCrossRule } from "../rule"

const messages = {
  classListGeometryToggle:
    "classList toggles '{{className}}', and matching CSS changes layout-affecting '{{property}}', which can cause CLS.",
} as const

const OUT_OF_FLOW_POSITIONS = new Set(["fixed", "absolute"])

export const jsxLayoutClasslistGeometryToggle = defineCrossRule({
  id: "jsx-layout-classlist-geometry-toggle",
  severity: "warn",
  messages,
  meta: {
    description: "Flag classList-driven class toggles that map to layout-affecting CSS geometry changes.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const classGeometryIndex = context.css.layoutPropertiesByClassToken
    if (classGeometryIndex.size === 0) return

    forEachClassListPropertyAcross(context.solids, (solid, objectProperty) => {
      if (objectProperty.type !== "Property") return
      if (objectProperty.computed) return

      const className = objectKeyName(objectProperty.key)
      if (!className) return
      if (!isDynamicallyToggleable(objectProperty.value)) return

      const riskyProperty = classGeometryIndex.get(className)
      if (!riskyProperty || riskyProperty.length === 0) return

      const property = firstGeometryProperty(riskyProperty)
      if (!property) return

      // When the class establishes out-of-flow positioning (position: absolute/fixed),
      // toggling it moves the element OUT of normal flow. This reduces rather than
      // increases layout impact because the element no longer participates in flow
      // geometry. The reverse (removing the class to re-enter flow) is an intentional
      // content reveal. This exempts accessibility patterns like .sr-only which use
      // position: absolute + clipping to hide elements visually.
      if (classEstablishesOutOfFlow(className, context.css.selectors)) return

      emit(
        createDiagnostic(
          solid.file,
          objectProperty.value,
          jsxLayoutClasslistGeometryToggle.id,
          "classListGeometryToggle",
          resolveMessage(messages.classListGeometryToggle, {
            className,
            property,
          }),
          "warn",
        ),
      )
    })
  },
})

/**
 * Check if a class name, when applied, establishes out-of-flow positioning.
 *
 * Scans all selectors that include the class name in their anchor and checks
 * whether the associated rule sets position: absolute or position: fixed.
 * When a class moves an element out of flow, its geometry changes cannot
 * cause unexpected CLS to surrounding content.
 */
function classEstablishesOutOfFlow(
  className: string,
  selectors: readonly SelectorEntity[],
): boolean {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]
    if (!selector) continue
    if (!selectorAnchorHasClass(selector, className)) continue

    const positionDecls = selector.rule.declarationIndex.get("position")
    if (!positionDecls) continue

    for (let j = 0; j < positionDecls.length; j++) {
      const decl = positionDecls[j]
      if (!decl) continue
      const value = decl.value.trim().toLowerCase()
      if (OUT_OF_FLOW_POSITIONS.has(value)) return true
    }
  }

  return false
}

/**
 * Check if a selector's anchor classes include the given class name.
 */
function selectorAnchorHasClass(selector: SelectorEntity, className: string): boolean {
  const classes = selector.anchor.classes
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i]
    if (cls === className) return true
  }
  return false
}

function firstGeometryProperty(
  properties: readonly string[],
): string | null {
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]
    if (!property) continue
    if (!LAYOUT_CLASS_GEOMETRY_PROPERTIES.has(property)) continue
    return property
  }
  return null
}

function isDynamicallyToggleable(node: T.Node): boolean {
  const truthiness = constantTruthiness(node)
  return truthiness === null
}
