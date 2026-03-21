/**
 * Folding Ranges Handler
 *
 * Provides code folding regions for functions, JSX elements, imports, etc.
 * Uses typed arrays for range storage and stack-based traversal.
 */

import type { FoldingRangeParams, FoldingRange } from "vscode-languageserver";
import { FoldingRangeKind } from "vscode-languageserver";
import ts from "typescript";
import type { FeatureHandlerContext } from "./handler-context";
import { uriToPath, Level } from "@drskillissue/ganko-shared";

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
let stack: (ts.Node | null)[] = new Array(INITIAL_STACK_SIZE);
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
  const newStack: (ts.Node | null)[] = new Array<ts.Node | null>(newCapacity).fill(null);
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
 * Get start and end lines (0-based) for a node.
 *
 * @param node - TypeScript AST node
 * @param sf - Source file for position resolution
 * @returns [startLine, endLine] tuple (0-based)
 */
function getNodeLines(node: ts.Node, sf: ts.SourceFile): [number, number] {
  const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const endLine = sf.getLineAndCharacterOfPosition(node.end).line;
  return [startLine, endLine];
}

/** Cached source file reference for the current request. */

/**
 * Handles textDocument/foldingRange LSP request.
 *
 * @param params - Folding range request parameters
 * @param context - Project context for accessing parsed AST
 * @returns Array of folding ranges or null if AST unavailable
 */
