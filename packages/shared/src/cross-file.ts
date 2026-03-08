import type { FileKind } from "./extensions";

/**
 * Cross-file dependency model: when a file of kind K changes,
 * which open file kinds need re-diagnosis?
 *
 * - CSS changed → re-diagnose open Solid files (class usage) and CSS files (custom properties)
 * - Solid changed → re-diagnose open CSS files (unreferenced class detection)
 * - Unknown changed → nothing depends on unknown files
 */
export const CROSS_FILE_DEPENDENTS: Readonly<Record<FileKind, ReadonlySet<FileKind>>> = {
  css: new Set<FileKind>(["solid", "css"]),
  solid: new Set<FileKind>(["css"]),
  unknown: new Set<FileKind>(),
};
