import type ts from "typescript"
import type { RuleSeverityOverride } from "@drskillissue/ganko-shared"
import { nodeToSourceLocation } from "./ast-utils"

export type MessageId = string
export type Message = string

/**
 * Diagnostic severity — matches RuleSeverityOverride minus "off".
 * Rules that are "off" never emit, so diagnostics only carry "error" or "warn".
 */
export type DiagnosticSeverity = "error" | "warn"

/**
 * Narrow a rule's configured severity to a diagnostic severity.
 *
 * Rules with `severity: "off"` are normally skipped by `runRules`, but can
 * be invoked directly in tests or when re-enabled by user overrides. When
 * running despite "off", diagnostics emit as "warn".
 */
export function effectiveSeverity(severity: RuleSeverityOverride): DiagnosticSeverity {
  return severity === "off" ? "warn" : severity
}

export interface SourceLocation {
  readonly start: { readonly line: number; readonly column: number }
  readonly end: { readonly line: number; readonly column: number }
}

export interface FixOperation {
  readonly range: readonly [number, number]
  readonly text: string
}

export type Fix = readonly FixOperation[]

export interface Suggestion {
  readonly messageId: MessageId
  readonly message: Message
  readonly fix: Fix
}

export interface Diagnostic {
  readonly file: string
  readonly rule: string
  readonly messageId: MessageId
  readonly message: Message
  readonly severity: DiagnosticSeverity
  readonly loc: SourceLocation
  readonly fix?: Fix
  readonly suggest?: readonly Suggestion[]
}

/** Comment entry extracted from TypeScript scanner */
export interface CommentEntry {
  readonly pos: number
  readonly end: number
  readonly value: string
  readonly line: number
  readonly endLine: number
  readonly kind: ts.SyntaxKind.SingleLineCommentTrivia | ts.SyntaxKind.MultiLineCommentTrivia
}

/**
 * Clamp a multi-line location to the first line.
 *
 * Diagnostics should highlight only the first line of a node, not span
 * the entire body. Editors clamp column values that exceed line length.
 */
function firstLine(loc: SourceLocation): SourceLocation {
  if (loc.start.line === loc.end.line) return loc
  return { start: loc.start, end: { line: loc.start.line, column: 9999 } }
}

/**
 * Interpolates message placeholders with data values.
 * @param template Message template with {{placeholder}} syntax
 * @param data Key-value pairs for placeholder substitution
 * @returns Resolved message with placeholders replaced
 */
export function resolveMessage(
  template: string,
  data?: Record<string, string>,
): string {
  if (!data) return template
  let result = template
  for (const [k, v] of Object.entries(data)) {
    result = result.replaceAll(`{{${k}}}`, v)
  }
  return result
}

/**
 * Create a diagnostic from explicit location.
 */
export function createDiagnosticFromLoc(
  file: string,
  loc: SourceLocation,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
  suggest?: readonly Suggestion[],
): Diagnostic {
  const result: { -readonly [K in keyof Diagnostic]: Diagnostic[K] } = {
    file,
    rule,
    messageId,
    message,
    severity,
    loc: firstLine(loc),
  }
  if (fix !== undefined) result.fix = fix
  if (suggest !== undefined && suggest.length > 0) result.suggest = suggest
  return result
}

/**
 * Create a diagnostic from a comment entry.
 */
export function createDiagnosticFromComment(
  file: string,
  comment: CommentEntry,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
  suggest?: readonly Suggestion[],
): Diagnostic {
  const loc: SourceLocation = {
    start: { line: comment.line, column: 0 },
    end: { line: comment.endLine, column: 0 },
  }
  return createDiagnosticFromLoc(file, loc, rule, messageId, message, severity, fix, suggest)
}

/**
 * Create a diagnostic from a TypeScript AST node.
 */
export function createDiagnostic(
  file: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
  suggest?: readonly Suggestion[],
): Diagnostic {
  return createDiagnosticFromLoc(file, nodeToSourceLocation(node, sourceFile), rule, messageId, message, severity, fix, suggest)
}
