import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  unreferencedClass: "CSS class '{{className}}' is defined but not referenced by static JSX class attributes",
} as const

export const cssNoUnreferencedComponentClass = defineAnalysisRule({
  id: "css-no-unreferenced-component-class",
  severity: "warn",
  messages,
  meta: {
    description: "Detect CSS classes that are never referenced by static JSX class attributes.",
    fixable: false,
    category: "css-jsx",
  },
  requirement: { tier: ComputationTier.CrossSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, symbolTable, emit) => {
      const used = new Set<string>()

      for (const [, solidTree] of compilation.solidTrees) {
        for (const [, idx] of solidTree.staticClassTokensByElementId) {
          if (idx.hasDynamicClass) continue
          const tokens = idx.tokens
          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]
            if (token) used.add(token)
          }
        }

        for (const [, idx] of solidTree.staticClassListKeysByElementId) {
          const keys = idx.keys
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            if (key) used.add(key)
          }
        }
      }

      for (const [name] of symbolTable.classNames) {
        if (used.has(name)) continue
        const selectorSymbols = symbolTable.getSelectorsByClassName(name)
        if (selectorSymbols.length === 0) continue
        const selectorSymbol = selectorSymbols[0]
        if (!selectorSymbol) continue
        const rule = selectorSymbol.entity.rule

        emit(
          createDiagnosticFromLoc(
            rule.file.path,
            {
              start: { line: rule.startLine, column: rule.startColumn },
              end: { line: rule.startLine, column: rule.startColumn + 1 },
            },
            cssNoUnreferencedComponentClass.id,
            "unreferencedClass",
            resolveMessage(messages.unreferencedClass, { className: name }),
            "warn",
          ),
        )
      }
    })
  },
})
