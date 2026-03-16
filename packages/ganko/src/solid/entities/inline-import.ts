/**
 * Inline Import Entity
 *
 * Represents TSImportType nodes (inline type imports) in the program graph.
 * Example: `import("@typescript-eslint/utils").TSESLint.RuleFixer`
 */

import type ts from "typescript";
import type { FileEntity } from "./file";

/**
 * Represents an inline type import in the SolidGraph.
 *
 * Inline imports use the `import("module").Type` syntax rather than
 * top-level import declarations. These should typically be refactored
 * to use proper import statements for better readability.
 */
export interface InlineImportEntity {
  readonly id: number;
  /** The TSImportType node */
  readonly node: ts.ImportTypeNode;
  /** The file containing this inline import */
  readonly file: FileEntity;
  /** The module specifier being imported (e.g., "@typescript-eslint/utils") */
  readonly source: string;
  /** The qualified path after the import (e.g., "TSESLint.RuleFixer") */
  readonly qualifier: string;
}
