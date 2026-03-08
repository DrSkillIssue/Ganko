/**
 * File Entity
 *
 * Represents a parsed TypeScript/TSX file in the graph.
 */

import type { TSESLint } from "@typescript-eslint/utils";
import type { FunctionEntity } from "./function";
import type { CallEntity } from "./call";
import type { VariableEntity } from "./variable";
import type { ScopeEntity } from "./scope";
import type { JSXElementEntity } from "./jsx";
import type { ImportEntity } from "./import";
import type { ConditionalSpreadEntity } from "./spread";

/**
 * File entity representing a parsed TypeScript/TSX file.
 *
 * SourceCode properties (ast, scopeManager, etc.) accessed via sourceCode field.
 * sourceCode may be null only for internal sentinel files used in fallback scopes.
 */
export interface FileEntity {
  id: number;
  path: string;
  sourceCode: TSESLint.SourceCode | null;
  functions: FunctionEntity[];
  calls: CallEntity[];
  variables: VariableEntity[];
  scopes: ScopeEntity[];
  jsxElements: JSXElementEntity[];
  imports: ImportEntity[];
  conditionalSpreads: ConditionalSpreadEntity[];
}
