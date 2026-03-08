import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { hasFlag, VAR_IS_SCSS } from "../../entities"
import { emitCSSDiagnostic } from "../util"

const messages = {
  unusedCustomProperty:
    "Custom property `{{name}}` is never referenced within the project CSS.",
} as const

export const noUnusedCustomProperties = defineCSSRule({
  id: "no-unused-custom-properties",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow unused CSS custom properties.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    for (const variable of graph.unusedVariables) {
      if (hasFlag(variable._flags, VAR_IS_SCSS)) continue

      /* Global custom properties (defined in :root or bare scope) are the
         design system's public API. They may be consumed by Tailwind config,
         JavaScript theme objects, or future components — contexts the CSS
         graph cannot track. Only flag scoped (non-global) unused properties
         where the definition and expected consumption are co-located. */
      if (variable.scope.type === "global") continue

      emitCSSDiagnostic(
        emit,
        variable.file.path,
        variable.declaration.startLine,
        variable.declaration.startColumn,
        noUnusedCustomProperties,
        "unusedCustomProperty",
        resolveMessage(messages.unusedCustomProperty, { name: variable.name }),
      )
    }
  },
})
