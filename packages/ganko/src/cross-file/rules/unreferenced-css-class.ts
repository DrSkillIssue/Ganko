import { createDiagnosticFromLoc, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { getUnusedCSSClasses } from "../queries"

const messages = {
  unreferencedClass: "CSS class '{{className}}' is defined but not referenced by static JSX class attributes",
} as const

export const cssNoUnreferencedComponentClass = defineCrossRule({
  id: "css-no-unreferenced-component-class",
  severity: "warn",
  messages,
  meta: {
    description: "Detect CSS classes that are never referenced by static JSX class attributes.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const unusedClassNames = getUnusedCSSClasses(context.solids, context.css)
    for (let i = 0; i < unusedClassNames.length; i++) {
      const className = unusedClassNames[i]
      if (!className) continue
      const selectors = context.css.classNameIndex.get(className)
      if (!selectors || selectors.length === 0) continue
      const selector = selectors[0]
      if (!selector) continue

      emit(
        createDiagnosticFromLoc(
          selector.rule.file.path,
          {
            start: { line: selector.rule.startLine, column: selector.rule.startColumn },
            end: { line: selector.rule.startLine, column: selector.rule.startColumn + 1 },
          },
          cssNoUnreferencedComponentClass.id,
          "unreferencedClass",
          resolveMessage(messages.unreferencedClass, { className }),
          "warn",
        ),
      )
    }
  },
})
