/**
 * Export Entity
 *
 * Represents an exported symbol from a file.
 * Tracks the relationship to the underlying entity (function/variable)
 * and provides metadata for cross-file analysis.
 */

import type ts from "typescript";
import type { ReactiveKind } from "./variable";
import type { SourceLocation } from "../../diagnostic";

/**
 * Export kind classification.
 * Matches ganko's ExportKind for compatibility.
 */
export enum ExportKind {
  FUNCTION = 0,
  VARIABLE = 1,
  COMPONENT = 2,
  CLASS = 3,
  TYPE = 4,
  SIGNAL = 5,
  STORE = 6,
  MEMO = 7,
  RESOURCE = 8,
}

/**
 * Represents a single export from a file.
 */
export interface ExportEntity {
  /** Unique ID within the graph */
  readonly id: number;

  /** Export name (or "default" for default export, "*" for namespace re-export) */
  readonly name: string;

  /** Classification of the export */
  readonly kind: ExportKind;

  /**
   * Entity ID of the underlying function or variable.
   * -1 for type-only exports or external re-exports.
   */
  readonly entityId: number;

  /** Whether this is a type-only export */
  readonly isTypeOnly: boolean;

  /** Whether this is the default export */
  readonly isDefault: boolean;

  /** Reactive kind if this exports a reactive value */
  readonly reactiveKind: ReactiveKind | null;

  /**
   * Signature string for change detection.
   * Used by workspace layer to detect export API changes.
   * Format: "fn:2" (function with 2 params), "var:signal", etc.
   */
  readonly signature: string;

  /** AST node for go-to-definition */
  readonly node: ts.Node;

  /** Location for quick access */
  readonly loc: SourceLocation | null;

  /**
   * Source module for re-exports, null for local exports.
   * Set for `export { X } from "./mod"` and `export * from "./mod"`.
   */
  readonly source: string | null;

  /**
   * Original name in source module for re-exports, null for local exports.
   * For `export { foo as bar } from "./mod"`, this is "foo".
   */
  readonly importedName: string | null;
}

/** Empty exports array sentinel */
export const EMPTY_EXPORTS: ExportEntity[] = [];
