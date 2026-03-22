import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  undefinedClass: "CSS class '{{className}}' is not defined in project CSS files",
} as const

export const jsxNoUndefinedCssClass = defineAnalysisRule({
  id: "jsx-no-undefined-css-class",
  severity: "error",
  messages,
  meta: {
    description: "Detect undefined CSS class names in JSX",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, symbolTable, emit) => {
      const seenByElementId = new Map<number, Set<string>>()

      for (const [elementId, idx] of solidTree.staticClassTokensByElementId) {
        if (idx.hasDynamicClass) continue
        const tokens = idx.tokens
        for (let i = 0; i < tokens.length; i++) {
          const name = tokens[i]
          if (!name) continue
          const existing = seenByElementId.get(elementId)
          if (existing) { if (existing.has(name)) continue; existing.add(name) }
          else { const next = new Set<string>(); next.add(name); seenByElementId.set(elementId, next) }
          if (symbolTable.classNames.has(name)) continue
          if (solidTree.inlineStyleClassNames.has(name)) continue

          const element = solidTree.jsxElements.find(e => e.id === elementId)
          if (!element) continue

          emit(createDiagnostic(
            solidTree.filePath, element.node, solidTree.sourceFile,
            jsxNoUndefinedCssClass.id, "undefinedClass",
            resolveMessage(messages.undefinedClass, { className: name }), "error",
          ))
        }
      }

      for (const [elementId, idx] of solidTree.staticClassListKeysByElementId) {
        const keys = idx.keys
        for (let i = 0; i < keys.length; i++) {
          const name = keys[i]
          if (!name) continue
          const existing = seenByElementId.get(elementId)
          if (existing) { if (existing.has(name)) continue; existing.add(name) }
          else { const next = new Set<string>(); next.add(name); seenByElementId.set(elementId, next) }
          if (symbolTable.classNames.has(name)) continue
          if (solidTree.inlineStyleClassNames.has(name)) continue

          const element = solidTree.jsxElements.find(e => e.id === elementId)
          if (!element) continue

          emit(createDiagnostic(
            solidTree.filePath, element.node, solidTree.sourceFile,
            jsxNoUndefinedCssClass.id, "undefinedClass",
            resolveMessage(messages.undefinedClass, { className: name }), "error",
          ))
        }
      }
    })
  },
})
