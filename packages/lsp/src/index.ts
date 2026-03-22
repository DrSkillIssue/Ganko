/**
 * ganko
 *
 * Language Server Protocol implementation for Solid.js.
 * Provides real-time diagnostics, cross-file analysis, and IDE features.
 *
 * @example
 * ```typescript
 * // Start the LSP server
 * import { createServer, startServer } from "@drskillissue/ganko"
 * const ctx = createServer()
 * startServer(ctx)
 *
 * // Or use programmatically
 * import { createProject } from "@drskillissue/ganko"
 * import { SolidPlugin, CSSPlugin } from "@drskillissue/ganko"
 * const project = createProject({ rootPath: "/path/to/project", plugins: [SolidPlugin, CSSPlugin] })
 * const diagnostics = project.run(["App.tsx"])
 * ```
 */

// Re-export types from ganko
export type { Diagnostic, Fix, FixOperation } from "@drskillissue/ganko";

// Project management
export { createProject } from "./core/project";
export type { Project, ProjectConfig } from "./core/project";

// TypeScript program services
export { createBatchProgram, type BatchTypeScriptService } from "./core/batch-program";
export { createIncrementalProgram, type IncrementalTypeScriptService } from "./core/incremental-program";

// Server exports
export { createServer, startServer, main } from "./server/server";
export { buildServerCapabilities } from "./server/capabilities";

// Handler exports
export {
  handlePrepareRename,
  handleRename,
  handleReferences,
  handleDefinition,
  handleHover,
  handleCompletion,
  handleCodeAction,
  handleSignatureHelp,
  handleDocumentHighlight,
  handleLinkedEditingRanges,
  handleFoldingRanges,
  handleSelectionRange,
} from "./server/handlers";

export type { FeatureHandlerContext } from "./server/handlers";

// Logger
export { createLspLogger, createCliLogger, noopLogger, type Logger, type LeveledLogger } from "./core/logger";

// CLI exports
export { runLint } from "./cli/lint";

