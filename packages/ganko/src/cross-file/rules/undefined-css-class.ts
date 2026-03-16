import { defineCrossRule } from "../rule"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { getUndefinedCSSClasses } from "../queries"
import { readNodeRefById } from "./rule-runtime"

const messages = {
  undefinedClass: "CSS class '{{className}}' is not defined in project CSS files",
} as const

export const jsxNoUndefinedCssClass = defineCrossRule({
  id: "jsx-no-undefined-css-class",
  severity: "error",
  messages,
  meta: {
    description: "Detect undefined CSS class names in JSX",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    const undefinedClasses = getUndefinedCSSClasses(context.solids, context.css)
    for (let i = 0; i < undefinedClasses.length; i++) {
      const item = undefinedClasses[i]
      if (!item) continue
      const ref = readNodeRefById(context.layout, item.file, item.elementId)
      if (!ref) continue

      emit(createDiagnostic(
        ref.solid.file,
        ref.element.node,
        ref.solid.sourceFile,
        jsxNoUndefinedCssClass.id,
        "undefinedClass",
        resolveMessage(messages.undefinedClass, { className: item.className }),
        "error",
      ))
    }
  },
})
