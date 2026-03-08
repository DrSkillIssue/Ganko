/**
 * Function Entity
 *
 * Represents a function in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FileEntity } from "./file";
import type { ScopeEntity } from "./scope";
import type { VariableEntity } from "./variable";
import type { CallEntity } from "./call";
import type { ReturnStatementEntity } from "./return-statement";
import type { FunctionNode } from "../util/function";

export type { FunctionNode };

/**
 * Represents a function in the SolidGraph.
 */
export interface FunctionEntity {
  id: number;
  node: FunctionNode;
  file: FileEntity;
  name: string | null;
  variableName: string | null;
  params: ParameterEntity[];
  body: T.BlockStatement | T.Expression;
  async: boolean;
  generator: boolean;
  scope: ScopeEntity;
  captures: VariableEntity[];
  callSites: CallEntity[];
  /** True if body contains at least one return with an argument */
  hasNonVoidReturn: boolean;
  /** True if body contains at least one throw statement */
  hasThrowStatement: boolean;
  /** Character ranges of AwaitExpression nodes directly in this function (not nested functions) */
  awaitRanges: [number, number][];
  /** True if body contains at least one return with JSX */
  hasJSXReturn: boolean;
  /** The declaration node for JSDoc attachment (export wrapper, variable decl, or self) */
  declarationNode: T.Node;
  /** All return statements in this function */
  returnStatements: ReturnStatementEntity[];
  /** @internal Cached reactive captures for iteration */
  _cachedReactiveCaptures: VariableEntity[] | null;
  /** Variable entity if this function is assigned to a variable */
  variable: VariableEntity | null;
  /** @internal Reachability flags (bitmask) */
  _reachability: number;
  /** @internal Cached member accesses indexed by object identifier name */
  _memberAccessesByIdentifier: Map<string, T.MemberExpression[]> | null;
}

/**
 * Represents a function parameter.
 */
export interface ParameterEntity {
  id: number;
  node: T.Parameter;
  name: string | null;
  index: number;
}

export interface CreateFunctionArgs {
  id: number;
  node: FunctionNode;
  file: FileEntity;
  name: string | null;
  variableName: string | null;
  params: ParameterEntity[];
  captures: VariableEntity[];
  scope: ScopeEntity;
  fnVariable: VariableEntity | null;
  declarationNode: T.Node;
  hasNonVoidReturn: boolean;
  hasJSXReturn: boolean;
}

/**
 * Creates a FunctionEntity from the provided arguments.
 */
export function createFunction(args: CreateFunctionArgs): FunctionEntity {
  return {
    id: args.id,
    node: args.node,
    file: args.file,
    name: args.name,
    variableName: args.variableName,
    params: args.params,
    body: args.node.body,
    async: args.node.async,
    generator: args.node.generator ?? false,
    scope: args.scope,
    captures: args.captures,
    callSites: [],
    hasNonVoidReturn: args.hasNonVoidReturn,
    hasThrowStatement: false,
    awaitRanges: [],
    hasJSXReturn: args.hasJSXReturn,
    declarationNode: args.declarationNode,
    returnStatements: [],
    _cachedReactiveCaptures: null,
    variable: args.fnVariable,
    _reachability: 0,
    _memberAccessesByIdentifier: null,
  };
}
