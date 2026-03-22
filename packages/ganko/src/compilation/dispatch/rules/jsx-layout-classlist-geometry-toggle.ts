import ts from "typescript"
import type { SelectorEntity } from "../../../css/entities/selector"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { LAYOUT_CLASS_GEOMETRY_PROPERTIES } from "../../../css/layout-taxonomy"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { constantTruthiness } from "../../../solid/util/static-value"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  classListGeometryToggle:
    "classList toggles '{{className}}', and matching CSS changes layout-affecting '{{property}}', which can cause CLS.",
} as const

const OUT_OF_FLOW_POSITIONS = new Set(["fixed", "absolute"])

export const jsxLayoutClasslistGeometryToggle = defineAnalysisRule({
  id: "jsx-layout-classlist-geometry-toggle",
  severity: "warn",
  messages,
  meta: {
    description: "Flag classList-driven class toggles that map to layout-affecting CSS geometry changes.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, symbolTable, emit) => {
      const classGeometryIndex = symbolTable.layoutPropertiesByClassToken
      if (classGeometryIndex.size === 0) return

      const properties = solidTree.classListProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const objectProperty = entry.property
        if (!ts.isPropertyAssignment(objectProperty)) continue

        const className = getPropertyKeyName(objectProperty.name)
        if (!className) continue
        if (!isDynamicallyToggleable(objectProperty.initializer)) continue

        const riskyProperty = classGeometryIndex.get(className)
        if (!riskyProperty || riskyProperty.length === 0) continue

        const property = firstGeometryProperty(riskyProperty)
        if (!property) continue

        if (classEstablishesOutOfFlow(className, symbolTable)) continue

        emit(
          createDiagnostic(
            solidTree.filePath,
            objectProperty.initializer,
            solidTree.sourceFile,
            jsxLayoutClasslistGeometryToggle.id,
            "classListGeometryToggle",
            resolveMessage(messages.classListGeometryToggle, { className, property }),
            "warn",
          ),
        )
      }
    })
  },
})

function classEstablishesOutOfFlow(
  className: string,
  symbolTable: import("../../symbols/symbol-table").SymbolTable,
): boolean {
  for (const [, symbol] of symbolTable.selectors) {
    if (!selectorAnchorHasClass(symbol.entity, className)) continue

    const positionDecls = symbol.entity.rule.declarationIndex.get("position")
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

function selectorAnchorHasClass(selector: SelectorEntity, className: string): boolean {
  const classes = selector.anchor.classes
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === className) return true
  }
  return false
}

function firstGeometryProperty(properties: readonly string[]): string | null {
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]
    if (!property) continue
    if (!LAYOUT_CLASS_GEOMETRY_PROPERTIES.has(property)) continue
    return property
  }
  return null
}

function isDynamicallyToggleable(node: ts.Node): boolean {
  return constantTruthiness(node) === null
}
