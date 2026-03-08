/**
 * CLI Output Formatter Tests
 *
 * Unit tests for formatText, formatJSON, and countDiagnostics.
 */
import { describe, it, expect } from "vitest";
import { formatText, formatJSON, countDiagnostics } from "../../src/cli/format";
import type { Diagnostic } from "@drskillissue/ganko";

function makeDiag(overrides: Partial<Diagnostic> & Pick<Diagnostic, "file" | "rule" | "message">): Diagnostic {
  return {
    severity: "error",
    messageId: "test",
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    ...overrides,
  };
}

describe("formatText", () => {
  it("returns empty string for no diagnostics", () => {
    expect(formatText([], "/cwd")).toBe("");
  });

  it("groups diagnostics by file", () => {
    const diagnostics: Diagnostic[] = [
      makeDiag({ file: "/cwd/src/a.tsx", rule: "r1", message: "msg1" }),
      makeDiag({ file: "/cwd/src/b.tsx", rule: "r2", message: "msg2" }),
      makeDiag({ file: "/cwd/src/a.tsx", rule: "r3", message: "msg3" }),
    ];

    const output = formatText(diagnostics, "/cwd");

    expect(output).toContain("src/a.tsx");
    expect(output).toContain("src/b.tsx");
    expect(output).toContain("3 problems");
  });

  it("sorts diagnostics by line within a file", () => {
    const diagnostics: Diagnostic[] = [
      makeDiag({
        file: "/cwd/a.tsx",
        rule: "r1",
        message: "second",
        loc: { start: { line: 10, column: 0 }, end: { line: 10, column: 5 } },
      }),
      makeDiag({
        file: "/cwd/a.tsx",
        rule: "r2",
        message: "first",
        loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
      }),
    ];

    const output = formatText(diagnostics, "/cwd");
    const firstIdx = output.indexOf("first");
    const secondIdx = output.indexOf("second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("shows correct error/warning counts", () => {
    const diagnostics: Diagnostic[] = [
      makeDiag({ file: "/cwd/a.tsx", rule: "r1", message: "m1", severity: "error" }),
      makeDiag({ file: "/cwd/a.tsx", rule: "r2", message: "m2", severity: "warn" }),
      makeDiag({ file: "/cwd/a.tsx", rule: "r3", message: "m3", severity: "warn" }),
    ];

    const output = formatText(diagnostics, "/cwd");
    expect(output).toContain("3 problems");
    expect(output).toContain("1 error");
    expect(output).toContain("2 warnings");
  });
});

describe("formatJSON", () => {
  it("returns empty array for no diagnostics", () => {
    expect(formatJSON([])).toBe("[]");
  });

  it("produces valid JSON with all fields", () => {
    const diagnostics: Diagnostic[] = [
      makeDiag({
        file: "/src/a.tsx",
        rule: "signal-call",
        message: "Call the signal",
        severity: "error",
        loc: { start: { line: 3, column: 5 }, end: { line: 3, column: 10 } },
      }),
    ];

    const parsed = JSON.parse(formatJSON(diagnostics));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      file: "/src/a.tsx",
      rule: "signal-call",
      severity: "error",
      message: "Call the signal",
      line: 3,
      column: 5,
      endLine: 3,
      endColumn: 10,
    });
  });
});

describe("countDiagnostics", () => {
  it("counts zero for empty array", () => {
    const { errors, warnings } = countDiagnostics([]);
    expect(errors).toBe(0);
    expect(warnings).toBe(0);
  });

  it("counts errors and warnings", () => {
    const diagnostics: Diagnostic[] = [
      makeDiag({ file: "/a.tsx", rule: "r1", message: "m1", severity: "error" }),
      makeDiag({ file: "/a.tsx", rule: "r2", message: "m2", severity: "warn" }),
      makeDiag({ file: "/a.tsx", rule: "r3", message: "m3", severity: "error" }),
    ];

    const { errors, warnings } = countDiagnostics(diagnostics);
    expect(errors).toBe(2);
    expect(warnings).toBe(1);
  });
});
