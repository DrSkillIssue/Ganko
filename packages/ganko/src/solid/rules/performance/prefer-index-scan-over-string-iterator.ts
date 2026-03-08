import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { iterateVariables } from "../../queries"
import { isAsciiParsingContext, isStringLikeVariable } from "./string-parsing-context"

const messages = {
  preferIndexScan:
    "ASCII parsing loops should avoid `for...of` string iteration. Prefer indexed scanning with charCodeAt for lower overhead.",
} as const

const options = {}

export const preferIndexScanOverStringIterator = defineSolidRule({
  id: "prefer-index-scan-over-string-iterator",
  severity: "warn",
  messages,
  meta: {
    description: "Prefer index-based string scanning over for-of iteration in ASCII parser code.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const reported = new Set<string>()

    for (const variable of iterateVariables(graph)) {
      if (!isStringLikeVariable(graph, variable)) continue

      for (let i = 0; i < variable.reads.length; i++) {
        const read = variable.reads[i]
        if (!read) continue;
        const parent = read.node.parent
        if (!parent || parent.type !== "ForOfStatement") continue
        if (parent.right !== read.node) continue
        if (!isAsciiParsingContext(graph, parent)) continue
        if (isUnicodeAwareLoop(parent)) continue

        const key = `${parent.range[0]}:${parent.range[1]}`
        if (reported.has(key)) continue
        reported.add(key)

        emit(
          createDiagnostic(
            graph.file,
            parent,
            "prefer-index-scan-over-string-iterator",
            "preferIndexScan",
            messages.preferIndexScan,
            "warn",
          ),
        )
      }
    }
  },
})

function isUnicodeAwareLoop(node: T.ForOfStatement): boolean {
  const body = node.body
  if (body.type !== "BlockStatement") return false

  const statements = body.body
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]
    if (!statement) continue;
    if (statement.type !== "ExpressionStatement") continue
    const expression = statement.expression
    if (expression.type !== "CallExpression") continue
    const callee = expression.callee
    if (callee.type !== "MemberExpression") continue
    const property = callee.property
    if (property.type !== "Identifier") continue
    if (property.name === "codePointAt" || property.name === "normalize") return true
  }

  return false
}
