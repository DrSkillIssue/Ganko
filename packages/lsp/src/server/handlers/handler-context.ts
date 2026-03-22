import type ts from "typescript";
import type { Diagnostic, SolidSyntaxTree } from "@drskillissue/ganko";
import type { Logger, LeveledLogger } from "@drskillissue/ganko-shared";
import type { Connection } from "vscode-languageserver/node";
import type { LifecyclePhase } from "../session";

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

export interface LifecycleHandlerContext {
  readonly connection: Connection
  readonly log: LeveledLogger
  transitionPhase(phase: LifecyclePhase): void
}
