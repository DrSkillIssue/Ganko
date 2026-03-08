import type { TSESTree as T } from "@typescript-eslint/utils"
import { createDiagnostic, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"
import { readNodeRefById } from "./rule-runtime"

const messages = {
  duplicateClassToken: "Class token `{{name}}` appears in both class and classList.",
} as const

export const jsxNoDuplicateClassTokenClassClasslist = defineCrossRule({
  id: "jsx-no-duplicate-class-token-class-classlist",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow duplicate class tokens between class and classList on the same JSX element.",
    fixable: false,
    category: "css-jsx",
  },
  check(context, emit) {
    for (let i = 0; i < context.solids.length; i++) {
      const solid = context.solids[i]
      if (!solid) continue
      const classNodeByElementId = new Map<number, T.Node>()

      for (let j = 0; j < solid.jsxClassAttributes.length; j++) {
        const entry = solid.jsxClassAttributes[j]
        if (!entry) continue
        classNodeByElementId.set(entry.element.id, entry.attr.node)
      }

      for (const [elementId, classIndex] of solid.staticClassTokensByElementId) {
        if (classIndex.hasDynamicClass) continue
        const classListIndex = solid.staticClassListKeysByElementId.get(elementId)
        if (!classListIndex || classListIndex.hasDynamic || classListIndex.keys.length === 0) continue
        if (classIndex.tokens.length === 0) continue

        const classListSet = new Set<string>()
        for (let j = 0; j < classListIndex.keys.length; j++) {
          const key = classListIndex.keys[j]
          if (!key) continue
          classListSet.add(key)
        }

        const ref = readNodeRefById(context.layout, solid.file, elementId)
        if (!ref) continue

        const seen = new Set<string>()
        for (let j = 0; j < classIndex.tokens.length; j++) {
          const token = classIndex.tokens[j]
          if (!token) continue
          if (seen.has(token)) continue
          seen.add(token)
          if (!classListSet.has(token)) continue

          emit(createDiagnostic(
            solid.file,
            classNodeByElementId.get(elementId) ?? ref.element.node,
            jsxNoDuplicateClassTokenClassClasslist.id,
            "duplicateClassToken",
            resolveMessage(messages.duplicateClassToken, { name: token }),
            "warn",
          ))
        }
      }
    }
  },
})
