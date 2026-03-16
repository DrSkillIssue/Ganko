/**
 * Flags regex literals used inline inside functions. Regex compilation
 * has a cost — when the pattern is a constant, hoist it to a module-level
 * const so the engine compiles it once.
 *
 * BAD:
 *   function parse(s: string) {
 *     return s.replace(/\s+/g, " ");
 *   }
 *
 * GOOD:
 *   const WHITESPACE = /\s+/g;
 *   function parse(s: string) {
 *     return s.replace(WHITESPACE, " ");
 *   }
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

const messages = {
  inlineRegex:
    "Regex `{{pattern}}` is compiled on every call. Hoist to a module-level constant.",
} as const

const options = {}

export const preferPrecompiledRegex = defineSolidRule({
  id: "prefer-precompiled-regex",
  severity: "warn",
  messages,
  meta: {
    description: "Prefer hoisting regex literals to module-level constants to avoid repeated compilation.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const calls = graph.calls

    for (let i = 0, len = calls.length; i < len; i++) {
      const call = calls[i]
      if (!call) continue;

      // Case 1: /pattern/.test(x) — regex is the receiver
      if (ts.isPropertyAccessExpression(call.callee)) {
        const receiver = call.callee.expression
        if (ts.isRegularExpressionLiteral(receiver)) {
          if (!call.scope.isModuleScope) {
            const regexText = receiver.text
            emit(
              createDiagnostic(
                graph.file,
                receiver,
                graph.sourceFile,
                "prefer-precompiled-regex",
                "inlineRegex",
                resolveMessage(messages.inlineRegex, {
                  pattern: regexText,
                }),
                "warn",
              ),
            )
          }
          continue
        }
      }

      // Case 2: str.replace(/pattern/, repl) — regex is an argument
      const args = call.arguments
      for (let j = 0, alen = args.length; j < alen; j++) {
        const argEntity = args[j];
        if (!argEntity) continue;
        const arg = argEntity.node
        if (ts.isRegularExpressionLiteral(arg)) {
          if (!call.scope.isModuleScope) {
            const regexText = arg.text
            emit(
              createDiagnostic(
                graph.file,
                arg,
                graph.sourceFile,
                "prefer-precompiled-regex",
                "inlineRegex",
                resolveMessage(messages.inlineRegex, {
                  pattern: regexText,
                }),
                "warn",
              ),
            )
          }
        }
      }
    }
  },
})