export function handleFoldingRanges(
  params: FoldingRangeParams,
  ctx: FeatureHandlerContext,
): FoldingRange[] | null {
  const filePath = uriToPath(params.textDocument.uri);
  const sf = ctx.getAST(filePath);
  if (!sf) return null;
  const { log } = ctx;


  count = 0;
  let stackTop = 0;
  let importStart = -1;
  let importEnd = -1;

  const stmts = sf.statements;
  const bodyLen = stmts.length;
  ensureStackCapacity(bodyLen);
  for (let i = bodyLen - 1; i >= 0; i--) {
    const item = stmts[i];
    if (item) stack[stackTop++] = item;
  }

  while (stackTop > 0) {
    if (count >= MAX_RANGES) break;

    const node = stack[--stackTop];
    if (!node) continue;

    const [startLine, endLine] = getNodeLines(node, sf);
    const isMultiLine = endLine > startLine;

    if (ts.isImportDeclaration(node)) {
      if (importStart === -1) importStart = startLine;
      importEnd = endLine;
      if (isMultiLine) addFold(startLine, endLine, 1);
    } else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      if (node.body) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
      }
    } else if (ts.isArrowFunction(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      ensureStackCapacity(stackTop + 1);
      stack[stackTop++] = node.body;
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      // Push class members
      const members = node.members;
      const len = members.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const item = members[i];
        if (item) stack[stackTop++] = item;
      }
    } else if (ts.isIfStatement(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      ensureStackCapacity(stackTop + 2);
      stack[stackTop++] = node.thenStatement;
      if (node.elseStatement) stack[stackTop++] = node.elseStatement;
    } else if (ts.isSwitchStatement(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const clauses = node.caseBlock.clauses;
      let totalStatements = 0;
      for (let i = 0; i < clauses.length; i++) {
        const sc = clauses[i];
        if (sc) totalStatements += sc.statements.length;
      }
      ensureStackCapacity(stackTop + totalStatements);
      for (let i = clauses.length - 1; i >= 0; i--) {
        const c = clauses[i];
        if (!c) continue;
        const [cStartLine, cEndLine] = getNodeLines(c, sf);
        if (cEndLine > cStartLine) {
          addFold(cStartLine, cEndLine, 0);
        }
        const stmts = c.statements;
        for (let j = stmts.length - 1; j >= 0; j--) {
          const stmtItem = stmts[j];
          if (stmtItem) stack[stackTop++] = stmtItem;
        }
      }
    } else if (ts.isTryStatement(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      ensureStackCapacity(stackTop + 3);
      stack[stackTop++] = node.tryBlock;
      if (node.catchClause) {
        const [hStartLine, hEndLine] = getNodeLines(node.catchClause, sf);
        if (hEndLine > hStartLine) {
          addFold(hStartLine, hEndLine, 0);
        }
        stack[stackTop++] = node.catchClause.block;
      }
      if (node.finallyBlock) stack[stackTop++] = node.finallyBlock;
    } else if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      ensureStackCapacity(stackTop + 1);
      stack[stackTop++] = node.statement;
    } else if (ts.isBlock(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const len = node.statements.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const item = node.statements[i];
        if (item) stack[stackTop++] = item;
      }
    } else if (ts.isJsxElement(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const len = node.children.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const item = node.children[i];
        if (item) stack[stackTop++] = item;
      }
    } else if (ts.isJsxFragment(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const len = node.children.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const item = node.children[i];
        if (item) stack[stackTop++] = item;
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const len = node.properties.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const item = node.properties[i];
        if (item) stack[stackTop++] = item;
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      const elements = node.elements;
      const len = elements.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const el = elements[i];
        if (el) stack[stackTop++] = el;
      }
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
    } else if (ts.isModuleDeclaration(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      if (node.body) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
      }
    } else if (ts.isExportAssignment(node)) {
      if (node.expression) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.expression;
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        // Named export with specifier — no children to recurse
      }
    } else if (ts.isVariableStatement(node)) {
      const declarations = node.declarationList.declarations;
      const len = declarations.length;
      ensureStackCapacity(stackTop + len);
      for (let i = len - 1; i >= 0; i--) {
        const decl = declarations[i];
        if (!decl) continue;
        const init = decl.initializer;
        if (init) stack[stackTop++] = init;
      }
    } else if (ts.isReturnStatement(node)) {
      if (node.expression) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.expression;
      }
    } else if (ts.isExpressionStatement(node)) {
      ensureStackCapacity(stackTop + 1);
      stack[stackTop++] = node.expression;
    } else if (ts.isCallExpression(node)) {
      const args = node.arguments;
      ensureStackCapacity(stackTop + args.length + 1);
      stack[stackTop++] = node.expression;
      for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (arg) stack[stackTop++] = arg;
      }
    } else if (ts.isPropertyAssignment(node)) {
      ensureStackCapacity(stackTop + 1);
      stack[stackTop++] = node.initializer;
    } else if (ts.isConditionalExpression(node)) {
      ensureStackCapacity(stackTop + 3);
      stack[stackTop++] = node.whenFalse;
      stack[stackTop++] = node.whenTrue;
      stack[stackTop++] = node.condition;
    } else if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
      if (ts.isMethodDeclaration(node) && node.body) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.body;
      }
      if (ts.isPropertyDeclaration(node) && node.initializer) {
        ensureStackCapacity(stackTop + 1);
        stack[stackTop++] = node.initializer;
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (isMultiLine) addFold(startLine, endLine, 0);
    }
  }

  // Add import block fold
  if (importStart !== -1 && importEnd > importStart) {
    addFold(importStart, importEnd, 1);
  }

  // Add comment folds
  addCommentFolds(sf);

  /* Release AST node references from the module-level stack so the
     last-processed file's AST can be garbage-collected between requests. */
  for (let i = 0; i < stackTop; i++) {
    stack[i] = null;
  }


  if (count === 0) return null;

  if (log.isLevelEnabled(Level.Trace)) log.trace(`foldingRanges: ${count} ranges for ${filePath}${count >= MAX_RANGES ? " (limit reached)" : ""}`);
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
 * Adds folding ranges for comments in the source file.
 *
 * Uses the TypeScript scanner to find all comments in the source text,
 * then creates folding ranges for multi-line block comments and
 * consecutive single-line comment groups.
 *
 * @param sf - Source file to scan for comments
 */
function addCommentFolds(sf: ts.SourceFile): void {
  const text = sf.text;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    sf.languageVariant,
    text,
  );

  let blockStart = -1;
  let blockEnd = -1;

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (count >= MAX_RANGES) break;

    if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const commentStart = sf.getLineAndCharacterOfPosition(scanner.getTokenStart()).line;
      const commentEnd = sf.getLineAndCharacterOfPosition(scanner.getTokenEnd()).line;
      // Flush any pending single-line block before this block comment
      if (blockEnd > blockStart) {
        addFold(blockStart, blockEnd, 2);
        blockStart = -1;
        blockEnd = -1;
      }
      if (commentEnd > commentStart) {
        addFold(commentStart, commentEnd, 2);
      }
    } else if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
      const commentStart = sf.getLineAndCharacterOfPosition(scanner.getTokenStart()).line;
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
    } else {
      // Non-comment token: flush any pending single-line block if not adjacent
      // (we continue accumulating through whitespace — adjacency checked via line number)
    }

    token = scanner.scan();
  }

  if (blockEnd > blockStart) {
    addFold(blockStart, blockEnd, 2);
  }
}
