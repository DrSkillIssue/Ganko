import type { Diagnostic } from "./diagnostic"
import type { RuleSeverityOverride } from "@ganko/shared"

/** Emit callback type for pushing diagnostics */
export type Emit = (d: Diagnostic) => void

/** Rule category for grouping in configuration UIs and documentation. */
export type RuleCategory =
  | "reactivity"
  | "jsx"
  | "solid"
  | "correctness"
  | "performance"
  | "css-a11y"
  | "css-animation"
  | "css-cascade"
  | "css-property"
  | "css-selector"
  | "css-structure"
  | "css-jsx"
  | "css-layout"

/** Metadata shared by all rule types (Solid, CSS, cross-file). */
export interface RuleMeta {
  readonly description: string
  readonly fixable: boolean
  readonly category: RuleCategory
}

/**
 * Base rule interface parameterised on the graph/context type.
 * SolidRule, CSSRule, and CrossRule all satisfy this shape.
 */
export interface BaseRule<G> {
  readonly id: string
  readonly severity: RuleSeverityOverride
  readonly messages: Record<string, string>
  readonly meta: RuleMeta
  readonly check: (graph: G, emit: Emit) => void
}

/**
 * Run all enabled rules against a graph, emitting diagnostics.
 */
export function runRules<G>(rules: readonly BaseRule<G>[], graph: G, emit: Emit): void {
  for (const rule of rules) {
    if (rule.severity === "off") continue
    rule.check(graph, emit)
  }
}

/**
 * Base interface for all program graphs.
 * Each graph type extends this with domain-specific properties.
 */
export interface Graph {
  readonly kind: string
}

/**
 * A plugin provides a graph type and its rules.
 *
 * Plugins push data OUT via callbacks. The runner never stores typed graphs.
 * Plugins run their own rules internally via the analyze() method.
 *
 * @typeParam K - The plugin kind string
 */
export interface Plugin<K extends string> {
  readonly kind: K
  readonly extensions: readonly string[]
  /** Analyze files and emit diagnostics via callback */
  analyze(files: readonly string[], emit: Emit): void
}
