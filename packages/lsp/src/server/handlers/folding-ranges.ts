/**
 * Folding Ranges Handler
 *
 * Provides code folding regions for functions, JSX elements, imports, etc.
 * Uses typed arrays for range storage and stack-based traversal.
 */

import type { FoldingRangeParams, FoldingRange } from "vscode-languageserver";
import { FoldingRangeKind } from "vscode-languageserver";
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { HandlerContext } from "./handler-context";
import { uriToPath } from "@ganko/shared";

/** Key for accessing comments on AST program node. */
const COMMENTS_KEY = "comments";

/** Folding kind constants. */
const KIND_REGION = FoldingRangeKind.Region;
const KIND_IMPORTS = FoldingRangeKind.Imports;
const KIND_COMMENT = FoldingRangeKind.Comment;

/** Maximum number of ranges to report. */
const MAX_RANGES = 5000;
const INITIAL_STACK_SIZE = 512;
const INITIAL_BUFFER_SIZE = 256;

/** Typed arrays for range storage. */
let startLines = new Int32Array(INITIAL_BUFFER_SIZE);
let endLines = new Int32Array(INITIAL_BUFFER_SIZE);
let kinds = new Uint8Array(INITIAL_BUFFER_SIZE);
let bufferCapacity = INITIAL_BUFFER_SIZE;

/** Current number of accumulated folding ranges in the buffer. */
let count = 0;

/** Stack for traversal (nullable to allow releasing references). */
let stack: (T.Node | null)[] = new Array(INITIAL_STACK_SIZE);
let stackCapacity = INITIAL_STACK_SIZE;

/**
 * Ensures buffer arrays have sufficient capacity.
 *
 * @param required - The minimum capacity needed
 */
function ensureBufferCapacity(required: number): void {
  if (required <= bufferCapacity) return;
  let newCapacity = bufferCapacity;
  while (newCapacity < required) newCapacity <<= 1;
  const newStart = new Int32Array(newCapacity);
  const newEnd = new Int32Array(newCapacity);
  const newKinds = new Uint8Array(newCapacity);
  newStart.set(startLines);
  newEnd.set(endLines);
  newKinds.set(kinds);
  startLines = newStart;
  endLines = newEnd;
  kinds = newKinds;
  bufferCapacity = newCapacity;
}

/**
 * Ensures stack array has sufficient capacity.
 *
 * @param required - The minimum capacity needed
 */
function ensureStackCapacity(required: number): void {
  if (required <= stackCapacity) return;
  let newCapacity = stackCapacity;
  while (newCapacity < required) newCapacity <<= 1;
  const newStack: (T.Node | null)[] = new Array<T.Node | null>(newCapacity).fill(null);
  for (let i = 0; i < stackCapacity; i++) {
    const existing = stack[i];
    if (existing !== undefined) newStack[i] = existing;
  }
  stack = newStack;
  stackCapacity = newCapacity;
}

/**
 * Append a folding range to the buffer if under the limit.
 *
 * @param sl - Start line (0-based)
 * @param el - End line (0-based)
 * @param kind - Numeric kind (0=region, 1=imports, 2=comment)
 */
function addFold(sl: number, el: number, kind: number): void {
  if (count >= MAX_RANGES) return;
  ensureBufferCapacity(count + 1);
  startLines[count] = sl;
  endLines[count] = el;
  kinds[count] = kind;
  count++;
}

/**
 * Converts numeric kind to FoldingRangeKind enum.
 *
 * @param k - Numeric kind value (0=region, 1=imports, 2=comment)
 * @returns The corresponding FoldingRangeKind enum value
 */
function kindToEnum(k: number): FoldingRangeKind {
  if (k === 1) return KIND_IMPORTS;
  if (k === 2) return KIND_COMMENT;
  return KIND_REGION;
}

/**
 * Get comments from AST if present.
 *
 * @param ast - The Program AST node
 * @returns Array of comments or null if none present
 */
