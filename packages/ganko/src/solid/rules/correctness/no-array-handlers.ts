/**
 * No Array Handlers Rule
 *
 * Disallow passing arrays to event handler attributes.
 *
 * Event handler attributes expect a function, not an array.
 * Passing an array will not work as expected.
 *
 * This rule catches:
 * - `<button onclick={[handler1, handler2]} />` - literal array
 * - `<div onmouseover={handlers} />` - array-typed variable
 * - `<div onclick={getHandlers()} />` - function returning array type
 *
 * Uses TypeFlags to detect Array<T>, T[], ReadonlyArray<T>, and tuple types.
 */

import type ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { JSXAttributeEntity } from "../../entities/jsx"
import { getJSXAttributesByKind } from "../../queries/jsx"
import { typeIsArray } from "../../queries/type"
import { isLowerAlpha } from "@drskillissue/ganko-shared"

const messages = {
  noArrayHandlers:
    'Passing an array to "{{handlerName}}" is type-unsafe. The array syntax `[handler, data]` passes data as the first argument, making the event object the second argument. Use a closure instead: `{{handlerName}}={() => handler(data)}`.',
} as const

/**
 * Check if an attribute name is an event handler (includes lowercase variants).
 * @param name - The attribute name to check
 * @returns True if the name is an event handler
 */
function isEventHandlerName(name: string | null): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  if (lower.startsWith("on:")) return true
  if (lower.startsWith("oncapture:")) return true
  if (lower.startsWith("on") && lower.length > 2) {
    const c2 = lower.charCodeAt(2)
    return isLowerAlpha(c2)
  }
  return false
}

/**
 * Get the attribute name for error messaging.
 * @param attr - The JSX attribute entity
 * @returns The full attribute name including namespace if present
 */
function getAttributeName(attr: JSXAttributeEntity): string {
  if (attr.namespace) {
    return `${attr.namespace}:${attr.name ?? ""}`
  }
  return attr.name ?? ""
}

const options = {}

export const noArrayHandlers = defineSolidRule({
  id: "no-array-handlers",
  severity: "error",
  messages,
  meta: {
    description: "Disallow array handlers in JSX event properties.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const reported = new Set<ts.JsxAttribute | ts.JsxSpreadAttribute>()

    const eventHandlerAttrs = getJSXAttributesByKind(graph, "event-handler")
    const propAttrs = getJSXAttributesByKind(graph, "prop")

    if (eventHandlerAttrs.length === 0 && propAttrs.length === 0) {
      return
    }

    for (let i = 0, len = eventHandlerAttrs.length; i < len; i++) {
      const entry = eventHandlerAttrs[i]
      if (!entry) continue
      const { attr, element } = entry

      if (!element.isDomElement) continue

      if (attr.name === null) continue

      if (attr.valueNode && typeIsArray(graph, attr.valueNode)) {
        const handlerName = getAttributeName(attr)
        reported.add(attr.node)

        emit(
          createDiagnostic(
            graph.file,
            attr.node,
            graph.sourceFile,
            "no-array-handlers",
            "noArrayHandlers",
            resolveMessage(messages.noArrayHandlers, { handlerName }),
            "error",
          ),
        )
      }
    }

    for (let i = 0, len = propAttrs.length; i < len; i++) {
      const propEntry = propAttrs[i]
      if (!propEntry) continue
      const { attr, element } = propEntry

      if (reported.has(attr.node)) continue

      if (!element.isDomElement) continue

      if (attr.name === null) continue

      if (!isEventHandlerName(attr.name)) continue

      if (attr.valueNode && typeIsArray(graph, attr.valueNode)) {
        const handlerName = getAttributeName(attr)

        emit(
          createDiagnostic(
            graph.file,
            attr.node,
            graph.sourceFile,
            "no-array-handlers",
            "noArrayHandlers",
            resolveMessage(messages.noArrayHandlers, { handlerName }),
            "error",
          ),
        )
      }
    }
  },
})
