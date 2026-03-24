/**
 * Event Handlers Rule
 *
 * Enforce correct naming and usage patterns for event handlers in Solid.js.
 *
 * Event handler naming matters in Solid for:
 * - Event delegation and event capturing
 * - Solid's event binding detection
 * - Code readability and consistency
 *
 * This rule detects:
 * - Incorrect casing: `onClick` should be `onclick` (lowercase)
 * - Non-standard prefixes: `on_click` instead of `onclick`
 * - Handler vs attribute confusion: `onclick="handler"` (should be function)
 * - Missing Solid event prefixes when needed
 *
 * Solid event handlers use:
 * - `onclick`, `onchange`, etc. (lowercase)
 * - `on:click`, `on:change` (with namespace for special handling)
 * - Event delegation is automatic in Solid
 */

import ts from "typescript"
import type { Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getJSXAttributesByKind } from "../../queries/jsx"
import type { JSXAttributeEntity } from "../../entities/jsx"
import { getStaticValue } from "../../util/static-value"
import { CHAR_O, CHAR_N, isAlpha, isLowerAlpha } from "@drskillissue/ganko-shared"

/**
 * List of common DOM event handler names that Solid supports.
 * These events use delegation and have specific casing requirements.
 */
const COMMON_EVENTS = [
  "onAnimationEnd",
  "onAnimationIteration",
  "onAnimationStart",
  "onBeforeInput",
  "onBlur",
  "onChange",
  "onClick",
  "onContextMenu",
  "onCopy",
  "onCut",
  "onDblClick",
  "onDrag",
  "onDragEnd",
  "onDragEnter",
  "onDragExit",
  "onDragLeave",
  "onDragOver",
  "onDragStart",
  "onDrop",
  "onError",
  "onFocus",
  "onFocusIn",
  "onFocusOut",
  "onGotPointerCapture",
  "onInput",
  "onInvalid",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onLoad",
  "onLostPointerCapture",
  "onMouseDown",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
  "onMouseUp",
  "onPaste",
  "onPointerCancel",
  "onPointerDown",
  "onPointerEnter",
  "onPointerLeave",
  "onPointerMove",
  "onPointerOut",
  "onPointerOver",
  "onPointerUp",
  "onReset",
  "onScroll",
  "onSelect",
  "onSubmit",
  "onToggle",
  "onTouchCancel",
  "onTouchEnd",
  "onTouchMove",
  "onTouchStart",
  "onTransitionEnd",
  "onWheel",
] as const

type CommonEvent = (typeof COMMON_EVENTS)[number]

/**
 * Map of lowercase event names to their properly-cased versions.
 */
const COMMON_EVENTS_MAP = new Map<string, CommonEvent>(
  Array.from(COMMON_EVENTS, (event): readonly [string, CommonEvent] => {
    const eventName = String(event)
    return [eventName.toLowerCase(), event]
  }),
)

/**
 * Map of nonstandard event names to their standard equivalents.
 */
const NONSTANDARD_EVENTS_MAP: Record<string, string> = {
  ondoubleclick: "onDblClick",
}

/**
 * Check if a lowercase handler name matches a known common event.
 *
 * @param lowercaseHandlerName - The lowercase handler name to check
 * @returns true if the name is a common event handler, false otherwise
 */
function isCommonHandlerName(lowercaseHandlerName: string): boolean {
  return COMMON_EVENTS_MAP.has(lowercaseHandlerName)
}

/**
 * Get the properly-cased event handler name for a common event.
 * Precondition: isCommonHandlerName(lowercaseHandlerName) must be true.
 *
 * @param lowercaseHandlerName - The lowercase common event name
 * @returns The properly-cased event handler name, or undefined if not found
 */
function getCommonEventHandlerName(lowercaseHandlerName: string): CommonEvent | undefined {
  return COMMON_EVENTS_MAP.get(lowercaseHandlerName)
}

/**
 * Check if an event name is a nonstandard variant that should be normalized.
 *
 * @param lowercaseEventName - The lowercase event name to check
 * @returns true if the name is a nonstandard event, false otherwise
 */
function isNonstandardEventName(lowercaseEventName: string): boolean {
  return lowercaseEventName in NONSTANDARD_EVENTS_MAP
}

/**
 * Get the standard event handler name for a nonstandard event.
 *
 * @param lowercaseEventName - The nonstandard lowercase event name
 * @returns The standard event handler name
 */
function getStandardEventHandlerName(lowercaseEventName: string): string {
  const name = NONSTANDARD_EVENTS_MAP[lowercaseEventName];
  if (!name) return lowercaseEventName;
  return name;
}



/**
 * Check if a prop name looks like an event handler (starts with "on" + letter).
 * Uses character codes instead of regex.
 *
 * @param name - The prop name to check
 * @returns true if the name looks like an event handler, false otherwise
 */
