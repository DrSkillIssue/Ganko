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

import ts from "typescript";
import type { FeatureHandlerContext } from "./handler-context";
import { uriToCanonicalPath, Level } from "@drskillissue/ganko-shared";
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
  ctx: FeatureHandlerContext,
): LinkedEditingRanges | null {
  const { log } = ctx;
  const filePath = uriToCanonicalPath(params.textDocument.uri);
  if (filePath === null) return null;
  const sf = ctx.getAST(filePath);
  if (!sf) return null;

  const line = params.position.line + 1;
  const col = params.position.character;
  const targetPos = packPos(line, col);

  const result = findJSXElementWithTagAtPosition(sf, targetPos);
  if (!result) return null;

  const { element, tagName } = result;

  if (!element.closingElement) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`linkedEditing: self-closing <${tagName}/> — skipped`);
    return null;
  }
  if (log.isLevelEnabled(Level.Trace)) log.trace(`linkedEditing: <${tagName}> at ${filePath}:${params.position.line}:${params.position.character}`);

  const openTagName = element.openingElement.tagName;
  const closeTagName = element.closingElement.tagName;

  const openStart = sf.getLineAndCharacterOfPosition(openTagName.getStart(sf));
  const closeStart = sf.getLineAndCharacterOfPosition(closeTagName.getStart(sf));

  const tagLen = tagName.length;

  return {
    ranges: [
      {
        start: { line: openStart.line, character: openStart.character },
        end: { line: openStart.line, character: openStart.character + tagLen },
      },
      {
        start: { line: closeStart.line, character: closeStart.character },
        end: { line: closeStart.line, character: closeStart.character + tagLen },
      },
    ],
    wordPattern: "[a-zA-Z][a-zA-Z0-9.]*",
  };
}

interface JSXMatchResult {
  element: ts.JsxElement;
  tagName: string;
  isOnClosing: boolean;
}

/**
 * Find JsxElement with tag name at the given packed position.
 *
 * @param sf - Source file to search
 * @param targetPos - Packed position (line << 16 | col)
 * @returns Match result with element and tag name, or null
 */
function findJSXElementWithTagAtPosition(
  sf: ts.SourceFile,
  targetPos: number,
): JSXMatchResult | null {
  const stack: ts.Node[] = new Array(256);
  let stackTop = 0;

  // Push source file statements in reverse for correct traversal order
  const stmts = sf.statements;
  for (let i = stmts.length - 1; i >= 0; i--) {
    const item = stmts[i];
    if (item) stack[stackTop++] = item;
  }

  while (stackTop > 0) {
    const node = stack[--stackTop];
    if (!node) continue;

    const nodeStartPos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const nodeEndPos = sf.getLineAndCharacterOfPosition(node.end);
    const nodeStart = packPos(nodeStartPos.line + 1, nodeStartPos.character);
    const nodeEnd = packPos(nodeEndPos.line + 1, nodeEndPos.character);

    // Skip nodes that don't contain target position
    if (targetPos < nodeStart || targetPos > nodeEnd) continue;

    // Check if this is a JsxElement with matching tag position
    if (ts.isJsxElement(node)) {
      const match = checkJSXElementTags(node, targetPos, sf);
      if (match) return match;
    }

    // Push children for further exploration
    stackTop = pushJSXRelevantChildren(node, stack, stackTop, sf);
  }

  return null;
}

/**
 * Check if target position is on open or close tag name of a JsxElement.
 *
 * @param element - JsxElement to check
 * @param targetPos - Packed position (line << 16 | col)
 * @param sf - Source file for position resolution
 * @returns Match result if position is on a tag name, or null
 */
function checkJSXElementTags(
  element: ts.JsxElement,
  targetPos: number,
  sf: ts.SourceFile,
): JSXMatchResult | null {
  const openingTagName = element.openingElement.tagName;
  const openStartPos = sf.getLineAndCharacterOfPosition(openingTagName.getStart(sf));
  const openEndPos = sf.getLineAndCharacterOfPosition(openingTagName.end);
  const openStart = packPos(openStartPos.line + 1, openStartPos.character);
  const openEnd = packPos(openEndPos.line + 1, openEndPos.character);

  if (targetPos >= openStart && targetPos <= openEnd) {
    return {
      element,
      tagName: extractTagName(openingTagName),
      isOnClosing: false,
    };
  }

  const closingElement = element.closingElement;
  if (closingElement) {
    const closingTagName = closingElement.tagName;
    const closeStartPos = sf.getLineAndCharacterOfPosition(closingTagName.getStart(sf));
    const closeEndPos = sf.getLineAndCharacterOfPosition(closingTagName.end);
    const closeStart = packPos(closeStartPos.line + 1, closeStartPos.character);
    const closeEnd = packPos(closeEndPos.line + 1, closeEndPos.character);

    if (targetPos >= closeStart && targetPos <= closeEnd) {
      return {
        element,
        tagName: extractTagName(openingTagName),
        isOnClosing: true,
      };
    }
  }

  return null;
}

