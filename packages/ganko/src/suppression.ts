/**
 * Inline Suppression Comments
 *
 * Parses suppression directives from source comments and creates an emit
 * wrapper that filters diagnostics on suppressed lines.
 *
 * Supported directives:
 *   // ganko-disable-next-line rule-a rule-b
 *   // ganko-disable-line rule-a rule-b
 *   // ganko-disable rule-a rule-b  (file-level, suppresses all occurrences)
 *
 * When no rule IDs follow the directive, ALL rules are suppressed for that scope.
 */

import type { TSESLint } from "@typescript-eslint/utils"

const SEPARATOR = /[\s,]+/
import type { Emit } from "./graph"
import type { Diagnostic } from "./diagnostic"

const PREFIX_DISABLE_NEXT_LINE = "ganko-disable-next-line"
const PREFIX_DISABLE_LINE = "ganko-disable-line"
const PREFIX_DISABLE = "ganko-disable"

/**
 * Line suppression entry.
 * - Set<string>: specific rule IDs suppressed
 * - "all": every rule suppressed
 */
type LineSuppression = Set<string> | "all"

/**
 * File-level suppression.
 * - undefined: no file-level suppression
 * - Set<string>: specific rule IDs suppressed file-wide
 * - "all": every rule suppressed file-wide
 */
type FileSuppression = Set<string> | "all" | undefined

/**
 * Parsed suppression state for a single file.
 */
interface Suppressions {
  readonly lines: ReadonlyMap<number, LineSuppression>
  readonly file: FileSuppression
}

/** Sentinel: no suppressions found in the file. */
const EMPTY: Suppressions = { lines: new Map(), file: undefined }

/**
 * Parse a directive comment body into a set of rule IDs.
 * Returns "all" when no rule IDs follow the prefix.
 */
function parseRuleIds(body: string, prefix: string): Set<string> | "all" {
  const rest = body.slice(prefix.length).trim()
  if (rest.length === 0) return "all"
  const ids = new Set<string>()
  const parts = rest.split(SEPARATOR)
  for (let i = 0, len = parts.length; i < len; i++) {
    const id = parts[i]
    if (id !== undefined && id.length > 0) ids.add(id)
  }
  return ids.size > 0 ? ids : "all"
}

/**
 * Build the suppression map from all comments in the source file.
 */
export function parseSuppression(sourceCode: TSESLint.SourceCode): Suppressions {
  const comments = sourceCode.getAllComments()
  if (comments.length === 0) return EMPTY

  let lines: Map<number, LineSuppression> | undefined
  let file: FileSuppression

  for (let i = 0, len = comments.length; i < len; i++) {
    const comment = comments[i]
    if (!comment) continue
    const trimmed = comment.value.trim()

    if (trimmed.startsWith(PREFIX_DISABLE_NEXT_LINE)) {
      const ids = parseRuleIds(trimmed, PREFIX_DISABLE_NEXT_LINE)
      const targetLine = comment.loc.end.line + 1
      if (!lines) lines = new Map()
      mergeLine(lines, targetLine, ids)
      continue
    }

    if (trimmed.startsWith(PREFIX_DISABLE_LINE)) {
      const ids = parseRuleIds(trimmed, PREFIX_DISABLE_LINE)
      const targetLine = comment.loc.start.line
      if (!lines) lines = new Map()
      mergeLine(lines, targetLine, ids)
      continue
    }

    if (trimmed.startsWith(PREFIX_DISABLE)) {
      const ids = parseRuleIds(trimmed, PREFIX_DISABLE)
      if (ids === "all") {
        file = "all"
      } else if (file === undefined) {
        file = ids
      } else if (file !== "all") {
        for (const id of ids) file.add(id)
      }
    }
  }

  if (!lines && file === undefined) return EMPTY
  return { lines: lines ?? new Map(), file }
}

/**
 * Merge rule IDs into a line's suppression entry.
 * "all" wins over any specific set.
 */
function mergeLine(map: Map<number, LineSuppression>, line: number, ids: LineSuppression): void {
  const existing = map.get(line)
  if (existing === "all") return
  if (ids === "all") {
    map.set(line, "all")
    return
  }
  if (existing === undefined) {
    map.set(line, ids)
    return
  }
  for (const id of ids) existing.add(id)
}

/**
 * Check if a diagnostic is suppressed.
 */
function isSuppressed(suppressions: Suppressions, d: Diagnostic): boolean {
  const rule = d.rule

  if (suppressions.file === "all") return true
  if (suppressions.file !== undefined && suppressions.file.has(rule)) return true

  const entry = suppressions.lines.get(d.loc.start.line)
  if (entry === undefined) return false
  if (entry === "all") return true
  return entry.has(rule)
}

/**
 * Create an emit wrapper that filters suppressed diagnostics.
 *
 * Call this once per file analysis, passing the file's sourceCode.
 * The returned emit skips diagnostics matching suppression directives.
 */
export function createSuppressionEmit(sourceCode: TSESLint.SourceCode, target: Emit): Emit {
  const suppressions = parseSuppression(sourceCode)
  if (suppressions === EMPTY) return target
  return (d) => {
    if (!isSuppressed(suppressions, d)) target(d)
  }
}
