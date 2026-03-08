/**
 * HandlerContext - Minimal interface for LSP handlers.
 *
 * Replaces the old ProjectContext from ganko-workspace.
 * Handlers use ts.LanguageService for cross-file features,
 * ganko diagnostics for linting, and ESTree AST for
 * structural handlers (folding, selection, linked-editing).
 */
import type ts from "typescript";
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { Diagnostic, SolidGraph } from "@drskillissue/ganko";
import type { Logger } from "@drskillissue/ganko-shared";

/** Combined result from a single TS service lookup. */
export interface TSFileInfo {
  readonly ls: ts.LanguageService
  readonly sf: ts.SourceFile
}

/** Context passed to all LSP handlers */
export interface HandlerContext {
  /** Scoped logger for handler-level tracing. */
  readonly log: Logger
  /** Get TypeScript language service for a file */
  getLanguageService(path: string): ts.LanguageService | null
  /** Get TypeScript source file */
  getSourceFile(path: string): ts.SourceFile | null
  /**
   * Get LanguageService + SourceFile in a single lookup.
   * Avoids the redundant TS service chain that happens when
   * calling getLanguageService and getSourceFile separately.
   */
  getTSFileInfo(path: string): TSFileInfo | null
  /** Get ESTree AST for a file (for folding/selection/linked-editing) */
  getAST(path: string): T.Program | null
  /** Get ganko diagnostics for a file */
  getDiagnostics(path: string): readonly Diagnostic[]
  /** Get raw file content for offset-to-position conversion */
  getContent(path: string): string | null
  /** Get the SolidGraph for a file (cached, returns null for non-Solid files) */
  getSolidGraph(path: string): SolidGraph | null
}
