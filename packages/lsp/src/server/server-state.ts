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

import type { TailwindValidator } from "@drskillissue/ganko"
import type { Project } from "../core/project"
import type { FileIndex } from "../core/file-index"
import type { FeatureHandlerContext } from "./handlers/handler-context"

export interface PhaseInitializing {
  readonly tag: "initializing"
}

export interface PhaseRunning {
  readonly tag: "running"
  readonly project: Project
  readonly handlerCtx: FeatureHandlerContext
  readonly fileIndex: FileIndex | null
}

export interface PhaseEnriched {
  readonly tag: "enriched"
  readonly project: Project
  readonly handlerCtx: FeatureHandlerContext
  readonly fileIndex: FileIndex
  readonly tailwindValidator: TailwindValidator | null
  readonly externalCustomProperties: ReadonlySet<string> | undefined
}

export interface PhaseShuttingDown {
  readonly tag: "shutdown"
}

export type LifecyclePhase =
  | PhaseInitializing
  | PhaseRunning
  | PhaseEnriched
  | PhaseShuttingDown

export function isRunningOrEnriched(phase: LifecyclePhase): phase is PhaseRunning | PhaseEnriched {
  return phase.tag === "running" || phase.tag === "enriched"
}
