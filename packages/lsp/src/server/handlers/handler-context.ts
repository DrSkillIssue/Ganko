import type ts from "typescript";
import type { Diagnostic, SolidSyntaxTree } from "@drskillissue/ganko";
import type { Logger, LeveledLogger } from "@drskillissue/ganko-shared";
import type { Connection } from "vscode-languageserver/node";
import type { ResourceIdentity } from "../resource-identity";
import type { DocumentManager } from "../document-manager";
import type { DiagnosticsManager } from "../diagnostics-manager";
import type { LifecyclePhase } from "../server-state";

export interface TSFileInfo {
  readonly ls: ts.LanguageService
  readonly sf: ts.SourceFile
}

export interface FeatureHandlerContext {
  readonly log: Logger
  getLanguageService(path: string): ts.LanguageService | null
  getSourceFile(path: string): ts.SourceFile | null
  getTSFileInfo(path: string): TSFileInfo | null
  getAST(path: string): ts.SourceFile | null
  getDiagnostics(path: string): readonly Diagnostic[]
  getContent(path: string): string | null
  getSolidSyntaxTree(path: string): SolidSyntaxTree | null
}

export interface DocumentHandlerContext {
  readonly identity: ResourceIdentity
  readonly documents: DocumentManager
  readonly diagnostics: DiagnosticsManager
  readonly log: Logger
  runDiagnostics(path: string): void
}

export interface LifecycleHandlerContext {
  readonly connection: Connection
  readonly log: LeveledLogger
  transitionPhase(phase: LifecyclePhase): void
}