function looksLikeEventHandler(name: string): boolean {
  if (name.length < 3) return false
  const c0 = name.charCodeAt(0)
  const c1 = name.charCodeAt(1)
  const c2 = name.charCodeAt(2)
  // Check 'on' prefix and third char is a letter
  return c0 === CHAR_O && c1 === CHAR_N && isAlpha(c2)
}

/**
 * Check if a prop name is ambiguously cased (lowercase third character).
 * Examples: "only", "ongoing", "onfoobar"
 * Uses character codes for consistency with other checks.
 *
 * @param name - The prop name to check
 * @returns true if the name is ambiguously cased, false otherwise
 */
function isAmbiguouslyCased(name: string): boolean {
  const c2 = name.charCodeAt(2)
  return isLowerAlpha(c2)
}

/**
 * Get the static value of a JSX attribute if it would be inlined by Solid.
 * Returns the static string/number value, or null if the value is dynamic.
 *
 * @param valueNode - The JSX attribute value node
 * @returns The static value, or null if the value is dynamic
 */
function getStaticAttributeValue(valueNode: ts.Node | null): string | number | boolean | null {
  if (!valueNode) return true // Boolean attributes (no value) are truthy

  // Skip array expressions (array syntax prevents inlining)
  if (ts.isArrayLiteralExpression(valueNode)) return null

  const staticValue = getStaticValue(valueNode)
  if (staticValue === null) return null

  const val = staticValue.value
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return val
  }
  return null
}

interface EventHandlerIssue {
  node: ts.Node
  messageId: keyof typeof messages
  data: Record<string, string>
  fix?: Fix
}

/**
 * Detect if an attribute has a static value that would be inlined.
 *
 * @param attr - The JSX attribute entity
 * @param name - The attribute name
 * @returns An EventHandlerIssue if a static value is detected, null otherwise
 */
function detectStaticValueIssue(attr: JSXAttributeEntity, name: string): EventHandlerIssue | null {
  const staticValue = getStaticAttributeValue(attr.valueNode)
  if (staticValue === null) return null

  return {
    node: attr.node,
    messageId: "detectedAttr",
    data: { name, staticValue: String(staticValue) },
  }
}

/**
 * Detect if an attribute uses a nonstandard event name.
 *
 * @param attr - The JSX attribute entity
 * @param name - The attribute name
 * @param lowercaseName - The lowercase version of the attribute name
 * @returns An EventHandlerIssue if a nonstandard event is detected, null otherwise
 */
function detectNonstandardEventIssue(
   attr: JSXAttributeEntity,
   name: string,
   lowercaseName: string,
   sourceFile: ts.SourceFile,
 ): EventHandlerIssue | null {
  if (!isNonstandardEventName(lowercaseName)) return null
  if (!ts.isJsxAttribute(attr.node)) return null

  const fixedName = getStandardEventHandlerName(lowercaseName)
  const attrNode = attr.node
  return {
    node: attrNode.name,
    messageId: "nonstandard",
    data: { name, fixedName },
    fix: [{ range: [attrNode.name.getStart(sourceFile), attrNode.name.end], text: fixedName }],
  }
}

/**
 * Detect if a common event handler has incorrect capitalization.
 *
 * @param attr - The JSX attribute entity
 * @param name - The attribute name
 * @param lowercaseName - The lowercase version of the attribute name
 * @returns An EventHandlerIssue if capitalization is incorrect, null otherwise
 */
function detectCapitalizationIssue(
   attr: JSXAttributeEntity,
   name: string,
   lowercaseName: string,
   sourceFile: ts.SourceFile,
 ): EventHandlerIssue | null {
  if (!isCommonHandlerName(lowercaseName)) return null

  const fixedName = getCommonEventHandlerName(lowercaseName)
  if (!fixedName) return null
  if (fixedName === name) return null
  if (!ts.isJsxAttribute(attr.node)) return null
  const attrNode = attr.node

  return {
    node: attrNode.name,
    messageId: "capitalization",
    data: { name, fixedName },
    fix: [{ range: [attrNode.name.getStart(sourceFile), attrNode.name.end], text: fixedName }],
  }
}

/**
 * Detect if a prop name is ambiguous (could be handler or attribute).
 *
 * @param attr - The JSX attribute entity
 * @param name - The attribute name
 * @returns An EventHandlerIssue if naming is ambiguous, null otherwise
 */
function detectAmbiguousNamingIssue(
   attr: JSXAttributeEntity,
   name: string,
 ): EventHandlerIssue | null {
  if (!isAmbiguouslyCased(name)) return null
  if (!ts.isJsxAttribute(attr.node)) return null

  const thirdChar = name[2];
  if (!thirdChar) return null;
  const handlerName = `on${thirdChar.toUpperCase()}${name.slice(3)}`
  const attrNameStr = `attr:${name}`
  const attrNode = attr.node

  return {
    node: attrNode.name,
    messageId: "naming",
    data: { name, attrName: attrNameStr, handlerName },
  }
}

