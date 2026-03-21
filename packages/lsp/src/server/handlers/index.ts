/**
 * Handler Exports
 *
 * Re-exports all surviving LSP handlers from a single module.
 */

export type { HandlerContext } from "./handler-context";

export {
  type ServerState,
  createServerState,
  handleInitialize,
  handleInitialized,
  handleShutdown,
  handleExit,
  isServerReady,
} from "./lifecycle";


export {
  toLSPDiagnostic,
  convertDiagnostics,
  clearDiagnostics,
} from "./diagnostics";

export { handleDefinition } from "./definition";
export { handleReferences } from "./references";
export { handleHover } from "./hover";
export { handlePrepareRename, handleRename } from "./rename";
export { handleCompletion } from "./completion";
export { handleCodeAction } from "./code-action";
export { handleSignatureHelp } from "./signature-help";
export { handleDocumentHighlight } from "./document-highlight";
export { handleLinkedEditingRanges } from "./linked-editing";
export { handleFoldingRanges } from "./folding-ranges";
export { handleSelectionRange } from "./selection-range";
export { handleDocumentSymbol } from "./document-symbol";
export { handleWorkspaceSymbol } from "./workspace-symbol";
export { handleSemanticTokens, TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens";
export { handleInlayHint } from "./inlay-hint";

export { handleReactiveGraph } from "./reactive-graph";

export { positionToOffset, textSpanToRange } from "./ts-utils";
