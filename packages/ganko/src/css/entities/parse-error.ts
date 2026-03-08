/**
 * CSS Parse Error
 */

/**
 * CSS parse error with location information.
 */
export interface CSSParseError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number | null;
  readonly endColumn: number | null;
  readonly file: string;
  readonly severity: "error" | "warn";
  readonly source: string | null;
  readonly isRecoverable: boolean;
}
