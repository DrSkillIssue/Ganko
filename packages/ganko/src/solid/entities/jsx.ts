/**
 * JSX Entity
 *
 * Represents JSX elements in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FileEntity } from "./file";
import type { ScopeEntity } from "./scope";
import type { JSXAttributeKind } from "../util/jsx";

/**
 * Represents a JSX element or fragment in the SolidGraph.
 */
export interface JSXElementEntity {
  id: number;
  node: T.JSXElement | T.JSXFragment;
  file: FileEntity;
  tag: string | null;
  tagName: string | null;
  isDomElement: boolean;
  attributes: JSXAttributeEntity[];
  children: JSXChildEntity[];
  scope: ScopeEntity;
  parent: JSXElementEntity | null;
  childElements: JSXElementEntity[];
}

/**
 * Represents a property extracted from a spread attribute.
 *
 * Only populated for literal spreads like `{...{ a: 1, b: 2 }}`.
 */
export interface SpreadProp {
  name: string;
  keyNode: T.Node;
  valueNode: T.Node | null;
}

/**
 * Describes the complexity of a style object.
 */
export interface StyleComplexityInfo {
  conditionalCount: number;
  hasConditionalSpread: boolean;
}

/**
 * Information about spread attributes in JSX.
 */
export interface SpreadInfo {
  hasCallExpression: boolean;
  callExpressionNode: T.CallExpression | null;
  hasMemberExpression: boolean;
  memberExpressionNode: T.MemberExpression | null;
  isConditionalSpread: boolean;
  conditionalSpreadType: "ternary" | "logical-and" | null;
}

/**
 * Represents a JSX attribute on an element.
 */
export interface JSXAttributeEntity {
  id: number;
  node: T.JSXAttribute | T.JSXSpreadAttribute;
  name: string | null;
  kind: JSXAttributeKind;
  namespace: string | null;
  spreadProps: SpreadProp[];
  valueNode: T.Node | null;
  styleComplexity: StyleComplexityInfo | null;
  spreadInfo: SpreadInfo | null;
}

/**
 * Represents a child node of a JSX element (text, expression, or element).
 */
export interface JSXChildEntity {
  id: number;
  node: T.Node;
  kind: "element" | "expression" | "text";
}

/**
 * Describes the context and location of a node within JSX.
 *
 * Used to determine if a node is inside JSX and where (attribute, child, expression, etc.).
 */
export interface JSXContext {
  element: JSXElementEntity;
  attribute: JSXAttributeEntity | null;
  kind: "expression" | "attribute" | "child";
  containerNode: T.JSXExpressionContainer | null;
}

export interface CreateJSXElementArgs {
  id: number;
  node: T.JSXElement | T.JSXFragment;
  file: FileEntity;
  tag: string | null;
  isDomElement: boolean;
  attributes: JSXAttributeEntity[];
  children: JSXChildEntity[];
  scope: ScopeEntity;
}

/**
 * Creates a JSXElementEntity from the provided arguments.
 */
export function createJSXElement(args: CreateJSXElementArgs): JSXElementEntity {
  const tagName = args.tag === null ? null : args.tag.toLowerCase();

  return {
    id: args.id,
    node: args.node,
    file: args.file,
    tag: args.tag,
    tagName,
    isDomElement: args.isDomElement,
    attributes: args.attributes,
    children: args.children,
    scope: args.scope,
    parent: null,
    childElements: [],
  };
}
