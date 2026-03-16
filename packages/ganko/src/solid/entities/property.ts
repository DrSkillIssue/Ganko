/**
 * Property Entity
 *
 * Represents a class property in the program graph.
 */

import type ts from "typescript";
import type { ClassEntity } from "./class";

/**
 * Represents a class property in the SolidGraph.
 */
export interface PropertyEntity {
  id: number;
  node: ts.PropertyDeclaration;
  class: ClassEntity;
  name: string | null;
  accessibility: "public" | "private" | "protected" | undefined;
  static: boolean;
  readonly: boolean;
  /** The declaration node for JSDoc attachment (same as node for properties) */
  declarationNode: ts.Node;
}
