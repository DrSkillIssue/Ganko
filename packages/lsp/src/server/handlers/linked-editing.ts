/**
 * Linked Editing Ranges Handler
 *
 * Provides synchronized editing of JSX open/close tag names.
 * When editing <div>, the closing </div> is automatically updated.
 */

import type {
  LinkedEditingRangeParams,
  LinkedEditingRanges,
} from "vscode-languageserver";

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { HandlerContext } from "./handler-context";
import { uriToPath } from "@ganko/shared";
import { packPos } from "./ts-utils";

/**
 * Handle linked editing range request.
 *
 * @param params - LSP linked editing range params
 * @param context - Project context for AST access
 * @returns Linked ranges for open/close tags, or null if not on a tag
 */
export function handleLinkedEditingRanges(
  params: LinkedEditingRangeParams,
  ctx: HandlerContext,
): LinkedEditingRanges | null {
  const filePath = uriToPath(params.textDocument.uri);
  const ast = ctx.getAST(filePath);
  if (!ast) return null;

  // Convert to 1-based line for AST compatibility
  const line = params.position.line + 1;
  const col = params.position.character;
  const targetPos = packPos(line, col);

  const result = findJSXElementWithTagAtPosition(ast, targetPos);
  if (!result) return null;

  const { element, tagName } = result;

  // Self-closing elements don't need linked editing
  if (!element.closingElement) return null;

  const openName = element.openingElement.name;
  const closeName = element.closingElement.name;
  const openLoc = openName.loc;
  const closeLoc = closeName.loc;

  if (!openLoc || !closeLoc) return null;

  const tagLen = tagName.length;

  return {
    ranges: [
      {
        start: { line: openLoc.start.line - 1, character: openLoc.start.column },
        end: { line: openLoc.start.line - 1, character: openLoc.start.column + tagLen },
      },
      {
        start: { line: closeLoc.start.line - 1, character: closeLoc.start.column },
        end: { line: closeLoc.start.line - 1, character: closeLoc.start.column + tagLen },
      },
    ],
    wordPattern: "[a-zA-Z][a-zA-Z0-9.]*",
  };
}

interface JSXMatchResult {
  element: T.JSXElement;
  tagName: string;
  isOnClosing: boolean;
}

/**
 * Find JSXElement with tag name at the given packed position.
 *
 * @param ast - Program AST to search
 * @param targetPos - Packed position (line << 16 | col)
 * @returns Match result with element and tag name, or null
 */
function findJSXElementWithTagAtPosition(
  ast: T.Program,
  targetPos: number,
): JSXMatchResult | null {
  const stack: T.Node[] = new Array(256);
  let stackTop = 0;

  // Push program body in reverse for correct traversal order
  const body = ast.body;
  for (let i = body.length - 1; i >= 0; i--) {
    const item = body[i];
    if (item) stack[stackTop++] = item;
  }

  while (stackTop > 0) {
    const node = stack[--stackTop];
    if (!node) continue;
    const loc = node.loc;
    if (!loc) continue;

    const nodeStart = packPos(loc.start.line, loc.start.column);
    const nodeEnd = packPos(loc.end.line, loc.end.column);

    // Skip nodes that don't contain target position
    if (targetPos < nodeStart || targetPos > nodeEnd) continue;

    // Check if this is a JSXElement with matching tag position
    if (node.type === "JSXElement") {
      const match = checkJSXElementTags(node, targetPos);
      if (match) return match;
    }

    // Push children for further exploration
    stackTop = pushJSXRelevantChildren(node, stack, stackTop);
  }

  return null;
}

/**
 * Check if target position is on open or close tag name of a JSXElement.
 *
 * @param element - JSXElement to check
 * @param targetPos - Packed position (line << 16 | col)
 * @returns Match result if position is on a tag name, or null
 */
function checkJSXElementTags(
  element: T.JSXElement,
  targetPos: number,
): JSXMatchResult | null {
  const openingName = element.openingElement.name;
  const openLoc = openingName.loc;

  if (openLoc) {
    const openStart = packPos(openLoc.start.line, openLoc.start.column);
    const openEnd = packPos(openLoc.end.line, openLoc.end.column);

    if (targetPos >= openStart && targetPos <= openEnd) {
      return {
        element,
        tagName: extractTagName(openingName),
        isOnClosing: false,
      };
    }
  }

  const closingElement = element.closingElement;
  if (closingElement) {
    const closingName = closingElement.name;
    const closeLoc = closingName.loc;

    if (closeLoc) {
      const closeStart = packPos(closeLoc.start.line, closeLoc.start.column);
      const closeEnd = packPos(closeLoc.end.line, closeLoc.end.column);

      if (targetPos >= closeStart && targetPos <= closeEnd) {
        return {
          element,
          tagName: extractTagName(openingName),
          isOnClosing: true,
        };
      }
    }
  }

  return null;
}

