/**
 * CSS Class Query Helpers
 *
 * Query functions for finding CSS class definitions in CSSGraph.
 */

import type { CSSGraph } from "../impl"

/**
 * Location info for a CSS class definition.
 */
export interface ClassDefinition {
  /** Class name (without leading dot) */
  readonly name: string
  /** File path where class is defined */
  readonly file: string
  /** Full selector text containing this class */
  readonly selector: string
  /** Line number (1-based) */
  readonly line: number
  /** Column number (0-based) */
  readonly column: number
}

/**
 * Check if a class selector exists in the CSS graph.
 *
 * @param graph - CSS graph to search
 * @param name - Class name (without leading dot)
 * @returns True if class is defined
 */
export function hasClassSelector(graph: CSSGraph, name: string): boolean {
  if (graph.classNameIndex.has(name)) return true
  if (graph.tailwind !== null && graph.tailwind.has(name)) return true
  return false
}

/**
 * Get all definitions for a class name across the CSS graph.
 *
 * @param graph - CSS graph to search
 * @param name - Class name (without leading dot)
 * @returns Array of class definitions
 */
export function getClassDefinitions(graph: CSSGraph, name: string): ClassDefinition[] {
  const selectors = graph.classNameIndex.get(name)
  if (!selectors) return []
  const defs: ClassDefinition[] = []
  for (let i = 0, len = selectors.length; i < len; i++) {
    const selector = selectors[i]
    if (!selector) continue
    const rule = selector.rule
    defs.push({
      name,
      file: rule.file.path,
      selector: selector.raw,
      line: rule.startLine,
      column: rule.startColumn,
    })
  }
  return defs
}

/**
 * Get all unique class names defined in the CSS graph.
 *
 * @param graph - CSS graph to search
 * @returns Set of class names
 */
export function getAllClassNames(graph: CSSGraph): Set<string> {
  return new Set(graph.classNameIndex.keys())
}
