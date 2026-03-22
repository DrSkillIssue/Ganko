/**
 * Server Module Exports
 *
 * Re-exports the LSP server components.
 */

export {
  type ServerContext,
  createServer,
  startServer,
  main,
} from "./server";

export {
  buildServerCapabilities,
  buildMinimalCapabilities,
  COMPLETION_TRIGGER_CHARS,
  CODE_ACTION_KINDS,
} from "./capabilities";

export * from "./handlers";

// New architecture modules
export { ResourceMap } from "./resource-map";
export { type ResourceIdentity, createResourceIdentity } from "./resource-identity";
export { DiagnosticsManager, DiagnosticKind } from "./diagnostics-manager";
export { DocumentTracker, type TrackedDocument, type DocumentChange } from "./document-tracker";
export { type LifecyclePhase, type PhaseInitializing, type PhaseRunning, type PhaseEnriched, type PhaseShuttingDown } from "./session";
export { createWorkspaceChangeHandler, type WorkspaceChangeHandler, type FileChangeEvent } from "./workspace-change-handler";
