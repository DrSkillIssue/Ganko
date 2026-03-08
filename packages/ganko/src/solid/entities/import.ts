/**
 * Import Entity
 *
 * Represents import declarations in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FileEntity } from "./file";

/**
 * Represents an import declaration in the SolidGraph.
 */
export interface ImportEntity {
  readonly id: number;
  readonly node: T.ImportDeclaration;
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
  readonly node: T.ImportSpecifier | T.ImportDefaultSpecifier | T.ImportNamespaceSpecifier;
  readonly localName: string;
  readonly importedName: string | null;
  readonly kind: "named" | "default" | "namespace";
  readonly isTypeOnly: boolean;
}