/**
 * Extract tag name string from JSX name node.
 *
 * @param name - JSX name node (identifier, member expr, or namespaced)
 * @returns Tag name string (e.g., "div", "Foo.Bar", "svg:path")
 */
function extractTagName(
  name: T.JSXIdentifier | T.JSXMemberExpression | T.JSXNamespacedName,
): string {
  if (name.type === "JSXIdentifier") {
    return name.name;
  }
  if (name.type === "JSXNamespacedName") {
    return `${name.namespace.name}:${name.name.name}`;
  }
  // JSXMemberExpression
  return extractMemberExpressionName(name);
}

/**
 * Build full name from JSXMemberExpression.
 *
 * @param node - JSXMemberExpression node
 * @returns Dot-separated name (e.g., "Foo.Bar.Baz")
 */
function extractMemberExpressionName(node: T.JSXMemberExpression): string {
  let result = node.property.name;
  let current: T.JSXMemberExpression | T.JSXIdentifier | T.JSXNamespacedName = node.object;

  while (current.type === "JSXMemberExpression") {
    result = current.property.name + "." + result;
    current = current.object;
  }

  if (current.type === "JSXIdentifier") {
    return current.name + "." + result;
  }
  // JSXNamespacedName
  return current.namespace.name + ":" + current.name.name + "." + result;
}

/**
 * Push children that may contain JSXElements onto traversal stack.
 *
 * @param node - Current node to get children from
 * @param stack - Traversal stack
 * @param stackTop - Current stack top index
 * @returns New stack top index after pushing children
 */
function pushJSXRelevantChildren(
  node: T.Node,
  stack: T.Node[],
  stackTop: number,
): number {
  switch (node.type) {
    case "Program":
    case "BlockStatement": {
      const len = node.body.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.body[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "JSXElement":
    case "JSXFragment": {
      const len = node.children.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.children[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "JSXExpressionContainer":
      if (node.expression.type !== "JSXEmptyExpression") {
        stack[stackTop++] = node.expression;
      }
      return stackTop;

    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      if (node.body) {
        stack[stackTop++] = node.body;
      }
      return stackTop;

    case "ReturnStatement":
      if (node.argument) {
        stack[stackTop++] = node.argument;
      }
      return stackTop;

    case "VariableDeclaration": {
      const len = node.declarations.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.declarations[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "VariableDeclarator":
      if (node.init) {
        stack[stackTop++] = node.init;
      }
      return stackTop;

    case "ExpressionStatement":
      stack[stackTop++] = node.expression;
      return stackTop;

    case "CallExpression": {
      const len = node.arguments.length;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.arguments[i];
        if (item) stack[stackTop++] = item;
      }
      stack[stackTop++] = node.callee;
      return stackTop;
    }

    case "ConditionalExpression":
      stack[stackTop++] = node.alternate;
      stack[stackTop++] = node.consequent;
      stack[stackTop++] = node.test;
      return stackTop;

    case "LogicalExpression":
    case "BinaryExpression":
      stack[stackTop++] = node.right;
      stack[stackTop++] = node.left;
      return stackTop;

    case "SequenceExpression": {
      const len = node.expressions.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.expressions[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "ArrayExpression": {
      const len = node.elements.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const el = node.elements[i];
        if (el) stack[stackTop++] = el;
      }
      return stackTop;
    }

    case "ObjectExpression": {
      const len = node.properties.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.properties[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "Property":
      stack[stackTop++] = node.value;
      return stackTop;

    case "SpreadElement":
      stack[stackTop++] = node.argument;
      return stackTop;

    case "IfStatement":
      if (node.alternate) stack[stackTop++] = node.alternate;
      stack[stackTop++] = node.consequent;
      stack[stackTop++] = node.test;
      return stackTop;

    case "SwitchStatement": {
      const len = node.cases.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.cases[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "SwitchCase": {
      const len = node.consequent.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.consequent[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ClassDeclaration":
    case "ClassExpression":
      stack[stackTop++] = node.body;
      return stackTop;

    case "TryStatement":
      if (node.finalizer) stack[stackTop++] = node.finalizer;
      if (node.handler) stack[stackTop++] = node.handler.body;
      stack[stackTop++] = node.block;
      return stackTop;

    case "ClassBody": {
      const len = node.body.length;
      if (len === 0) return stackTop;
      for (let i = len - 1; i >= 0; i--) {
        const item = node.body[i];
        if (item) stack[stackTop++] = item;
      }
      return stackTop;
    }

    case "MethodDefinition":
    case "PropertyDefinition":
      if (node.value) stack[stackTop++] = node.value;
      return stackTop;

    case "ExportDefaultDeclaration":
      stack[stackTop++] = node.declaration;
      return stackTop;

    case "ExportNamedDeclaration":
      if (node.declaration) stack[stackTop++] = node.declaration;
      return stackTop;

    default:
      return stackTop;
  }
}
