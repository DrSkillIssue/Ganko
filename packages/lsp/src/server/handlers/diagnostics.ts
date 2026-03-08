/**
 * Diagnostic Conversion
 *
 * Converts ganko diagnostics to LSP format.
 */
import type { Diagnostic } from "@drskillissue/ganko";
import {
  type Connection,
  type Diagnostic as LSPDiagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver";

/**
 * Convert a ganko Diagnostic to an LSP Diagnostic.
 */
export function toLSPDiagnostic(d: Diagnostic): LSPDiagnostic {
  return {
    range: {
      start: { line: d.loc.start.line - 1, character: d.loc.start.column },
      end: { line: d.loc.end.line - 1, character: d.loc.end.column },
    },
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    code: d.rule,
    source: "ganko",
    message: d.message,
  };
}

/**
 * Convert an array of ganko diagnostics to LSP diagnostics.
 */
export function convertDiagnostics(diagnostics: readonly Diagnostic[]): LSPDiagnostic[] {
  const len = diagnostics.length;
  if (len === 0) return [];
  const result = new Array<LSPDiagnostic>(len);
  for (let i = 0; i < len; i++) {
    const diag = diagnostics[i];
    if (!diag) continue;
    result[i] = toLSPDiagnostic(diag);
  }
  return result;
}

/**
 * Clear diagnostics for a file.
 */
export function clearDiagnostics(connection: Connection, uri: string): void {
  connection.sendDiagnostics({ uri, diagnostics: [] });
}
