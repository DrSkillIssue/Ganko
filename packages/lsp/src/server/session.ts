/**
 * ServerSession — Snapshot of server state with snapshot semantics.
 *
 * Like Roslyn's Solution: document changes produce new sessions.
 * Handlers receive a typed session, never a mutable bag.
 *
 * SNAPSHOT SEMANTICS, NOT DEEP IMMUTABILITY. The StyleCompilation
 * referenced by a session is immutable. The IncrementalTypeScriptService
 * is shared mutable infrastructure (like Roslyn's Workspace updating
 * the host). Mutable infrastructure (CompilationTracker, TsService,
 * FileRegistry) lives on ServerContext, NOT on the session.
 *
 * Diagnostic results are NOT on the session. DiagnosticsManager is a
 * server-level service (like Roslyn's DiagnosticAnalyzerService).
 */

import type { StyleCompilation, TailwindValidator, BatchableTailwindValidator } from "@drskillissue/ganko";
import type { WorkspaceLayout, RuleOverrides, AccessibilityPolicy } from "@drskillissue/ganko-shared";
import type { Project } from "../core/project";
import type { WorkspaceEvaluator } from "../core/workspace-eval";
import type ts from "typescript";

// ── Session ─────────────────────────────────────────────────────────

export interface ServerSession {
  readonly id: number
  readonly rootPath: string
  readonly config: Readonly<FrozenServerConfig>
  /** Immutable compilation snapshot. CompilationTracker lives on ServerContext. */
  readonly compilation: StyleCompilation
  readonly tsProgram: TsProgramState
  readonly workspace: WorkspaceState
}

// ── Frozen config ───────────────────────────────────────────────────

/** Immutable config snapshot. ruleOverrides is derived, never set directly. */
export interface FrozenServerConfig {
  readonly vscodeOverrides: RuleOverrides
  readonly eslintOverrides: RuleOverrides
  /** Derived: mergeOverrides(eslintOverrides, vscodeOverrides). */
  readonly ruleOverrides: RuleOverrides
  readonly useESLintConfig: boolean
  readonly eslintConfigPath: string | undefined
  readonly exclude: readonly string[]
  readonly eslintIgnores: readonly string[]
  readonly enableTsDiagnostics: boolean
  readonly warningsAsErrors: boolean
  readonly vscodePolicy: AccessibilityPolicy
}

// ── TypeScript program state ────────────────────────────────────────

export type TsProgramState =
  | { readonly tier: "quick"; readonly compilerOptions: ts.CompilerOptions | null }
  | { readonly tier: "incremental"; readonly project: Project };

// ── Workspace state ─────────────────────────────────────────────────

export type WorkspaceState =
  | { readonly enriched: false }
  | {
      readonly enriched: true
      readonly solidFiles: ReadonlySet<string>
      readonly cssFiles: ReadonlySet<string>
      readonly layout: WorkspaceLayout
      readonly tailwindValidator: TailwindValidator | null
      readonly batchableValidator: BatchableTailwindValidator | null
      readonly externalCustomProperties: ReadonlySet<string> | undefined
      readonly evaluator: WorkspaceEvaluator | null
    };

// ── Lifecycle ───────────────────────────────────────────────────────

export type ServerLifecycle =
  | { readonly state: "created" }
  | { readonly state: "initializing"; readonly rootPath: string }
  | { readonly state: "running" }
  | { readonly state: "shutting-down" }
  | { readonly state: "errored"; readonly error: Error };

// ── Legacy lifecycle phases (adapter bridge — used by ServerContext.phase) ──

import type { FileRegistry } from "../core/file-registry";
import type { FeatureHandlerContext } from "./handlers/handler-context";
import type { TailwindState } from "../core/tailwind-state";

export interface PhaseInitializing {
  readonly tag: "initializing"
}

export interface PhaseRunning {
  readonly tag: "running"
  readonly project: Project
  readonly handlerCtx: FeatureHandlerContext
}

export interface PhaseEnriched {
  readonly tag: "enriched"
  readonly project: Project
  readonly handlerCtx: FeatureHandlerContext
  readonly registry: FileRegistry
  readonly layout: WorkspaceLayout
  readonly tailwindValidator: TailwindValidator | null
  readonly externalCustomProperties: ReadonlySet<string> | undefined
  readonly tailwindState: TailwindState
  readonly evaluator: WorkspaceEvaluator | null
  readonly batchableValidator: BatchableTailwindValidator | null
}

export interface PhaseShuttingDown {
  readonly tag: "shutdown"
}

export type LifecyclePhase =
  | PhaseInitializing
  | PhaseRunning
  | PhaseEnriched
  | PhaseShuttingDown;
