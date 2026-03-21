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
} from "./connection";

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
export { DocumentManager, DocumentStatus, type TrackedDocument } from "./document-manager";
export { type GankoServerState, ServerPhase, requirePhase, isReady } from "./server-state";
export { ChangeProcessor, type FileChangeEvent } from "./change-processor";
