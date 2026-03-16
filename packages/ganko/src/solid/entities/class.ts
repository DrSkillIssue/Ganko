/**
 * Class Entity
 *
 * Represents a class in the program graph.
 */

import type ts from "typescript";
import type { FileEntity } from "./file";
import type { FunctionEntity } from "./function";
import type { PropertyEntity } from "./property";
import type { VariableEntity } from "./variable";

export type ClassNode = ts.ClassDeclaration | ts.ClassExpression;

/**
 * Represents a class in the SolidGraph.
 */
export interface ClassEntity {
  id: number;
  node: ClassNode;
  file: FileEntity;
  name: string | null;
  methods: FunctionEntity[];
  properties: PropertyEntity[];
  constructor: FunctionEntity | null;
  abstract: boolean;
  /** The declaration node for JSDoc attachment (export wrapper or self) */
  declarationNode: ts.Node;
  /** @internal Variable entity if this class is assigned to a variable */
  _variable: VariableEntity | null;
}

export interface CreateClassArgs {
  id: number;
  node: ClassNode;
  file: FileEntity;
  name: string | null;
  abstract: boolean;
  declarationNode: ts.Node;
  classVariable: VariableEntity | null;
}

/**
 * Creates a ClassEntity from the provided arguments.
 */
export function createClass(args: CreateClassArgs): ClassEntity {
  return {
    id: args.id,
    node: args.node,
    file: args.file,
    name: args.name,
    methods: [],
    properties: [],
    constructor: null,
    abstract: args.abstract,
    declarationNode: args.declarationNode,
    _variable: args.classVariable,
  };
}
