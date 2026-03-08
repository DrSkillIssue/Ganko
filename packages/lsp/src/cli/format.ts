/**
 * CLI Output Formatters
 *
 * Converts ganko diagnostics to human-readable terminal output
 * or structured JSON for CI consumption.
 */
import type { Diagnostic } from "@drskillissue/ganko";
import { relative } from "node:path";

/** ANSI color codes for terminal output */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

/** Group diagnostics by file path, preserving insertion order. */
function groupByFile(diagnostics: readonly Diagnostic[]): Map<string, Diagnostic[]> {
  const groups = new Map<string, Diagnostic[]>();
  for (let i = 0, len = diagnostics.length; i < len; i++) {
    const d = diagnostics[i];
    if (!d) continue;
    let group = groups.get(d.file);
    if (group === undefined) {
      group = [];
      groups.set(d.file, group);
    }
    group.push(d);
  }
  return groups;
}

/** Sort diagnostics by line then column within each group. */
function sortByLocation(diagnostics: Diagnostic[]): void {
  diagnostics.sort((a, b) => {
    const lineDiff = a.loc.start.line - b.loc.start.line;
    if (lineDiff !== 0) return lineDiff;
    return a.loc.start.column - b.loc.start.column;
  });
}

/**
 * Format diagnostics as human-readable terminal output.
 *
 * Output matches the familiar eslint-style format:
 * ```
 * src/App.tsx
 *   3:10  error  Missing signal call  signal-call
 *   7:5   warning  Unused CSS class  unused-css-class
 *
 * ✖ 2 problems (1 error, 1 warning)
 * ```
 *
 * @param diagnostics - All diagnostics to format
 * @param cwd - Working directory for relative paths
 * @returns Formatted string for terminal output
 */
export function formatText(diagnostics: readonly Diagnostic[], cwd: string): string {
  if (diagnostics.length === 0) return "";

  const groups = groupByFile(diagnostics);
  const lines: string[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const [filePath, fileDiags] of groups) {
    sortByLocation(fileDiags);
    const rel = relative(cwd, filePath);

    lines.push(`${ANSI.bold}${rel}${ANSI.reset}`);

    for (let i = 0, len = fileDiags.length; i < len; i++) {
      const d = fileDiags[i];
      if (!d) continue;
      const loc = `${d.loc.start.line}:${d.loc.start.column}`;
      const sevColor = d.severity === "error" ? ANSI.red : ANSI.yellow;
      const sevLabel = d.severity === "error" ? "error" : "warn";

      if (d.severity === "error") errorCount++;
      else warningCount++;

      lines.push(
        `  ${ANSI.dim}${loc.padEnd(8)}${ANSI.reset}${sevColor}${sevLabel.padEnd(9)}${ANSI.reset}${d.message}  ${ANSI.gray}${d.rule}${ANSI.reset}`,
      );
    }

    lines.push("");
  }

  const total = errorCount + warningCount;
  const summary = `${ANSI.bold}${ANSI.red}\u2716 ${total} problem${total !== 1 ? "s" : ""} (${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""})${ANSI.reset}`;
  lines.push(summary);

  return lines.join("\n");
}

/** JSON-serializable diagnostic for CI output. */
interface JSONDiagnostic {
  readonly file: string
  readonly rule: string
  readonly severity: string
  readonly message: string
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly endColumn: number
}

/**
 * Format diagnostics as JSON array.
 *
 * @param diagnostics - All diagnostics to format
 * @returns JSON string
 */
export function formatJSON(diagnostics: readonly Diagnostic[]): string {
  const output: JSONDiagnostic[] = new Array(diagnostics.length);
  for (let i = 0, len = diagnostics.length; i < len; i++) {
    const d = diagnostics[i];
    if (!d) continue;
    output[i] = {
      file: d.file,
      rule: d.rule,
      severity: d.severity,
      message: d.message,
      line: d.loc.start.line,
      column: d.loc.start.column,
      endLine: d.loc.end.line,
      endColumn: d.loc.end.column,
    };
  }
  return JSON.stringify(output, null, 2);
}

/**
 * Count errors and warnings in a diagnostic set.
 *
 * @param diagnostics - Diagnostics to count
 * @returns Error and warning counts
 */
export function countDiagnostics(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (let i = 0, len = diagnostics.length; i < len; i++) {
    const d = diagnostics[i];
    if (!d) continue;
    if (d.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}
