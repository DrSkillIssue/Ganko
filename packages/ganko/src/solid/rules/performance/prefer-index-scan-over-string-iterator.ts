import ts from "typescript"
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
        if (!parent || !ts.isForOfStatement(parent)) continue
        if (parent.expression !== read.node) continue
        if (!isAsciiParsingContext(graph, parent)) continue
        if (isUnicodeAwareLoop(parent)) continue

        const key = `${parent.pos}:${parent.end}`
        if (reported.has(key)) continue
        reported.add(key)

        emit(
          createDiagnostic(
            graph.filePath,
            parent,
            graph.sourceFile,
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

function isUnicodeAwareLoop(node: ts.ForOfStatement): boolean {
  const body = node.statement
  if (!ts.isBlock(body)) return false

  const statements = body.statements
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]
    if (!statement) continue;
    if (!ts.isExpressionStatement(statement)) continue
    const expression = statement.expression
    if (!ts.isCallExpression(expression)) continue
    const callee = expression.expression
    if (!ts.isPropertyAccessExpression(callee)) continue
    const property = callee.name
    if (!ts.isIdentifier(property)) continue
    if (property.text === "codePointAt" || property.text === "normalize") return true
  }

  return false
}
