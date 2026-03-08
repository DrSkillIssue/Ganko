/**
 * Avoid Object Spread Rule
 *
 * Disallow object spread operators in Solid.js applications.
 *
 * Object spreading is problematic in Solid.js because it breaks fine-grained
 * reactivity by creating new object references.
 *
 * Better approaches in Solid.js:
 * - Use `splitProps()` instead of rest destructuring
 * - Use `mergeProps()` instead of object spread merging
 * - Access props directly via `props.x` to preserve reactivity
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import type { ObjectSpreadEntity, CallEntity, SpreadSourceReactivity } from "../../entities"
import type { ObjectPropertyInfo } from "../../typescript"
import type { Diagnostic, Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getScopeFor, getEffectiveTrackingContext } from "../../queries/scope"
import { getObjectProperties, getTypeInfo } from "../../queries/type"
import { getSpreadSourceReactivity, isPropsPassThrough } from "../../queries/spread"
import { getMemberAccessesOnIdentifier } from "../../queries/entity"
import { getSourceCode } from "../../queries/get"
import { matchesAnyGlobPattern } from "@drskillissue/ganko-shared"

interface Options extends Record<string, unknown> {
  checkDeferred: boolean
  checkTracked: boolean
  checkNonReactive: boolean
  allowedSources: string[]
}

const messages = {
  avoidObjectCopy: "Avoid object spread for copying. Use direct property access.",
  avoidObjectMerge: "Avoid object spread for merging. Use mergeProps() from 'solid-js'.",
  avoidObjectUpdate: "Avoid object spread for updates. Use produce() or direct assignment.",
  avoidJsxSpread: "Avoid JSX prop spreading. Use splitProps() to separate props.",
  avoidRestDestructure: "Avoid rest destructuring. Use splitProps() from 'solid-js'.",
  avoidPropsSpread: "Spreading props breaks reactivity. Use splitProps() to separate known props.",
  avoidStoreSpread: "Spreading store creates a static snapshot. Access properties directly.",
  avoidSignalSpread: "Spreading signal result captures current value. Wrap in createMemo().",
  avoidClassListSpread: "Spreading in classList breaks reactivity. Wrap in createMemo().",
  avoidStyleSpread: "Spreading in style breaks reactivity. Wrap in createMemo().",
  unnecessarySplitProps: "Unnecessary splitProps with empty array. Remove it and use {{source}} directly.",
} as const

const IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

/**
 * Get the source text for the spread argument.
 * @param node - The spread node
 * @param sourceCode - Source code text
 * @returns The source text of what's being spread
 */
function getSpreadArgumentSource(node: T.SpreadElement | T.JSXSpreadAttribute, sourceCode: string): string {
  const arg = node.argument
  return sourceCode.slice(arg.range[0], arg.range[1])
}

/**
 * Generate expanded properties for an object spread.
 * @param props - Array of property info
 * @param source - Source expression text (e.g., "obj" or "props")
 * @returns Comma-separated property assignments
 */
function generateExpandedProps(props: readonly ObjectPropertyInfo[], source: string): string {
  const parts: string[] = []

  for (const prop of props) {
    if (IDENTIFIER_REGEX.test(prop.name)) {
      const accessor = prop.optional ? `${source}?.${prop.name}` : `${source}.${prop.name}`
      parts.push(`${prop.name}: ${accessor}`)
    } else {
      parts.push(`"${prop.name}": ${source}["${prop.name}"]`)
    }
  }

  return parts.join(", ")
}

/**
 * Build a single JSX attribute string: `name={source.name}`.
 */
function buildJSXAttr(prop: ObjectPropertyInfo, source: string): string {
  const accessor = prop.optional ? `${source}?.${prop.name}` : `${source}.${prop.name}`
  return `${prop.name}={${accessor}}`
}

/**
 * Detect the leading whitespace of the line containing the given offset.
 */
