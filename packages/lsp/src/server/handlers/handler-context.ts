import type ts from "typescript";
import type { Diagnostic, SolidGraph } from "@drskillissue/ganko";
import type { Logger } from "@drskillissue/ganko-shared";

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
  getSolidGraph(path: string): SolidGraph | null
}

/** @deprecated Use FeatureHandlerContext */
export type HandlerContext = FeatureHandlerContext