function getComments(ast: T.Program): T.Comment[] | null {
  if (!(COMMENTS_KEY in ast)) return null;
  const comments = Object.getOwnPropertyDescriptor(ast, COMMENTS_KEY)?.value;
  if (!Array.isArray(comments)) return null;
  return comments;
}

/**
 * Handles textDocument/foldingRange LSP request.
 *
 * @param params - Folding range request parameters
 * @param context - Project context for accessing parsed AST
 * @returns Array of folding ranges or null if AST unavailable
 */
export function handleFoldingRanges(
  params: FoldingRangeParams,
  ctx: HandlerContext,
): FoldingRange[] | null {
  const filePath = uriToPath(params.textDocument.uri);
  const ast = ctx.getAST(filePath);
  if (!ast) return null;

  count = 0;
  let stackTop = 0;
  let importStart = -1;
  let importEnd = -1;

  const bodyLen = ast.body.length;
  ensureStackCapacity(bodyLen);
  for (let i = bodyLen - 1; i >= 0; i--) {
    const item = ast.body[i];
    if (item) stack[stackTop++] = item;
  }

  while (stackTop > 0) {
    if (count >= MAX_RANGES) break;

    const node = stack[--stackTop];
    if (!node) continue;
    const loc = node.loc;
    if (!loc) continue;

    const startLine = loc.start.line - 1;
    const endLine = loc.end.line - 1;
    const isMultiLine = endLine > startLine;

    switch (node.type) {
      case "ImportDeclaration": {
        if (importStart === -1) importStart = startLine;
        importEnd = endLine;
        if (isMultiLine) addFold(startLine, endLine, 1);
        break;
      }

      case "FunctionDeclaration":
      case "FunctionExpression": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        if (node.body) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.body;
        }
        break;
      }

      case "ArrowFunctionExpression": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
        break;
      }

      case "ClassDeclaration":
      case "ClassExpression": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
        break;
      }

      case "ClassBody": {
        const len = node.body.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const item = node.body[i];
          if (item) stack[stackTop++] = item;
        }
        break;
      }

      case "IfStatement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        ensureStackCapacity(stackTop + 2);
        stack[stackTop++] = node.consequent;
        if (node.alternate) stack[stackTop++] = node.alternate;
        break;
      }

      case "SwitchStatement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const cases = node.cases;
        let totalConsequents = 0;
        for (let i = 0; i < cases.length; i++) {
          const sc = cases[i];
          if (sc) totalConsequents += sc.consequent.length;
        }
        ensureStackCapacity(stackTop + totalConsequents);
        for (let i = cases.length - 1; i >= 0; i--) {
          const c = cases[i];
          if (!c) continue;
          const cLoc = c.loc;
          if (cLoc && cLoc.end.line > cLoc.start.line) {
            addFold(cLoc.start.line - 1, cLoc.end.line - 1, 0);
          }
          const cons = c.consequent;
          for (let j = cons.length - 1; j >= 0; j--) {
            const consItem = cons[j];
            if (consItem) stack[stackTop++] = consItem;
          }
        }
        break;
      }

      case "TryStatement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        ensureStackCapacity(stackTop + 3);
        stack[stackTop++] = node.block;
        if (node.handler) {
          const hLoc = node.handler.loc;
          if (hLoc && hLoc.end.line > hLoc.start.line) {
            addFold(hLoc.start.line - 1, hLoc.end.line - 1, 0);
          }
          stack[stackTop++] = node.handler.body;
        }
        if (node.finalizer) stack[stackTop++] = node.finalizer;
        break;
      }

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
        break;
      }

      case "BlockStatement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const len = node.body.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const item = node.body[i];
          if (item) stack[stackTop++] = item;
        }
        break;
      }

      case "JSXElement": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const len = node.children.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const item = node.children[i];
          if (item) stack[stackTop++] = item;
        }
        break;
      }

      case "JSXFragment": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const len = node.children.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const item = node.children[i];
          if (item) stack[stackTop++] = item;
        }
        break;
      }

      case "ObjectExpression": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const len = node.properties.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const item = node.properties[i];
          if (item) stack[stackTop++] = item;
        }
        break;
      }

      case "ArrayExpression": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        const elements = node.elements;
        const len = elements.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const el = elements[i];
          if (el) stack[stackTop++] = el;
        }
        break;
      }

      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
      case "TSEnumDeclaration": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        break;
      }

      case "TSModuleDeclaration": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        if (node.body) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.body;
        }
        break;
      }

      case "ExportDefaultDeclaration": {
        if (node.declaration) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.declaration;
        }
        break;
      }

      case "ExportNamedDeclaration": {
        if (node.declaration) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.declaration;
        }
        break;
      }

      case "VariableDeclaration": {
        const declarations = node.declarations;
        const len = declarations.length;
        ensureStackCapacity(stackTop + len);
        for (let i = len - 1; i >= 0; i--) {
          const decl = declarations[i];
          if (!decl) continue;
          const init = decl.init;
          if (init) stack[stackTop++] = init;
        }
        break;
      }

      case "ReturnStatement": {
        if (node.argument) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.argument;
        }
        break;
      }

      case "ExpressionStatement": {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.expression;
        break;
      }

      case "CallExpression": {
        const args = node.arguments;
        ensureStackCapacity(stackTop + args.length + 1);
        stack[stackTop++] = node.callee;
        for (let i = args.length - 1; i >= 0; i--) {
          const arg = args[i];
          if (arg) stack[stackTop++] = arg;
        }
        break;
      }

      case "Property": {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.value;
        break;
      }

      case "ConditionalExpression": {
        ensureStackCapacity(stackTop + 3);
        stack[stackTop++] = node.alternate;
        stack[stackTop++] = node.consequent;
        stack[stackTop++] = node.test;
        break;
      }

      case "MethodDefinition":
      case "PropertyDefinition": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        if (node.value) {
          ensureStackCapacity(stackTop + 1);
          stack[stackTop++] = node.value;
        }
        break;
      }

      case "TemplateLiteral": {
        if (isMultiLine) addFold(startLine, endLine, 0);
        break;
      }
    }
  }

  // Add import block fold
  if (importStart !== -1 && importEnd > importStart) {
    addFold(importStart, importEnd, 1);
  }

  // Add comment folds
  const comments = getComments(ast);
  if (comments !== null) {
    addCommentFolds(comments);
  }

  /* Release AST node references from the module-level stack so the
     last-processed file's AST can be garbage-collected between requests. */
  for (let i = 0; i < stackTop; i++) {
    stack[i] = null;
  }

  if (count === 0) return null;

  const result = new Array<FoldingRange>(count);
  for (let i = 0; i < count; i++) {
    result[i] = {
      startLine: startLines[i] ?? 0,
      endLine: endLines[i] ?? 0,
      kind: kindToEnum(kinds[i] ?? 0),
    };
  }
  return result;
}

/**
 * Adds folding ranges for comments in the AST.
 *
 * Uses module-level `count` and `addFold` to append ranges.
 *
 * @param comments - Array of comment nodes from AST
 */
function addCommentFolds(comments: T.Comment[]): void {
  let blockStart = -1;
  let blockEnd = -1;
  const len = comments.length;

  for (let i = 0; i < len; i++) {
    if (count >= MAX_RANGES) break;
    const comment = comments[i];
    if (!comment) continue;
    const loc = comment.loc;
    if (!loc) continue;

    const commentStart = loc.start.line - 1;
    const commentEnd = loc.end.line - 1;

    if (comment.type === "Block" && commentEnd > commentStart) {
      addFold(commentStart, commentEnd, 2);
    } else if (comment.type === "Line") {
      if (blockStart === -1) {
        blockStart = commentStart;
        blockEnd = commentStart;
      } else if (commentStart === blockEnd + 1) {
        blockEnd = commentStart;
      } else {
        if (blockEnd > blockStart) {
          addFold(blockStart, blockEnd, 2);
        }
        blockStart = commentStart;
        blockEnd = commentStart;
      }
    }
  }

  if (blockEnd > blockStart) {
    addFold(blockStart, blockEnd, 2);
  }
}