function detectLineIndent(sourceCode: string, offset: number): string {
  let lineStart = offset
  while (lineStart > 0 && sourceCode.charCodeAt(lineStart - 1) !== 10) {
    lineStart--
  }
  let end = lineStart
  while (end < sourceCode.length) {
    const ch = sourceCode.charCodeAt(end)
    if (ch !== 32 && ch !== 9) break
    end++
  }
  return sourceCode.slice(lineStart, end)
}

/**
 * Generate expanded JSX attributes for a spread.
 *
 * With 1 prop, produces inline: `name={source.name}`.
 * With 2+ props, produces multi-line with each prop on its own line,
 * indented one level deeper than the opening element.
 *
 * @param props - Array of property info
 * @param source - Source expression text
 * @param indent - Base indentation of the opening JSX element
 * @returns Formatted JSX attributes string
 */
function generateExpandedJSXAttrs(
  props: readonly ObjectPropertyInfo[],
  source: string,
  indent: string,
): string {
  const parts: string[] = []

  for (const prop of props) {
    if (!IDENTIFIER_REGEX.test(prop.name)) continue
    parts.push(buildJSXAttr(prop, source))
  }

  if (parts.length <= 1) return parts.join("")

  const attrIndent = indent + "  "
  return "\n" + parts.map(p => attrIndent + p).join("\n") + "\n" + indent
}

/**
 * Try to create a fix for an object spread.
 * @param spread - The spread entity
 * @param graph - The program graph
 * @param sourceCode - Cached source code text
 * @returns A fix or null if not fixable
 */
/**
 * For JSX spreads, resolve the component's props type from the opening element tag.
 *
 * When the spread argument resolves to `any` (e.g. inside Show callbacks),
 * we can still produce a fix by looking at what the target component expects.
 * Gets the component function's first parameter type via its call signatures.
 *
 * @param spread - The JSX spread entity
 * @param graph - The program graph
 * @returns Property info from the component's props type, or null
 */
function getComponentPropsProperties(spread: ObjectSpreadEntity, graph: SolidGraph): readonly ObjectPropertyInfo[] | null {
  const opening = spread.parentJSXElement
  if (!opening) return null

  const tag = opening.name
  if (tag.type !== "JSXIdentifier" && tag.type !== "JSXMemberExpression") return null

  // Get the type of the component tag — works for both identifiers and
  // member expressions (e.g. Base.Item). The type resolver calls
  // getTypeAtLocation which handles both node types.
  const typeInfo = getTypeInfo(graph, tag)
  if (!typeInfo) return null

  return graph.typeResolver.getComponentPropsProperties(tag)
}

/**
 * Structural fallback for JSX spread fix when type info is unavailable.
 *
 * When the spread argument is a callback parameter whose type resolves to
 * `any` (common with project-service type resolution on deeply generic
 * library types like Kobalte's PolymorphicProps), we discover properties
 * structurally by scanning all member accesses on that parameter within
 * the enclosing function.
 *
 * Example: for `(itemProps) => <Base.Item {...itemProps}>` where
 * `itemProps.item.rawValue` is accessed elsewhere, we discover `item`
 * and generate `item={itemProps.item}`.
 *
 * @param arg - The spread argument (must be an Identifier)
 * @param graph - The program graph
 * @returns Synthetic property info array, or null if not applicable
 */
function getPropertiesFromMemberAccesses(arg: T.Identifier, graph: SolidGraph): readonly ObjectPropertyInfo[] | null {
  // Walk up AST to find the enclosing function node
  let current: T.Node | undefined = arg.parent;
  while (current) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) break;
    current = current.parent;
  }
  if (!current) return null;

  // Look up the FunctionEntity in the graph
  const fn = graph.functionsByNode.get(current);
  if (!fn) return null;

  // Verify the identifier is actually a parameter of this function
  const paramName = arg.name;
  let isParam = false;
  for (let i = 0, len = fn.params.length; i < len; i++) {
    const param = fn.params[i];
    if (!param) continue;
    if (param.name === paramName) { isParam = true; break; }
  }
  if (!isParam) return null;

  // Collect all member accesses on this parameter
  const accesses = getMemberAccessesOnIdentifier(fn, paramName);
  if (accesses.length === 0) return null;

  // Extract unique top-level property names from computed=false accesses
  const seen = new Set<string>();
  const result: ObjectPropertyInfo[] = [];
  for (let i = 0, len = accesses.length; i < len; i++) {
    const access = accesses[i];
    if (!access) continue;
    if (access.computed) continue;
    const prop = access.property;
    if (prop.type !== "Identifier") continue;
    const name = prop.name;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, optional: false, type: "unknown" });
  }

  return result.length > 0 ? result : null;
}

