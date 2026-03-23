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
export type { Diagnostic, Fix, FixOperation, CommentEntry } from "./diagnostic"

// Plugin contract
export type { Plugin } from "./graph"

// Runner
export { createRunner, createOverrideEmit } from "./runner"
export type { Runner } from "./runner"

// Solid plugin
export { SolidPlugin, analyzeInput, runSolidRules } from "./solid"
export { createSolidInput } from "./solid"
export { buildSolidSyntaxTree } from "./solid"
export type { SolidSyntaxTree, SolidBuildContext, SolidInput } from "./solid"
export type { VariableEntity, ReactiveKind, ReadEntity } from "./solid"
export type { ComputationEntity, DependencyEdge } from "./solid"

// CSS plugin
export { CSSPlugin } from "./css"
export { buildCSSResult } from "./css"
export type { CSSBuildResult } from "./css/impl"
export type { CSSBuildContext } from "./css/build-context"
export type { CSSWorkspaceView } from "./css/workspace-view"
export type { CSSInput, CSSInputBuilder } from "./css"
export { createCSSInput } from "./css"
export type { TailwindValidator } from "./css"
export { prepareTailwindEval, buildTailwindValidatorFromEval, resolveTailwindValidatorSync } from "./css"
export type { TailwindEvalParams, BatchableTailwindValidator } from "./css"
export { scanDependencyCustomProperties } from "./css/library-analysis"

// Accessibility policy
export { setActivePolicy } from "./css/policy"

// Compilation system
export { createStyleCompilation, createCompilationFromLegacy } from "./compilation/core/compilation"
export type { StyleCompilation } from "./compilation/core/compilation"
export type { SolidSyntaxTree as SolidTree } from "./compilation/core/solid-syntax-tree"
export type { CSSSyntaxTree } from "./compilation/core/css-syntax-tree"
export { createCompilationTracker } from "./compilation/incremental/tracker"
export type { CompilationTracker, CompilationTrackerOptions } from "./compilation/incremental/tracker"
export { createPlainCSSProvider } from "./compilation/providers/plain-css"
export { createAnalysisDispatcher } from "./compilation/dispatch/dispatcher"
export type { AnalysisDispatcher } from "./compilation/dispatch/dispatcher"
export { allRules } from "./compilation/dispatch/rules/index"

// Rule manifest (auto-generated)
export { RULES, RULES_BY_CATEGORY, getRule } from "./generated/rules-manifest"
export type { RuleEntry } from "./generated/rules-manifest"
