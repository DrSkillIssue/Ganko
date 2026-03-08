import type { TSESTree as T } from "@typescript-eslint/utils"
import type { RuleSeverityOverride } from "@ganko/shared"

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

/** Comment token with location/range info */
export interface CommentToken {
  readonly value: string
  readonly range: readonly [number, number]
  readonly loc: SourceLocation
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
  return result
}

/**
 * Create a diagnostic from a comment token.
 */
export function createDiagnosticFromComment(
  file: string,
  comment: CommentToken,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
): Diagnostic {
  return createDiagnosticFromLoc(file, comment.loc, rule, messageId, message, severity, fix)
}

/**
 * Create a diagnostic from an AST node.
 */
export function createDiagnostic(
  file: string,
  node: T.Node | T.Comment,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
): Diagnostic {
  return createDiagnosticFromLoc(file, node.loc, rule, messageId, message, severity, fix)
}