function tryCreateFix(spread: ObjectSpreadEntity, graph: SolidGraph, sourceCode: string): Fix | null {
  const node = spread.node

  // Skip rest destructuring - needs splitProps which is more complex
  if (node.type === "RestElement") return null

  // Skip merge patterns - multiple spreads are complex
  if (spread.kind === "object-merge") return null

  const arg = node.argument
  const source = getSpreadArgumentSource(node, sourceCode)

  // For object literals being spread, we can inline directly
  if (arg.type === "ObjectExpression") {
    return createObjectLiteralFix(node, arg, sourceCode)
  }

  if (spread.kind === "jsx-spread" && node.type === "JSXSpreadAttribute") {
    // For JSX spreads, include callable props (event handlers, callbacks)
    let props = getObjectProperties(graph, arg, 10, true)

    // Fallback: if spread argument type is unresolvable (any), use the
    // target component's props type instead
    if (!props || props.length === 0) {
      props = getComponentPropsProperties(spread, graph)
    }

    // Structural fallback: when both type-based paths fail (e.g. project
    // service resolves generic callback params to `any`), discover properties
    // by scanning member accesses on the spread argument within its function.
    if ((!props || props.length === 0) && arg.type === "Identifier") {
      props = getPropertiesFromMemberAccesses(arg, graph)
    }

    if (!props || props.length === 0) return null
    return createJSXSpreadFix(node, props, source, sourceCode)
  }

  // For non-JSX spreads, exclude callable properties
  const props = getObjectProperties(graph, arg)
  if (!props || props.length === 0) return null

  if (node.type === "SpreadElement") {
    return createObjectSpreadFix(node, props, source)
  }

  return null
}

/**
 * Create a fix for spreading an object literal.
 * @param node - The spread node
 * @param objExpr - The object expression being spread
 * @param sourceCode - Full source code text
 * @returns A fix or null if not fixable
 */
function createObjectLiteralFix(
  node: T.SpreadElement | T.JSXSpreadAttribute,
  objExpr: T.ObjectExpression,
  sourceCode: string,
): Fix | null {
  const innerStart = objExpr.range[0] + 1
  const innerEnd = objExpr.range[1] - 1

  // Early exit if range is empty or whitespace-only
  if (innerStart >= innerEnd) return null
  const raw = sourceCode.slice(innerStart, innerEnd)
  if (!raw || !raw.trim()) return null

  const [start, end] = node.range
  return [{ range: [start, end] as const, text: raw.trim() }]
}

/**
 * Create a fix for a JSX spread attribute.
 *
 * Replaces `{...source}` with individual attributes. When there are 2+
 * props the output is multi-line with each prop on its own line, indented
 * one level deeper than the opening element tag.
 *
 * @param node - The JSX spread attribute node
 * @param props - Array of property info from type
 * @param source - Source expression text
 * @param sourceCode - Full source text (for indentation detection)
 * @returns A fix or null if not fixable
 */
function createJSXSpreadFix(
  node: T.JSXSpreadAttribute,
  props: readonly ObjectPropertyInfo[],
  source: string,
  sourceCode: string,
): Fix | null {
  const opening = node.parent
  const indent = opening ? detectLineIndent(sourceCode, opening.range[0]) : ""
  const expanded = generateExpandedJSXAttrs(props, source, indent)
  if (!expanded) return null

  const [start, end] = node.range
  return [{ range: [start, end] as const, text: expanded }]
}

