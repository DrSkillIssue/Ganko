/**
 * No Inline Imports Rule
 *
 * Flags inline type imports like `import("@typescript-eslint/utils").TSESLint.RuleFixer`
 * which should be imported at the top of the file instead.
 *
 * Inline imports make code harder to read and maintain - imports should be
 * declared at module scope for clarity and tooling support.
 */

import { createDiagnostic } from "../../../diagnostic";
import { defineSolidRule } from "../../rule"

const messages = {
  inlineImport: "Avoid inline imports. Import `{{specifier}}` at the top of the file instead.",
} as const

const options = {}

export const noInlineImports = defineSolidRule({
  id: "no-inline-imports",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow inline type imports. Import types at the top of the file for clarity and maintainability.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const imports = graph.inlineImports
    if (imports.length === 0) return

    for (let i = 0; i < imports.length; i++) {
      const entity = imports[i]
      if (!entity) continue;
      const specifier = entity.qualifier
        ? `${entity.qualifier} from "${entity.source}"`
        : `"${entity.source}"`

      const message = messages.inlineImport.replace("{{specifier}}", specifier)

      emit(
        createDiagnostic(
          graph.file,
          entity.node,
          graph.sourceFile,
          "no-inline-imports",
          "inlineImport",
          message,
          "error",
        ),
      )
    }
  },
})
