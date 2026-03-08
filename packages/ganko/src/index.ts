/**
 * ganko
 *
 * Solid.js linting SDK — graphs, phases, rules.
 *
 * Every export is explicit. Only symbols consumed by external packages
 * (ganko, ganko-vscode) are exported. Internal types (Graph, Emit,
 * RuleMeta, BaseRule, etc.) are not re-exported.
 */

// Diagnostic model
export type { Diagnostic, Fix, FixOperation } from "./diagnostic"

// Plugin contract
export type { Plugin } from "./graph"

// Runner
export { createRunner, createOverrideEmit } from "./runner"
export type { Runner } from "./runner"

// Graph caching
export { GraphCache } from "./cache"

// Solid plugin
export { SolidPlugin, analyzeInput, buildSolidGraph, runSolidRules } from "./solid"
export { parseFile, parseContent, parseContentWithProgram } from "./solid"
export type { SolidGraph, SolidInput } from "./solid"
export type { VariableEntity, ReactiveKind, ReadEntity } from "./solid"
export type { ComputationEntity, DependencyEdge } from "./solid"

// CSS plugin
export { CSSPlugin, buildCSSGraph } from "./css"
export type { CSSGraph, CSSInput } from "./css"
export type { TailwindValidator } from "./css"
export { resolveTailwindValidator } from "./css"
export { scanDependencyCustomProperties } from "./css/library-analysis"

// Accessibility policy
export { setActivePolicy } from "./css/policy"

// Cross-file plugin
export { runCrossFileRules, buildLayoutGraph } from "./cross-file"

// Rule manifest (auto-generated)
export { RULES, RULES_BY_CATEGORY, getRule } from "./generated/rules-manifest"
export type { RuleEntry } from "./generated/rules-manifest"
