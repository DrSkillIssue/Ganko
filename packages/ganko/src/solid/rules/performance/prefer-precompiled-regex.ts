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
      if (call.callee.type === "MemberExpression") {
        const receiver = call.callee.object
        if (receiver.type === "Literal" && "regex" in receiver && receiver.regex) {
          if (!call.scope.isModuleScope) {
            emit(
              createDiagnostic(
                graph.file,
                receiver,
                "prefer-precompiled-regex",
                "inlineRegex",
                resolveMessage(messages.inlineRegex, {
                  pattern: `/${receiver.regex.pattern}/${receiver.regex.flags}`,
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
        if (arg.type === "Literal" && "regex" in arg && arg.regex) {
          if (!call.scope.isModuleScope) {
            emit(
              createDiagnostic(
                graph.file,
                arg,
                "prefer-precompiled-regex",
                "inlineRegex",
                resolveMessage(messages.inlineRegex, {
                  pattern: `/${arg.regex.pattern}/${arg.regex.flags}`,
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
