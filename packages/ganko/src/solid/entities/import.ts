/**
 * Import Entity
 *
 * Represents import declarations in the program graph.
 */

import type ts from "typescript";
import type { FileEntity } from "./file";

/**
 * Represents an import declaration in the SolidGraph.
 */
export interface ImportEntity {
  readonly id: number;
  readonly node: ts.ImportDeclaration;
  readonly file: FileEntity;
  readonly source: string;
  readonly specifiers: readonly ImportSpecifierEntity[];
  readonly isTypeOnly: boolean;
}

/**
 * Represents an individual import specifier within an import declaration.
 *
 * Examples:
 * - `import { foo }` - named specifier
 * - `import foo from "mod"` - default specifier
 * - `import * as foo from "mod"` - namespace specifier
 */
export interface ImportSpecifierEntity {
  readonly id: number;
  readonly node: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport;
  readonly localName: string;
  readonly importedName: string | null;
  readonly kind: "named" | "default" | "namespace";
  readonly isTypeOnly: boolean;
}
