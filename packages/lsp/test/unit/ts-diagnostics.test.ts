/**
 * Unit tests for TypeScript diagnostic conversion utilities.
 *
 * Tests the pure functions in ts-diagnostics.ts: tsDiagsEqual,
 * convertTsDiagnostic, and the diagnostic code filter.
 */

import { describe, it, expect } from "vitest";
import { DiagnosticSeverity, type Diagnostic as LSPDiagnostic } from "vscode-languageserver";
import { tsDiagsEqual, convertTsDiagnostic } from "../../src/server/handlers/ts-diagnostics";
import ts from "typescript";

function makeLSPDiag(overrides: Partial<LSPDiagnostic> = {}): LSPDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
    severity: DiagnosticSeverity.Error,
    code: 2322,
    source: "ts",
    message: "Type 'string' is not assignable to type 'number'.",
    ...overrides,
  };
}

function makeTsDiag(overrides: Partial<ts.Diagnostic> & { file: ts.SourceFile }): ts.Diagnostic {
  return {
    category: ts.DiagnosticCategory.Error,
    code: 2322,
    messageText: "Type 'string' is not assignable to type 'number'.",
    start: 0,
    length: 10,
    ...overrides,
  };
}

describe("tsDiagsEqual", () => {
  it("returns true for identical arrays", () => {
    const a = [makeLSPDiag()];
    const b = [makeLSPDiag()];
    expect(tsDiagsEqual(a, b)).toBe(true);
  });

  it("returns true for empty arrays", () => {
    expect(tsDiagsEqual([], [])).toBe(true);
  });

  it("returns true when a is undefined and b is empty", () => {
    expect(tsDiagsEqual(undefined, [])).toBe(true);
  });

  it("returns false when a is undefined and b is non-empty", () => {
    expect(tsDiagsEqual(undefined, [makeLSPDiag()])).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(tsDiagsEqual([makeLSPDiag()], [makeLSPDiag(), makeLSPDiag()])).toBe(false);
  });

  it("returns false when code differs", () => {
    const a = [makeLSPDiag({ code: 2322 })];
    const b = [makeLSPDiag({ code: 2345 })];
    expect(tsDiagsEqual(a, b)).toBe(false);
  });

  it("returns false when severity differs", () => {
    const a = [makeLSPDiag({ severity: DiagnosticSeverity.Error })];
    const b = [makeLSPDiag({ severity: DiagnosticSeverity.Warning })];
    expect(tsDiagsEqual(a, b)).toBe(false);
  });

  it("returns false when message differs", () => {
    const a = [makeLSPDiag({ message: "Type 'string' is not assignable to type 'number'." })];
    const b = [makeLSPDiag({ message: "Type 'string' is not assignable to type 'boolean'." })];
    expect(tsDiagsEqual(a, b)).toBe(false);
  });

  it("returns false when start line differs", () => {
    const a = [makeLSPDiag({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } })];
    const b = [makeLSPDiag({ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } } })];
    expect(tsDiagsEqual(a, b)).toBe(false);
  });

  it("returns false when end position differs", () => {
    const a = [makeLSPDiag({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } })];
    const b = [makeLSPDiag({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 15 } } })];
    expect(tsDiagsEqual(a, b)).toBe(false);
  });
});

describe("convertTsDiagnostic", () => {
  it("returns null for diagnostics without a file", () => {
    const d: ts.Diagnostic = {
      category: ts.DiagnosticCategory.Error,
      code: 2322,
      messageText: "test",
      file: undefined,
      start: undefined,
      length: undefined,
    };
    expect(convertTsDiagnostic(d)).toBeNull();
  });

  it("converts a diagnostic with file, start, and length", () => {
    const sf = ts.createSourceFile("test.tsx", "const x: number = 'hello';", ts.ScriptTarget.Latest, true);
    const d = makeTsDiag({ file: sf, start: 18, length: 7 });

    const result = convertTsDiagnostic(d);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ts");
    expect(result?.code).toBe(2322);
    expect(result?.severity).toBe(DiagnosticSeverity.Error);
    expect(result?.range.start.line).toBe(0);
    expect(result?.range.start.character).toBe(18);
  });

  it("maps Warning category to DiagnosticSeverity.Warning", () => {
    const sf = ts.createSourceFile("test.tsx", "const x = 1;", ts.ScriptTarget.Latest, true);
    const d = makeTsDiag({ file: sf, category: ts.DiagnosticCategory.Warning });
    const result = convertTsDiagnostic(d);
    expect(result?.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("maps Suggestion category to DiagnosticSeverity.Hint", () => {
    const sf = ts.createSourceFile("test.tsx", "const x = 1;", ts.ScriptTarget.Latest, true);
    const d = makeTsDiag({ file: sf, category: ts.DiagnosticCategory.Suggestion });
    const result = convertTsDiagnostic(d);
    expect(result?.severity).toBe(DiagnosticSeverity.Hint);
  });

  it("flattens DiagnosticMessageChain", () => {
    const sf = ts.createSourceFile("test.tsx", "const x = 1;", ts.ScriptTarget.Latest, true);
    const chain: ts.DiagnosticMessageChain = {
      messageText: "outer message",
      category: ts.DiagnosticCategory.Error,
      code: 2322,
      next: [{
        messageText: "inner message",
        category: ts.DiagnosticCategory.Error,
        code: 2322,
      }],
    };
    const d: ts.Diagnostic = {
      file: sf,
      start: 0,
      length: 5,
      category: ts.DiagnosticCategory.Error,
      code: 2322,
      messageText: chain,
    };
    const result = convertTsDiagnostic(d);
    expect(result?.message).toContain("outer message");
    expect(result?.message).toContain("inner message");
  });

  it("converts relatedInformation", () => {
    const sf = ts.createSourceFile("test.tsx", "const x = 1;", ts.ScriptTarget.Latest, true);
    const relatedSf = ts.createSourceFile("types.ts", "export type T = number;", ts.ScriptTarget.Latest, true);
    const d: ts.Diagnostic = {
      file: sf,
      start: 0,
      length: 5,
      category: ts.DiagnosticCategory.Error,
      code: 2322,
      messageText: "test error",
      relatedInformation: [{
        file: relatedSf,
        start: 0,
        length: 22,
        category: ts.DiagnosticCategory.Message,
        code: 2322,
        messageText: "related info",
      }],
    };
    const result = convertTsDiagnostic(d);
    expect(result?.relatedInformation).toBeDefined();
    expect(result?.relatedInformation).toHaveLength(1);
    expect(result?.relatedInformation?.[0]?.message).toBe("related info");
  });
});
