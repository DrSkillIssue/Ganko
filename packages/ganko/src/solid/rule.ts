import type { BaseRule } from "../graph"
import type { SolidGraph } from "./impl"

/**
 * A Solid.js lint rule.
 *
 * Rules receive a typed SolidGraph and emit diagnostics via callback.
 * No workspace lookup needed - the graph is fully typed.
 */
export interface SolidRule extends BaseRule<SolidGraph> {
  readonly options: Record<string, unknown>
}

/**
 * Define a Solid.js lint rule.
 *
 * @example
 * ```ts
 * const options = { minLength: 10 }
 *
 * export const noBannerComments = defineSolidRule({
 *   id: "no-banner-comments",
 *   severity: "error",
 *   messages: { banner: "Avoid banner-style comments." },
 *   meta: { description: "Disallow banner comments", fixable: true, category: "correctness" },
 *   options,
 *   check(graph, emit) {
 *     // graph is SolidGraph - fully typed
 *     // access options.minLength via closure
 *     for (const comment of graph.getComments()) {
 *       // emit diagnostics directly
 *       emit({ ... })
 *     }
 *   }
 * })
 * ```
 */
export function defineSolidRule(def: SolidRule): SolidRule {
  return def
}