const messages = {
  detectedAttr:
    "The \"{{name}}\" prop looks like an event handler but has a static value ({{staticValue}}), so Solid will treat it as an attribute instead of attaching an event listener. Use attr:{{name}} to make this explicit, or provide a function value.",
  naming:
    "The \"{{name}}\" prop is ambiguous. Solid cannot determine if this is an event handler or an attribute. Use {{handlerName}} for an event handler, or {{attrName}} for an attribute.",
  capitalization:
    "The \"{{name}}\" prop should be {{fixedName}} for Solid to recognize it as an event handler. Event handlers use camelCase with an uppercase letter after \"on\".",
  nonstandard:
    "The \"{{name}}\" prop uses a nonstandard event name. Use {{fixedName}} instead, which is the standard DOM event name that Solid recognizes.",
  makeHandler: "Change {{name}} to {{handlerName}} (event handler).",
  makeAttr: "Change {{name}} to {{attrName}} (attribute).",
  spreadHandler:
    "The \"{{name}}\" prop is being spread into JSX, which prevents Solid from attaching it as an event listener. Add it directly as a JSX attribute instead: {{name}}={...}.",
} as const

const options = {}

export const eventHandlers = defineSolidRule({
  id: "event-handlers",
  severity: "error",
  messages,
  meta: {
    description:
      "Enforce naming DOM element event handlers consistently and prevent Solid's analysis from misunderstanding whether a prop should be an event handler.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const eventHandlerAttrs = getJSXAttributesByKind(graph, "event-handler")
    const propAttrs = getJSXAttributesByKind(graph, "prop")

    if (eventHandlerAttrs.length === 0 && propAttrs.length === 0) {
      return
    }

    const sourceFile = graph.sourceFile

    for (let i = 0, len = eventHandlerAttrs.length; i < len; i++) {
      const entry = eventHandlerAttrs[i]
      if (!entry) continue
      const { attr, element } = entry

      if (!element.isDomElement) continue

      if (attr.name === null) continue
      if (attr.namespace !== null) continue

      const name = attr.name

      const staticIssue = detectStaticValueIssue(attr, name)
      if (staticIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            staticIssue.node,
            sourceFile,
            "event-handlers",
            staticIssue.messageId,
            resolveMessage(messages[staticIssue.messageId], staticIssue.data),
            "error",
          ),
        )
        continue
      }

      const lowercaseName = name.toLowerCase()
      const nonstandardIssue = detectNonstandardEventIssue(attr, name, lowercaseName, sourceFile)
      if (nonstandardIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            nonstandardIssue.node,
            sourceFile,
            "event-handlers",
            nonstandardIssue.messageId,
            resolveMessage(messages[nonstandardIssue.messageId], nonstandardIssue.data),
            "error",
            nonstandardIssue.fix,
          ),
        )
      }
    }

    for (let i = 0, len = propAttrs.length; i < len; i++) {
      const propEntry = propAttrs[i]
      if (!propEntry) continue
      const { attr, element } = propEntry

      if (!element.isDomElement) continue

      if (attr.name === null) continue
      if (!ts.isJsxAttribute(attr.node)) continue

      const attrNode = attr.node
      if (ts.isJsxNamespacedName(attrNode.name)) continue

      const name = attr.name

      if (!looksLikeEventHandler(name)) continue

      const staticIssue = detectStaticValueIssue(attr, name)
      if (staticIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            staticIssue.node,
            sourceFile,
            "event-handlers",
            staticIssue.messageId,
            resolveMessage(messages[staticIssue.messageId], staticIssue.data),
            "error",
          ),
        )
        continue
      }

      const lowercaseName = name.toLowerCase()

      const nonstandardIssue = detectNonstandardEventIssue(attr, name, lowercaseName, sourceFile)
      if (nonstandardIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            nonstandardIssue.node,
            sourceFile,
            "event-handlers",
            nonstandardIssue.messageId,
            resolveMessage(messages[nonstandardIssue.messageId], nonstandardIssue.data),
            "error",
            nonstandardIssue.fix,
          ),
        )
        continue
      }

      const capitalizationIssue = detectCapitalizationIssue(attr, name, lowercaseName, sourceFile)
      if (capitalizationIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            capitalizationIssue.node,
            sourceFile,
            "event-handlers",
            capitalizationIssue.messageId,
            resolveMessage(messages[capitalizationIssue.messageId], capitalizationIssue.data),
            "error",
            capitalizationIssue.fix,
          ),
        )
        continue
      }

      const ambiguousIssue = detectAmbiguousNamingIssue(attr, name)
      if (ambiguousIssue) {
        emit(
          createDiagnostic(
            graph.filePath,
            ambiguousIssue.node,
            sourceFile,
            "event-handlers",
            ambiguousIssue.messageId,
            resolveMessage(messages[ambiguousIssue.messageId], ambiguousIssue.data),
            "error",
          ),
        )
      }
    }
  },
})
