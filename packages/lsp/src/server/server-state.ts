/**
 * Server State Machine — Discriminated server lifecycle phases.
 *
 * Replaces the mutable ServerState bag in handlers/lifecycle.ts with a
 * tagged union where each phase declares exactly what's available.
 * Handlers declare the minimum phase they require via requirePhase(),
 * which narrows the union — no nullable fields, no runtime guessing.
 *
 * Modeled after typescript-language-server's ServerState namespace with
 * None/Running/Errored discriminated states and explicit transitions.
 */

import type { Connection, InitializeParams } from "vscode-languageserver"
import type { GraphCache, TailwindValidator } from "@drskillissue/ganko"
import type { RuleOverrides } from "@drskillissue/ganko-shared"
import type { Project } from "../core/project"
import type { FileIndex } from "../core/file-index"
import type { DiagnosticsManager } from "./diagnostics-manager"
import type { DocumentManager } from "./document-manager"
import type { ResourceIdentity } from "./resource-identity"
import type { LeveledLogger } from "../core/logger"

export const enum ServerPhase {
  /** Connection established, no project. */
  Initializing = 0,
  /** Project loaded, Tier1 TS available, single-file diagnostics active. */
  Running = 1,
  /** Full program built, cross-file analysis active. */
  Enriched = 2,
  /** Unrecoverable error — server should be restarted. */
  Errored = 3,
  /** Shutdown requested. */
  ShutDown = 4,
}

export interface StateInitializing {
  readonly phase: ServerPhase.Initializing
  readonly connection: Connection
  readonly identity: ResourceIdentity
  readonly log: LeveledLogger
}

export interface StateRunning {
  readonly phase: ServerPhase.Running
  readonly connection: Connection
  readonly identity: ResourceIdentity
  readonly log: LeveledLogger
  readonly project: Project
  readonly fileIndex: FileIndex
  readonly documents: DocumentManager
  readonly diagnostics: DiagnosticsManager
  readonly ruleOverrides: RuleOverrides | null
  readonly clientCapabilities: InitializeParams["capabilities"]
  readonly rootPath: string
  readonly rootUri: string
  readonly enableTsDiagnostics: boolean
  readonly warningsAsErrors: boolean
}

export interface StateEnriched {
  readonly phase: ServerPhase.Enriched
  readonly connection: Connection
  readonly identity: ResourceIdentity
  readonly log: LeveledLogger
  readonly project: Project
  readonly fileIndex: FileIndex
  readonly documents: DocumentManager
  readonly diagnostics: DiagnosticsManager
  readonly graphCache: GraphCache
  readonly tailwindValidator: TailwindValidator | null
  readonly ruleOverrides: RuleOverrides | null
  readonly clientCapabilities: InitializeParams["capabilities"]
  readonly rootPath: string
  readonly rootUri: string
  readonly enableTsDiagnostics: boolean
  readonly warningsAsErrors: boolean
}

export interface StateErrored {
  readonly phase: ServerPhase.Errored
  readonly error: Error
  readonly connection: Connection
  readonly log: LeveledLogger
}

export interface StateShutDown {
  readonly phase: ServerPhase.ShutDown
}

export type GankoServerState =
  | StateInitializing
  | StateRunning
  | StateEnriched
  | StateErrored
  | StateShutDown

/**
 * Narrow the server state to one or more required phases.
 * Returns null if the server is not in any of the specified phases.
 *
 * Usage:
 *   const running = requirePhase(state, ServerPhase.Running, ServerPhase.Enriched)
 *   if (!running) return // server not ready
 *   running.project // typed, non-nullable
 */
export function requirePhase<P extends ServerPhase>(
  state: GankoServerState,
  ...phases: P[]
): Extract<GankoServerState, { phase: P }> | null {
  for (let i = 0; i < phases.length; i++) {
    if (state.phase === phases[i]) return state as Extract<GankoServerState, { phase: P }>
  }
  return null
}

/**
 * Check if the server is in a phase where feature handlers can execute.
 * Convenience for the common Running | Enriched guard.
 */
export function isReady(state: GankoServerState): state is StateRunning | StateEnriched {
  return state.phase === ServerPhase.Running || state.phase === ServerPhase.Enriched
}
