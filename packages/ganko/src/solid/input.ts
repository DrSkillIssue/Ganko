/**
 * SolidInput - Input type for building SolidGraph from ESLint-parsed source.
 *
 * This defines the contract for what data is needed to build a Solid.js
 * program graph. It requires ESLint's SourceCode object which contains
 * the AST, scope manager, and parser services.
 */
import type { ParserServices, TSESLint } from "@typescript-eslint/utils";
import type ts from "typescript";
import type { Logger } from "@drskillissue/ganko-shared";

/**
 * Input for building a SolidGraph from ESLint-parsed source.
 */
export interface SolidInput {
  /** Absolute path to the source file */
  readonly file: string
  /** ESLint SourceCode object containing AST and scope manager */
  readonly sourceCode: TSESLint.SourceCode
  /** TypeScript parser services for type information (null if unavailable) */
  readonly parserServices: Partial<ParserServices> | null
  /** TypeScript type checker for advanced type queries (null if unavailable) */
  readonly checker: ts.TypeChecker | null
  /** Logger for debug output (omit for silent operation) */
  readonly logger?: Logger
}
