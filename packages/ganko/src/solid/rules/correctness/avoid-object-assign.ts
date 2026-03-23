/**
 * Avoid Object.assign Rule
 *
 * Flags the usage of Object.assign(). Prefer object spread or structuredClone().
 *
 * Context-aware behavior:
 * - Skips namespace patterns: Object.assign(Component, { SubComponent })
 * - Auto-fixes simple merges: Object.assign({}, obj) → { ...obj }
 * - Flags mutations without auto-fix: Object.assign(existing, props)
 */

import ts from "typescript"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { CallEntity } from "../../entities/call"
import type { Fix } from "../../../diagnostic"
import { createDiagnostic } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { isEmptyObjectLiteral } from "../../util"

const messages = {
  avoidMerge:
    "Avoid Object.assign() for merging. Use object spread syntax { ...obj } instead.",
  avoidMutation:
    "Avoid Object.assign() for mutation. Consider immutable patterns like { ...existing, ...props }.",
} as const

/**
 * Checks if a call expression callee is Object.assign.
 *
 * @param callee - The callee node from a CallExpression
 * @returns True if the callee is Object.assign
 */
function isObjectAssign(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee)) return false

  const object = callee.expression
  const property = callee.name

  if (!ts.isIdentifier(object) || object.text !== "Object") return false
  if (!ts.isIdentifier(property) || property.text !== "assign") return false

  return true
}

/**
 * Check if this is a namespace pattern (function + properties).
 * Uses Graph API to detect if first arg is a function type.
 *
 * @param call - The Object.assign call entity
 * @param graph - The program graph
 * @returns True if this is a namespace pattern
 */
function isNamespacePattern(call: CallEntity, graph: SolidGraph): boolean {
  if (!ts.isCallExpression(call.node)) return false
  const args = call.node.arguments
  if (args.length < 2) return false

  const firstArg = args[0]
  if (!firstArg) return false
  if (ts.isSpreadElement(firstArg)) return false

  const typeInfo = graph.typeResolver.getType(firstArg)
  if (!typeInfo) return false

  return typeInfo.isComponent || graph.typeResolver.isCallableType(firstArg)
}

/**
 * Build auto-fix for simple merge pattern.
 *
 * @param call - The Object.assign call entity
 * @param text - The full source text
 * @returns Fix operation or undefined
 */
function buildMergeFix(
  call: CallEntity,
  text: string,
  sourceFile: ts.SourceFile,
): Fix | undefined {
  if (!ts.isCallExpression(call.node)) return undefined

  const args = call.node.arguments
  if (args.length < 2) return undefined

  const sourceArgs = args.slice(1)
  const spreadParts: string[] = []

  for (let i = 0; i < sourceArgs.length; i++) {
    const arg = sourceArgs[i]
    if (!arg) continue;
    if (ts.isSpreadElement(arg)) {
      spreadParts.push(`...${text.slice(arg.expression.getStart(sourceFile), arg.expression.end)}`)
    } else {
      spreadParts.push(`...${text.slice(arg.getStart(sourceFile), arg.end)}`)
    }
  }

  const replacement = `{ ${spreadParts.join(", ")} }`

  return [{
    range: [call.node.getStart(sourceFile), call.node.end],
    text: replacement,
  }]
}

const options = {}

export const avoidObjectAssign = defineSolidRule({
  id: "avoid-object-assign",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow Object.assign(). Prefer object spread syntax or structuredClone() for copying objects.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const calls = graph.callsByMethodName.get("assign") ?? []
    if (calls.length === 0) return

    const text = graph.sourceFile.text

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;
      // Verify it's Object.assign specifically
      if (!isObjectAssign(call.callee)) continue
      if (!ts.isCallExpression(call.node)) continue

      const args = call.node.arguments
      if (args.length === 0) continue

      const firstArg = args[0]
      if (!firstArg) continue;
      if (ts.isSpreadElement(firstArg)) continue

      // Skip namespace patterns (function + properties)
      if (isNamespacePattern(call, graph)) {
        continue
      }

      // Case 1: Simple merge with empty object literal - can auto-fix
      if (isEmptyObjectLiteral(firstArg)) {
        const fix = buildMergeFix(call, text, graph.sourceFile)
        emit(
          createDiagnostic(graph.filePath, call.node, graph.sourceFile, "avoid-object-assign", "avoidMerge", messages.avoidMerge, "error", fix),
        )
        continue
      }

      // Case 2: Mutation (non-empty first arg) - flag without auto-fix
      emit(
        createDiagnostic(graph.filePath, call.node, graph.sourceFile, "avoid-object-assign", "avoidMutation", messages.avoidMutation, "error"),
      )
    }
  },
})
