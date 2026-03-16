/**
 * Avoid Unsafe Type Annotations Rule
 *
 * Flags `any` and `unknown` used in value-level type annotation positions:
 * - Parameters: `function foo(x: any)` — callers lose type info
 * - Return types: `function foo(): unknown` — callers get no type info
 * - Variables: `let x: any` — disables type checking
 * - Properties: `class Foo { x: any }` — property has no type safety
 *
 * Does NOT flag:
 * - Type alias/interface definitions (type-level, not value-level)
 * - Catch clause parameters (`catch (e: unknown)`) — recommended practice
 * - Generic type arguments (`Record<string, unknown>`) — structural constraints
 * - Index signatures, mapped types, conditional types — type-level
 *
 * For `as` casts and type predicates, see avoid-type-casting.
 */

import type { UnsafeTypeAnnotationEntity } from "../../entities/type-assertion"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getUnsafeTypeAnnotations } from "../../queries"

const messages = {
  anyParameter:
    "Parameter '{{name}}' is typed `any`{{inFunction}}. This disables type checking for all callers. " +
    "Use a specific type, a generic, or `unknown` with proper type narrowing.",
  anyReturn:
    "Function '{{name}}' returns `any`. This disables type checking for all callers. " +
    "Use a specific return type.",
  anyVariable:
    "Variable '{{name}}' is typed `any`. This disables all type checking on this variable. " +
    "Use a specific type or `unknown` with type narrowing.",
  anyProperty:
    "Property '{{name}}' is typed `any`. This disables type checking for all accesses. " +
    "Use a specific type.",
  unknownParameter:
    "Parameter '{{name}}' is typed `unknown`{{inFunction}}. Callers can pass anything and the " +
    "function body requires type narrowing on every use. Use a specific type or a generic constraint.",
  unknownReturn:
    "Function '{{name}}' returns `unknown`. Callers must narrow the return value before use. " +
    "Use a specific return type or a generic.",
  unknownVariable:
    "Variable '{{name}}' is typed `unknown`. Every use requires type narrowing. " +
    "Use a specific type or parse the value at the boundary.",
  unknownProperty:
    "Property '{{name}}' is typed `unknown`. Every access requires type narrowing. " +
    "Use a specific type.",
} as const

const options = {
  any: true,
  unknown: true,
}

export const avoidUnsafeTypeAnnotations = defineSolidRule({
  id: "avoid-unsafe-type-annotations",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow `any` and `unknown` in value-level type annotation positions (parameters, returns, variables, properties)",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const annotations = getUnsafeTypeAnnotations(graph)
    if (annotations.length === 0) return

    for (let i = 0, len = annotations.length; i < len; i++) {
      const annotation = annotations[i]
      if (!annotation) continue;

      if (annotation.kind === "any" && !options.any) continue
      if (annotation.kind === "unknown" && !options.unknown) continue

      // Generic constraints are low-value — `<T extends unknown>` is vacuously true
      if (annotation.position === "generic-constraint") continue

      const messageId = getMessageId(annotation)
      const data = buildMessageData(annotation)
      const msg = resolveMessage(messages[messageId], data)

      emit(
        createDiagnostic(
          graph.file,
          annotation.node,
          graph.sourceFile,
          "avoid-unsafe-type-annotations",
          messageId,
          msg,
          "error",
        ),
      )
    }
  },
})

function getMessageId(annotation: UnsafeTypeAnnotationEntity) {
  if (annotation.kind === "any") {
    switch (annotation.position) {
      case "parameter": return "anyParameter"
      case "return": return "anyReturn"
      case "variable": return "anyVariable"
      case "property": return "anyProperty"
      default: return "anyVariable"
    }
  }

  switch (annotation.position) {
    case "parameter": return "unknownParameter"
    case "return": return "unknownReturn"
    case "variable": return "unknownVariable"
    case "property": return "unknownProperty"
    default: return "unknownVariable"
  }
}

function buildMessageData(annotation: UnsafeTypeAnnotationEntity): Record<string, string> {
  const name = annotation.name ?? "value"
  const fnName = annotation.functionName

  if (annotation.position === "parameter" && fnName) {
    return { name, inFunction: ` in '${fnName}'` }
  }

  if (annotation.position === "return") {
    return { name: fnName ?? name }
  }

  return { name, inFunction: "" }
}