/**
 * Create a fix for an object spread in an object expression.
 * @param node - The spread element node
 * @param props - Array of property info from type
 * @param source - Source expression text
 * @returns A fix or null if not fixable
 */
function createObjectSpreadFix(node: T.SpreadElement, props: readonly ObjectPropertyInfo[], source: string): Fix | null {
  const expanded = generateExpandedProps(props, source)
  if (!expanded) return null

  const [start, end] = node.range
  return [{ range: [start, end] as const, text: expanded }]
}

/**
 * Check for unnecessary splitProps(props, []) calls.
 *
 * @param call - The splitProps call entity
 * @param _graph - The program graph (unused)
 * @returns A diagnostic if the splitProps call is unnecessary
 */
function checkUnnecessarySplitProps(
  call: CallEntity,
  file: string,
): Diagnostic | null {
  const callNode = call.node

  if (callNode.type !== "CallExpression") return null
  if (callNode.arguments.length < 2) return null

  // Check if second argument is an empty array
  const secondArg = callNode.arguments[1]
  if (!secondArg) return null
  if (secondArg.type !== "ArrayExpression") return null
  if (secondArg.elements.length !== 0) return null

  // Get the first argument (the props source)
  const firstArg = callNode.arguments[0]
  if (!firstArg) return null
  if (firstArg.type !== "Identifier") return null

  const propsName = firstArg.name

  return createDiagnostic(
    file,
    callNode,
    "avoid-object-spread",
    "unnecessarySplitProps",
    resolveMessage(messages.unnecessarySplitProps, { source: propsName }),
    "error",
  )
}

/**
 * Determine if a spread should be skipped from reporting.
 *
 * @param spread - The object spread entity
 * @param contextType - The tracking context type
 * @param sourceReactivity - The source reactivity classification
 * @param graph - The solid program graph
 * @param options - Rule options for filtering
 * @returns True if the spread should be skipped
 */
/**
 * Detect if a spread node is inside a setter callback: `setX(prev => ({ ...prev, ... }))`.
 * The callback is a function expression that is a direct argument to a call expression.
 */
function isInsideSetterCallback(node: T.SpreadElement | T.JSXSpreadAttribute | T.RestElement): boolean {
  let current: T.Node | undefined = node.parent
  while (current) {
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") {
      const fnParent = current.parent
      return fnParent?.type === "CallExpression" && fnParent.callee !== current
    }
    current = current.parent
  }
  return false
}

function shouldSkip(
  spread: ObjectSpreadEntity,
  contextType: string,
  sourceReactivity: SpreadSourceReactivity,
  graph: SolidGraph,
  options: Options,
): boolean {
  // Always skip safe patterns
  if (sourceReactivity === "splitPropsRest") return true
  if (sourceReactivity === "mergePropsResult") return true

  // Skip JSX spreads on native DOM elements (safe forwarding pattern)
  if (spread.kind === "jsx-spread" && spread.targetIsDom) return true

  // Skip spreads inside classList/style attribute values.
  // classList and style expressions are re-evaluated reactively by Solid's
  // JSX transform. On DOM elements, Solid diffs classList and merges style.
  // On component elements, the object is passed as a prop and the component
  // applies it to its internal DOM element. Either way, spreading inside the
  // value expression doesn't break reactivity.
  if (spread.attributeContext === "classList" || spread.attributeContext === "style") return true

  // Skip pure pass-through pattern (no local prop access)
  if (sourceReactivity === "props" && isPropsPassThrough(graph, spread)) return true

  // Skip unknown context (not in reactive code)
  if (contextType === "unknown") return true

  // Skip object-update spreads inside signal setter callbacks.
  // Pattern: setSignal(prev => ({ ...prev, key: value })) — prev is a plain
  // snapshot and spreading it to produce a new value is the correct immutable
  // update pattern for signals.
  if (spread.kind === "object-update" && isInsideSetterCallback(spread.node)) return true

  // Check allowed sources
  if (spread.sourceName && matchesAnyGlobPattern(spread.sourceName, options.allowedSources)) {
    return true
  }

  // Reactive sources (props, signals, stores, accessors) always report in reactive contexts
  // because spreading them breaks fine-grained reactivity
  const isReactiveSource = sourceReactivity === "props" 
    || sourceReactivity === "signal" 
    || sourceReactivity === "store" 
    || sourceReactivity === "accessor"
  
  // Unknown sources are treated as potentially reactive in component/tracked contexts
  // (better to warn than miss a reactivity break)
  const isPotentiallyReactive = isReactiveSource || sourceReactivity === "unknown"
  
  if (isPotentiallyReactive) {
    // Skip in deferred context unless checking
    if (contextType === "deferred" && !options.checkDeferred) return true
    // Report in tracked/component contexts always
    return false
  }

  // Plain objects: skip unless explicitly checking non-reactive
  if (sourceReactivity === "plainObject" && !options.checkNonReactive) return true

  // Skip deferred unless checking
  if (contextType === "deferred" && !options.checkDeferred) return true

  // Skip tracked/component unless checking
  if ((contextType === "tracked" || contextType === "component") && !options.checkTracked) return true

  return false
}

