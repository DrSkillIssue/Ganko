import ts from "typescript"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getPropertyKeyName } from "../../../solid/util/pattern-detection"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unusedInlineVar: "Inline custom property `{{name}}` is never read via var({{name}}).",
} as const

export const jsxStyleNoUnusedCustomProp = defineAnalysisRule({
  id: "jsx-style-no-unused-custom-prop",
  severity: "warn",
  messages,
  meta: {
    description: "Detect inline style custom properties that are never consumed by CSS var() references.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, symbolTable, emit) => {
      // Collect used CSS variable names from symbol table
      const usedVarNames = new Set<string>()
      for (const [name] of symbolTable.customProperties) {
        usedVarNames.add(name)
      }

      // Skip files with classList (dynamic class application makes usage unpredictable)
      if (solidTree.jsxClassListAttributes.length > 0) return

      // Check for files with only static class literals
      let hasNonStaticClass = false
      for (const [, idx] of solidTree.staticClassTokensByElementId) {
        if (idx.hasDynamicClass) { hasNonStaticClass = true; break }
      }
      if (hasNonStaticClass) return

      const properties = solidTree.styleProperties
      for (let i = 0; i < properties.length; i++) {
        const entry = properties[i]
        if (!entry) continue
        const p = entry.property
        if (!ts.isPropertyAssignment(p)) continue
        const n = getPropertyKeyName(p.name)
        if (!n || !n.startsWith("--")) continue
        if (usedVarNames.has(n)) continue

        emit(createDiagnostic(
          solidTree.filePath,
          p.name,
          solidTree.sourceFile,
          jsxStyleNoUnusedCustomProp.id,
          "unusedInlineVar",
          resolveMessage(messages.unusedInlineVar, { name: n }),
          "warn",
        ))
      }
    })
  },
})
