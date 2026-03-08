/**
 * Variable Entity
 *
 * Represents a variable binding in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FileEntity } from "./file";
import type { ScopeEntity } from "./scope";
import type { TypeInfo } from "../typescript";

/**
 * Represents a variable binding in the SolidGraph.
 */
export interface VariableEntity {
  id: number;
  name: string;
  file: FileEntity;
  scope: ScopeEntity;
  declarations: T.Node[];
  assignments: AssignmentEntity[];
  reads: ReadEntity[];
  type: TypeInfo | null;
  isReactive: boolean;
  reactiveKind: ReactiveKind | null;
  isSignalLike: boolean;
  isMemoVariable: boolean;
  hasPropertyAssignment: boolean;
}

/**
 * Describes the kind of reactive variable.
 *
 * Different kinds have different behaviors and tracking rules.
 */
export type ReactiveKind =
  | "signal" /* Created via createSignal() */
  | "store" /* Created via createStore() */
  | "props" /* First parameter of a component function */
  | "memo" /* Created via createMemo() */
  | "derived" /* Derived reactive value */
  | "accessor" /* An accessor function */
  | "resource"; /* Created via createResource() */

/** Assignment operator type extracted from AssignmentExpression */
export type AssignmentOperator = T.AssignmentExpression["operator"];

/**
 * Represents an assignment to a variable.
 */
export interface AssignmentEntity {
  id: number;
  node: T.Node;
  /** The assigned value expression */
  value: T.Expression;
  /** The assignment operator ("=" for simple, "+=" etc for compound) */
  operator: AssignmentOperator | null;
  /** Whether this assignment is inside a loop */
  isInLoop: boolean;
  /** Whether this assignment is inside a conditional (if, switch, ternary, logical) */
  isInConditional: boolean;
}

/**
 * Represents a location where a variable is read/accessed.
 */
export interface ReadEntity {
  id: number;
  node: T.Node;
  scope: ScopeEntity;
  isProperAccess: boolean;
  /** Whether this read is inside a loop */
  isInLoop: boolean;
  /** Whether this read is inside a conditional (if, switch, ternary, logical) */
  isInConditional: boolean;
}

export interface CreateVariableArgs {
  id: number;
  name: string;
  file: FileEntity;
  scope: ScopeEntity;
  declarations: T.Node[];
}

/**
 * Creates a VariableEntity from the provided arguments.
 */
export function createVariable(args: CreateVariableArgs): VariableEntity {
  return {
    id: args.id,
    name: args.name,
    file: args.file,
    scope: args.scope,
    declarations: args.declarations,
    assignments: [],
    reads: [],
    type: null,
    isReactive: false,
    reactiveKind: null,
    isSignalLike: false,
    isMemoVariable: false,
    hasPropertyAssignment: false,
  };
}

/**
 * Sets reactivity properties on a variable entity.
 */
export function setVariableReactivity(
  variable: VariableEntity,
  isReactive: boolean,
  reactiveKind: ReactiveKind | null,
  isSignalLike: boolean,
  type?: TypeInfo | null,
): void {
  variable.isReactive = isReactive;
  variable.reactiveKind = reactiveKind;
  variable.isSignalLike = isSignalLike;
  if (type !== undefined) {
    variable.type = type;
  }
}
