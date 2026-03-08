/**
 * Flags regex .test() on single characters where charCodeAt range
 * checks are faster. Regex involves compilation and match overhead
 * that a simple numeric comparison avoids entirely.
 *
 * BAD:
 *   if (/[a-zA-Z]/.test(str[0])) { ... }
 *   while (/[0-9]/.test(ch)) { ... }
 *
 * GOOD:
 *   const c = str.charCodeAt(0);
 *   if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { ... }
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"

const messages = {
  regexTest:
    "Regex `{{pattern}}`.test() on a single character. Use charCodeAt() range checks instead.",
} as const

const options = {}

export const preferCharcodeOverRegexTest = defineSolidRule({
  id: "prefer-charcode-over-regex-test",
  severity: "warn",
  messages,
  meta: {
    description: "Prefer charCodeAt() range checks over regex .test() for single-character classification.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const calls = getCallsByMethodName(graph, "test")

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;
      if (call.callee.type !== "MemberExpression") continue

      const receiver = call.callee.object
      if (receiver.type !== "Literal" || !("regex" in receiver)) continue

      const regex = receiver.regex
      if (!regex) continue

      // Only flag character-class-only patterns (no anchors, quantifiers, etc.)
      if (!isCharClassOnlyPattern(regex.pattern)) continue

      // The .test() argument should indicate single-character usage
      if (call.arguments.length !== 1) continue
      const firstCallArg = call.arguments[0];
      if (!firstCallArg) continue;
      if (!isSingleCharAccess(firstCallArg.node)) continue

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "prefer-charcode-over-regex-test",
          "regexTest",
          resolveMessage(messages.regexTest, { pattern: `/${regex.pattern}/${regex.flags}` }),
          "warn",
        ),
      )
    }
  },
})

/**
 * Check if a regex pattern is solely a character class with no
 * quantifiers, anchors, or alternations — meaning it classifies
 * a single character.
 *
 * Matches: [a-z], [a-zA-Z], [0-9_-], [a-zA-Z0-9_-]
 * Rejects: [a-z]+, ^[a-z], [a-z]|[0-9], ., \d, a|b
 */
function isCharClassOnlyPattern(pattern: string): boolean {
  if (pattern.length < 3) return false
  if (pattern.charCodeAt(0) !== 91) return false // [
  if (pattern.charCodeAt(pattern.length - 1) !== 93) return false // ]
  // No characters outside the brackets
  // The entire pattern must be one [...] group
  let depth = 0
  for (let i = 0, len = pattern.length; i < len; i++) {
    const ch = pattern.charCodeAt(i)
    if (ch === 92) { i++; continue } // skip escaped chars
    if (ch === 91) depth++
    if (ch === 93) { depth--; if (depth === 0 && i !== len - 1) return false }
  }
  return depth === 0
}

/**
 * Check if a node represents accessing a single character from a string:
 * - str[i] / str[0] (computed member access — bracket notation on a string)
 * - str.charAt(i) (explicit single-char extraction)
 *
 * An arbitrary Identifier is NOT sufficient evidence — the variable could
 * hold a full string. Only structural proof of single-char access qualifies.
 */
function isSingleCharAccess(node: T.Node): boolean {
  if (node.type === "MemberExpression" && node.computed) return true
  if (
    node.type === "CallExpression"
    && node.callee.type === "MemberExpression"
    && node.callee.property.type === "Identifier"
    && node.callee.property.name === "charAt"
  ) return true
  return false
}
