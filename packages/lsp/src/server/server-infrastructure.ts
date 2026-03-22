/**
 * Server Infrastructure — The mutable infrastructure interface that
 * SessionMutator reads from to produce immutable ServerSession snapshots.
 *
 * Both the LSP server (ServerContext) and the daemon (DaemonState)
 * implement this interface. SessionMutator is decoupled from LSP-specific
 * types like Connection, FilteredTextDocuments, etc.
 */

import type { CompilationTracker } from "@drskillissue/ganko";
import type { WorkspaceLayout } from "@drskillissue/ganko-shared";
import type { TailwindValidator, BatchableTailwindValidator } from "@drskillissue/ganko";
import type { FileRegistry } from "../core/file-registry";
import type { Project } from "../core/project";
import type { WorkspaceEvaluator } from "../core/workspace-eval";
import type { ServerConfig } from "./handlers/lifecycle";
import type { Logger } from "../core/logger";
import type ts from "typescript";

/**
 * ServerInfrastructure — the subset of mutable server state that
 * SessionMutator needs to produce a ServerSession.
 *
 * Implemented by:
 * - LSP's ServerContext (has all fields)
 * - Daemon's DaemonState (implements the subset)
 */
export interface ServerInfrastructure {
  readonly log: Logger
  tracker: CompilationTracker
  getProject(): Project | null
  getTsCompilerOptions(): ts.CompilerOptions | null
  getRootPath(): string | null
  getConfig(): ServerConfig
  getFileRegistry(): FileRegistry | null
  getWorkspaceLayout(): WorkspaceLayout | null
  getTailwindValidator(): TailwindValidator | null
  getBatchableValidator(): BatchableTailwindValidator | null
  getExternalCustomProperties(): ReadonlySet<string> | undefined
  getEvaluator(): WorkspaceEvaluator | null
}
