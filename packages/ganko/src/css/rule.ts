import type { BaseRule } from "../graph"
import type { CSSGraph } from "./impl"

/**
 * A CSS lint rule.
 */
export interface CSSRule extends BaseRule<CSSGraph> {
  readonly options: Record<string, unknown>
}

/**
 * Define a CSS lint rule.
 *
 * @example
 * ```ts
 * const options = {}
 *
 * export const noUnusedVariables = defineCSSRule({
 *   id: "no-unused-variables",
 *   severity: "warn",
 *   messages: { unused: "CSS variable '{{name}}' is unused." },
 *   meta: { description: "Disallow unused CSS variables", fixable: true, category: "css-property" },
 *   options,
 *   check(graph, emit) {
 *     // graph is CSSGraph - fully typed
 *   }
 * })
 * ```
 */
export function defineCSSRule(def: CSSRule): CSSRule {
  return def
}