/**
 * Get the appropriate message ID for a spread diagnostic.
 *
 * @param spread - The object spread entity
 * @param reactivity - The source reactivity classification
 * @returns The message ID to use for the diagnostic
 */
function getMessageId(spread: ObjectSpreadEntity, reactivity: SpreadSourceReactivity): keyof typeof messages {
  // Attribute-specific messages
  if (spread.attributeContext === "classList") return "avoidClassListSpread"
  if (spread.attributeContext === "style") return "avoidStyleSpread"

  // Source-specific messages
  if (reactivity === "store") return "avoidStoreSpread"
  if (reactivity === "signal" || reactivity === "accessor") return "avoidSignalSpread"
  if (spread.kind === "jsx-spread" && reactivity === "props") return "avoidPropsSpread"

  // Kind-based fallback
  switch (spread.kind) {
    case "object-copy": return "avoidObjectCopy"
    case "object-merge": return "avoidObjectMerge"
    case "object-update": return "avoidObjectUpdate"
    case "jsx-spread": return "avoidJsxSpread"
    case "rest-destructure": return "avoidRestDestructure"
    default: return "avoidObjectCopy"
  }
}

const options: Options = {
  checkDeferred: false,
  checkTracked: false,
  checkNonReactive: false,
  allowedSources: [],
}

export const avoidObjectSpread = defineSolidRule({
  id: "avoid-object-spread",
  severity: "error",
  messages,
  meta: {
    description: "Disallow object spread operators that break Solid's fine-grained reactivity.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    // Check for unnecessary splitProps calls
    const splitPropsCalls = graph.callsByPrimitive.get("splitProps") ?? []

    for (const call of splitPropsCalls) {
      const diagnostic = checkUnnecessarySplitProps(call, graph.file)
      if (diagnostic) {
        emit(diagnostic)
      }
    }

    const spreads = graph.objectSpreads
    const len = spreads.length
    if (len === 0) return

    const sourceCode = getSourceCode(graph).text

    for (let i = 0; i < len; i++) {
      const spread = spreads[i]
      if (!spread) continue;

      // Get context type
      const scope = getScopeFor(graph, spread.node)
      const trackingContext = getEffectiveTrackingContext(graph, scope)
      const contextType = trackingContext.type

      // Get source reactivity
      const sourceReactivity = getSpreadSourceReactivity(graph, spread)

      // Apply skip rules
      if (shouldSkip(spread, contextType, sourceReactivity, graph, options)) {
        continue
      }

      // Generate diagnostic
      const messageId = getMessageId(spread, sourceReactivity)
      const msg = messages[messageId]
      const fix = tryCreateFix(spread, graph, sourceCode)

      emit(createDiagnostic(graph.file, spread.node, "avoid-object-spread", messageId, msg, "error", fix ?? undefined))
    }
  },
})
