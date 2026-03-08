/**
 * Property Entity
 *
 * Represents a class property in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { ClassEntity } from "./class";

/**
 * Represents a class property in the SolidGraph.
 */
export interface PropertyEntity {
  id: number;
  node: T.PropertyDefinition;
  class: ClassEntity;
  name: string | null;
  accessibility: "public" | "private" | "protected" | undefined;
  static: boolean;
  readonly: boolean;
  /** The declaration node for JSDoc attachment (same as node for properties) */
  declarationNode: T.Node;
}
