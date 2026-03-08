import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../impl"
import type { JSXAttributeEntity, JSXElementEntity } from "../entities/jsx"
import { getPropertyKeyName } from "../util/pattern-detection"

export interface JSXAttributeEntry {
  readonly attr: JSXAttributeEntity
  readonly element: JSXElementEntity
}

/**
 * Extract classList object literal from JSX attribute value.
 * @param node JSX attribute value node
 * @returns Object literal for classList or null
 */
export function classListObject(node: T.Node | null): T.ObjectExpression | null {
  if (!node || node.type !== "JSXExpressionContainer") return null
  const expression = node.expression
  if (expression.type !== "ObjectExpression") return null
  return expression
}

/**
 * Extract style object literal from JSX attribute value.
 * @param node JSX attribute value node
 * @returns Object literal for style or null
 */
export function styleObject(node: T.Node | null): T.ObjectExpression | null {
  if (!node || node.type !== "JSXExpressionContainer") return null
  const expression = node.expression
  if (expression.type !== "ObjectExpression") return null
  return expression
}

/**
 * Resolve object property key name when statically known.
 * @param key Property key node
 * @returns Static key name or null
 */
export const objectKeyName = getPropertyKeyName

/**
 * Visit every JSX class attribute entry.
 * @param graph Solid graph
 * @param visitor Callback for each class attribute and owning element
 */
export function forEachClassAttribute(
  graph: SolidGraph,
  visitor: (entry: JSXAttributeEntry) => void,
): void {
  const attrs = graph.jsxClassAttributes
  for (let i = 0; i < attrs.length; i++) {
    const entry = attrs[i]
    if (!entry) continue
    visitor(entry)
  }
}

/**
 * Visit class attributes across a Solid graph corpus.
 * @param graphs Solid graphs
 * @param visitor Callback for each graph and class attribute entry
 */
export function forEachClassAttributeAcross(
  graphs: readonly SolidGraph[],
  visitor: (graph: SolidGraph, entry: JSXAttributeEntry) => void,
): void {
  for (let i = 0; i < graphs.length; i++) {
    const graph = graphs[i]
    if (!graph) continue
    const attrs = graph.jsxClassAttributes
    for (let j = 0; j < attrs.length; j++) {
      const entry = attrs[j]
      if (!entry) continue
      visitor(graph, entry)
    }
  }
}

/**
 * Check whether every class attribute value is a static string literal.
 * @param graph Solid graph
 * @returns True when all class attributes are static literals
 */
export function hasOnlyStaticClassLiterals(graph: SolidGraph): boolean {
  const attrs = graph.jsxClassAttributes
  for (let i = 0; i < attrs.length; i++) {
    const attrEntry = attrs[i]
    if (!attrEntry) continue
    const idx = graph.staticClassTokensByElementId.get(attrEntry.element.id)
    if (!idx) return false
    if (idx.hasDynamicClass) return false
  }
  return true
}

/**
 * Visit every property inside classList object literals.
 * @param graph Solid graph
 * @param visitor Callback for each classList property
 */
export function forEachClassListProperty(
  graph: SolidGraph,
  visitor: (property: T.ObjectLiteralElementLike) => void,
): void {
  const properties = graph.classListProperties
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    if (!prop) continue
    visitor(prop.property)
  }
}

/**
 * Visit classList properties across a Solid graph corpus.
 * @param graphs Solid graphs
 * @param visitor Callback for each graph and classList property
 */
export function forEachClassListPropertyAcross(
  graphs: readonly SolidGraph[],
  visitor: (graph: SolidGraph, property: T.ObjectLiteralElementLike) => void,
): void {
  for (let i = 0; i < graphs.length; i++) {
    const graph = graphs[i]
    if (!graph) continue
    const properties = graph.classListProperties
    for (let j = 0; j < properties.length; j++) {
      const prop = properties[j]
      if (!prop) continue
      visitor(graph, prop.property)
    }
  }
}

/**
 * Visit every property inside style object literals.
 * @param graph Solid graph
 * @param visitor Callback for each style property and owning element
 */
export function forEachStyleProperty(
  graph: SolidGraph,
  visitor: (property: T.ObjectLiteralElementLike, element: JSXElementEntity) => void,
): void {
  const properties = graph.styleProperties
  for (let i = 0; i < properties.length; i++) {
    const entry = properties[i]
    if (!entry) continue
    visitor(entry.property, entry.element)
  }
}

/**
 * Visit style properties across a Solid graph corpus.
 * @param graphs Solid graphs
 * @param visitor Callback for each graph, style property, and owning element
 */
export function forEachStylePropertyAcross(
  graphs: readonly SolidGraph[],
  visitor: (graph: SolidGraph, property: T.ObjectLiteralElementLike, element: JSXElementEntity) => void,
): void {
  for (let i = 0; i < graphs.length; i++) {
    const graph = graphs[i]
    if (!graph) continue
    const properties = graph.styleProperties
    for (let j = 0; j < properties.length; j++) {
      const entry = properties[j]
      if (!entry) continue
      visitor(graph, entry.property, entry.element)
    }
  }
}

/**
 * Get static class tokens for a JSX element.
 * @param graph Solid graph
 * @param elementId JSX element id
 * @returns Static class tokens or empty array when dynamic
 */
export function getStaticClassTokensForElement(graph: SolidGraph, elementId: number): readonly string[] {
  const idx = graph.staticClassTokensByElementId.get(elementId)
  if (!idx || idx.hasDynamicClass) return []
  return idx.tokens
}

/**
 * Get static classList keys for a JSX element.
 * @param graph Solid graph
 * @param elementId JSX element id
 * @returns Statically known classList keys for the element
 */
export function getStaticClassListKeysForElement(graph: SolidGraph, elementId: number): readonly string[] {
  const idx = graph.staticClassListKeysByElementId.get(elementId)
  if (!idx) return []
  return idx.keys
}

/**
 * Get all statically known class tokens for an element.
 * @param graph Solid graph
 * @param element Element entity
 * @returns Combined static class and classList tokens
 */
export function getStaticClassTokensForElementEntity(
  graph: SolidGraph,
  element: JSXElementEntity,
): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const classTokens = getStaticClassTokensForElement(graph, element.id)
  for (let i = 0; i < classTokens.length; i++) {
    const token = classTokens[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  const classListTokens = getStaticClassListKeysForElement(graph, element.id)
  for (let i = 0; i < classListTokens.length; i++) {
    const token = classListTokens[i]
    if (!token) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }

  return out
}

/**
 * Get static style object keys for a JSX element.
 * @param graph Solid graph
 * @param elementId JSX element id
 * @returns Static style keys or empty array when dynamic
 */
export function getStaticStyleKeysForElement(graph: SolidGraph, elementId: number): readonly string[] {
  const idx = graph.staticStyleKeysByElementId.get(elementId)
  if (!idx || idx.hasDynamic) return []
  return idx.keys
}
