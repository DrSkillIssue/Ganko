/**
 * Server Lifecycle Phase — Discriminated union for phase-specific state.
 *
 * ServerContext holds infrastructure that's always available (connection,
 * log, documents, diagManager, etc.). This module defines the PHASE field
 * on ServerContext — a discriminated union that encodes what's available
 * at each lifecycle stage. Nullable fields like `project`, `fileIndex`,
 * `handlerCtx` are eliminated — they exist only on the phases where
 * they're guaranteed to be set.
 *
 * Consumers narrow via: if (context.phase.tag === "running") { context.phase.project }
 */

import type { TailwindValidator } from "@drskillissue/ganko";
import type { WorkspaceLayout } from "@drskillissue/ganko-shared";
import type { Project } from "../core/project";
import type { FileRegistry } from "../core/file-registry";
import type { FeatureHandlerContext } from "./handlers/handler-context";
import type { ChangePipeline } from "../core/change-pipeline";
import type { TailwindState } from "../core/tailwind-state";
import type { WorkspaceEvaluator } from "../core/workspace-eval";
import type { BatchableTailwindValidator } from "@drskillissue/ganko";

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
  readonly changePipeline: ChangePipeline
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