/**
 * Extract tag name string from JSX tag name node.
 *
 * @param tagName - JSX tag name node (identifier, property access, or qualified name)
 * @returns Tag name string (e.g., "div", "Foo.Bar", "svg:path")
 */
function extractTagName(
  tagName: ts.JsxTagNameExpression,
): string {
  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    return extractPropertyAccessName(tagName);
  }
  if (ts.isJsxNamespacedName(tagName)) {
    return `${tagName.namespace.text}:${tagName.name.text}`;
  }
  // Fallback — shouldn't normally reach here
  return tagName.getText();
}

/**
 * Build full name from property access expression (JSX member expression).
 *
 * @param node - PropertyAccessExpression node
 * @returns Dot-separated name (e.g., "Foo.Bar.Baz")
 */
function extractPropertyAccessName(node: ts.PropertyAccessExpression): string {
  let result = node.name.text;
  let current: ts.Expression = node.expression;

  while (ts.isPropertyAccessExpression(current)) {
    result = current.name.text + "." + result;
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    return current.text + "." + result;
  }
  // Fallback for unusual cases
  return current.getText() + "." + result;
}

/**
 * Push children that may contain JsxElements onto traversal stack.
 *
 * @param node - Current node to get children from
 * @param stack - Traversal stack
 * @param stackTop - Current stack top index
 * @param sf - Source file for position info
 * @returns New stack top index after pushing children
 */
function pushJSXRelevantChildren(
  node: ts.Node,
  stack: ts.Node[],
  stackTop: number,
  _sf: ts.SourceFile,
): number {
  if (ts.isSourceFile(node) || ts.isBlock(node)) {
    const stmts = node.statements;
    const len = stmts.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = stmts[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const len = node.children.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = node.children[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isJsxExpression(node)) {
    if (node.expression) {
      stack[stackTop++] = node.expression;
    }
    return stackTop;
  }

  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    if (node.body) {
      stack[stackTop++] = node.body;
    }
    return stackTop;
  }

  if (ts.isReturnStatement(node)) {
    if (node.expression) {
      stack[stackTop++] = node.expression;
    }
    return stackTop;
  }

  if (ts.isVariableStatement(node)) {
    const decls = node.declarationList.declarations;
    const len = decls.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = decls[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isVariableDeclaration(node)) {
    if (node.initializer) {
      stack[stackTop++] = node.initializer;
    }
    return stackTop;
  }

  if (ts.isExpressionStatement(node)) {
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isCallExpression(node)) {
    const args = node.arguments;
    const len = args.length;
    for (let i = len - 1; i >= 0; i--) {
      const item = args[i];
      if (item) stack[stackTop++] = item;
    }
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isConditionalExpression(node)) {
    stack[stackTop++] = node.whenFalse;
    stack[stackTop++] = node.whenTrue;
    stack[stackTop++] = node.condition;
    return stackTop;
  }

  if (ts.isBinaryExpression(node)) {
    stack[stackTop++] = node.right;
    stack[stackTop++] = node.left;
    return stackTop;
  }

  if (ts.isParenthesizedExpression(node)) {
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isArrayLiteralExpression(node)) {
    const len = node.elements.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const el = node.elements[i];
      if (el) stack[stackTop++] = el;
    }
    return stackTop;
  }

  if (ts.isObjectLiteralExpression(node)) {
    const len = node.properties.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = node.properties[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isPropertyAssignment(node)) {
    stack[stackTop++] = node.initializer;
    return stackTop;
  }

  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isIfStatement(node)) {
    if (node.elseStatement) stack[stackTop++] = node.elseStatement;
    stack[stackTop++] = node.thenStatement;
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isSwitchStatement(node)) {
    const clauses = node.caseBlock.clauses;
    const len = clauses.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = clauses[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    const stmts = node.statements;
    const len = stmts.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = stmts[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    stack[stackTop++] = node.statement;
    return stackTop;
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const members = node.members;
    const len = members.length;
    if (len === 0) return stackTop;
    for (let i = len - 1; i >= 0; i--) {
      const item = members[i];
      if (item) stack[stackTop++] = item;
    }
    return stackTop;
  }

  if (ts.isTryStatement(node)) {
    if (node.finallyBlock) stack[stackTop++] = node.finallyBlock;
    if (node.catchClause) stack[stackTop++] = node.catchClause.block;
    stack[stackTop++] = node.tryBlock;
    return stackTop;
  }

  if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) {
    if (ts.isMethodDeclaration(node) && node.body) {
      stack[stackTop++] = node.body;
    }
    if (ts.isPropertyDeclaration(node) && node.initializer) {
      stack[stackTop++] = node.initializer;
    }
    return stackTop;
  }

  if (ts.isExportAssignment(node)) {
    stack[stackTop++] = node.expression;
    return stackTop;
  }

  if (ts.isExportDeclaration(node)) {
    // No relevant children for JSX search
    return stackTop;
  }

  return stackTop;
}
