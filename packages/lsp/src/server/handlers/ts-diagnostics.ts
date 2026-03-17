/**
 * TypeScript Diagnostic Conversion
 *
 * Converts ts.Diagnostic to LSP Diagnostic format and collects
 * syntactic + semantic diagnostics from a ts.LanguageService.
 */
import ts from "typescript";
import type {
  Diagnostic as LSPDiagnostic,
  DiagnosticRelatedInformation as LSPRelatedInfo,
} from "vscode-languageserver";
import { DiagnosticSeverity } from "vscode-languageserver";
import { pathToUri } from "@drskillissue/ganko-shared";

function tsCategoryToSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error: return DiagnosticSeverity.Error;
    case ts.DiagnosticCategory.Warning: return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Suggestion: return DiagnosticSeverity.Hint;
    case ts.DiagnosticCategory.Message: return DiagnosticSeverity.Information;
    default: return DiagnosticSeverity.Error;
  }
}

export function convertTsDiagnostic(d: ts.Diagnostic): LSPDiagnostic | null {
  if (d.file === undefined || d.start === undefined || d.length === undefined) return null;

  const file = d.file;
  const start = file.getLineAndCharacterOfPosition(d.start);
  const end = file.getLineAndCharacterOfPosition(d.start + d.length);

  const result: LSPDiagnostic = {
    range: {
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
    },
    severity: tsCategoryToSeverity(d.category),
    code: d.code,
    source: "ts",
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  };

  if (d.relatedInformation !== undefined && d.relatedInformation.length > 0) {
    const related: LSPRelatedInfo[] = [];
    for (let i = 0, len = d.relatedInformation.length; i < len; i++) {
      const ri = d.relatedInformation[i];
      if (!ri || ri.file === undefined || ri.start === undefined || ri.length === undefined) continue;
      const riStart = ri.file.getLineAndCharacterOfPosition(ri.start);
      const riEnd = ri.file.getLineAndCharacterOfPosition(ri.start + ri.length);
      related.push({
        location: {
          uri: pathToUri(ri.file.fileName),
          range: {
            start: { line: riStart.line, character: riStart.character },
            end: { line: riEnd.line, character: riEnd.character },
          },
        },
        message: ts.flattenDiagnosticMessageText(ri.messageText, "\n"),
      });
    }
    if (related.length > 0) result.relatedInformation = related;
  }

  return result;
}

export function collectTsDiagnosticsForFile(
  ls: ts.LanguageService,
  fileName: string,
  includeSemantic: boolean,
): LSPDiagnostic[] {
  const result: LSPDiagnostic[] = [];

  const syntactic = ls.getSyntacticDiagnostics(fileName);
  for (let i = 0, len = syntactic.length; i < len; i++) {
    const d = syntactic[i];
    if (!d) continue;
    const converted = convertTsDiagnostic(d);
    if (converted !== null) result.push(converted);
  }

  if (includeSemantic) {
    const semantic = ls.getSemanticDiagnostics(fileName);
    for (let i = 0, len = semantic.length; i < len; i++) {
      const d = semantic[i];
      if (!d) continue;
      if (d.code >= 5000 && d.code < 6000) continue;
      const converted = convertTsDiagnostic(d);
      if (converted !== null) result.push(converted);
    }
  }

  return result;
}

export function tsDiagsEqual(
  a: readonly LSPDiagnostic[] | undefined,
  b: readonly LSPDiagnostic[],
): boolean {
  if (a === undefined) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) {
    const da = a[i];
    const db = b[i];
    if (!da || !db) return false;
    if (da.code !== db.code) return false;
    if (da.severity !== db.severity) return false;
    if (da.message !== db.message) return false;
    if (da.range.start.line !== db.range.start.line) return false;
    if (da.range.start.character !== db.range.start.character) return false;
    if (da.range.end.line !== db.range.end.line) return false;
    if (da.range.end.character !== db.range.end.character) return false;
  }
  return true;
}
