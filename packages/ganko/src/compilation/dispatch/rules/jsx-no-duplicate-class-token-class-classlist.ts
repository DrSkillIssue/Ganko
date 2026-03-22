import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  duplicateClassToken: "Class token `{{name}}` appears in both class and classList.",
} as const

export const jsxNoDuplicateClassTokenClassClasslist = defineAnalysisRule({
  id: "jsx-no-duplicate-class-token-class-classlist",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow duplicate class tokens between class and classList on the same JSX element.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCrossSyntaxAction((solidTree, _symbolTable, emit) => {
      for (const [elementId, classIndex] of solidTree.staticClassTokensByElementId) {
        if (classIndex.hasDynamicClass) continue
        const classListIndex = solidTree.staticClassListKeysByElementId.get(elementId)
        if (!classListIndex || classListIndex.hasDynamic || classListIndex.keys.length === 0) continue
        if (classIndex.tokens.length === 0) continue

        const classListSet = new Set<string>()
        for (let j = 0; j < classListIndex.keys.length; j++) {
          const key = classListIndex.keys[j]
          if (!key) continue
          classListSet.add(key)
        }

        const element = solidTree.jsxElements.find(e => e.id === elementId)
        if (!element) continue

        const seen = new Set<string>()
        for (let j = 0; j < classIndex.tokens.length; j++) {
          const token = classIndex.tokens[j]
          if (!token) continue
          if (seen.has(token)) continue
          seen.add(token)
          if (!classListSet.has(token)) continue

          emit(createDiagnostic(
            solidTree.filePath,
            element.node,
            solidTree.sourceFile,
            jsxNoDuplicateClassTokenClassClasslist.id,
            "duplicateClassToken",
            resolveMessage(messages.duplicateClassToken, { name: token }),
            "warn",
          ))
        }
      }
    })
  },
})
