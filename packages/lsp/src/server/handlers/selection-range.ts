/**
 * Selection Range Handler
 *
 * Provides smart selection expansion - progressively select larger syntactic units.
 * Uses iterative stack-based traversal and typed arrays for range storage.
 */

import type {
  SelectionRangeParams,
  SelectionRange,
  Position,
} from "vscode-languageserver";
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { HandlerContext } from "./handler-context";
import { uriToPath } from "@ganko/shared";
import { packPos } from "./ts-utils";

const INITIAL_STACK_SIZE = 128;
const INITIAL_ANCESTORS = 64;
const MAX_RANGES = 128;

/** Stack for traversal (dynamically grown). */
let stackNodes: (T.Node | null)[] = new Array(INITIAL_STACK_SIZE);
let stackChildIdx = new Int32Array(INITIAL_STACK_SIZE);
let stackCapacity = INITIAL_STACK_SIZE;

/** Buffer for ancestor chain (dynamically grown). */
let ancestorBuffer: (T.Node | null)[] = new Array(INITIAL_ANCESTORS);
let ancestorCapacity = INITIAL_ANCESTORS;

/** Typed arrays for range storage. */
const rangeStartLine = new Int32Array(MAX_RANGES);
const rangeStartChar = new Int32Array(MAX_RANGES);
const rangeEndLine = new Int32Array(MAX_RANGES);
const rangeEndChar = new Int32Array(MAX_RANGES);

/** Hash keys for deduplication. */
const seenStartKey = new Uint32Array(MAX_RANGES);
const seenEndKey = new Uint32Array(MAX_RANGES);

/** Current counts. */
let stackTop = 0;
let ancestorCount = 0;
let rangeCount = 0;
let seenCount = 0;

// Populate arrays with null values
for (let i = 0; i < INITIAL_STACK_SIZE; i++) {
  stackNodes[i] = null;
}
for (let i = 0; i < INITIAL_ANCESTORS; i++) {
  ancestorBuffer[i] = null;
}

/**
 * Ensures stack has sufficient capacity, doubling until it fits.
 *
 * @param required - Minimum capacity needed
 */
function ensureStackCapacity(required: number): void {
  if (required <= stackCapacity) return;
  let newCapacity = stackCapacity;
  while (newCapacity < required) newCapacity <<= 1;
  const newNodes = new Array<T.Node | null>(newCapacity).fill(null);
  const newChildIdx = new Int32Array(newCapacity);
  for (let i = 0; i < stackCapacity; i++) {
    const existing = stackNodes[i];
    if (existing !== undefined) newNodes[i] = existing;
    newChildIdx[i] = stackChildIdx[i] ?? 0;
  }
  stackNodes = newNodes;
  stackChildIdx = newChildIdx;
  stackCapacity = newCapacity;
}

/**
 * Ensures ancestor buffer has sufficient capacity, doubling until it fits.
 *
 * @param required - Minimum capacity needed
 */
function ensureAncestorCapacity(required: number): void {
  if (required <= ancestorCapacity) return;
  let newCapacity = ancestorCapacity;
  while (newCapacity < required) newCapacity <<= 1;
  const newBuffer: (T.Node | null)[] = new Array<T.Node | null>(newCapacity).fill(null);
  for (let i = 0; i < ancestorCapacity; i++) {
    const existing = ancestorBuffer[i];
    if (existing !== undefined) newBuffer[i] = existing;
  }
  ancestorBuffer = newBuffer;
  ancestorCapacity = newCapacity;
}

/**
 * Release AST node references held in module-level arrays.
 *
 * Prevents the last-processed file's AST from being retained
 * across requests in a long-running LSP session.
 */
function releaseNodeReferences(): void {
  for (let i = 0; i < stackTop; i++) stackNodes[i] = null;
  for (let i = 0; i < ancestorCount; i++) ancestorBuffer[i] = null;
  stackTop = 0;
  ancestorCount = 0;
}

/**
 * Packs line and column into 32-bit key for hash lookup.
 *
 * @param line - Line number
 * @param col - Column number
 * @returns Packed 32-bit hash key
 */
function packKey(line: number, col: number): number {
  return ((line & 0xFFFF) << 16) | (col & 0xFFFF);
}

/**
 * Checks if range already seen and adds if unique.
 *
 * @param sl - Start line
 * @param sc - Start column
 * @param el - End line
 * @param ec - End column
 * @returns True if range was added
 */
function addRangeIfUnique(sl: number, sc: number, el: number, ec: number): boolean {
  if (rangeCount >= MAX_RANGES) return false;

  const startKey = packKey(sl, sc);
  const endKey = packKey(el, ec);

  for (let i = 0; i < seenCount; i++) {
    if (seenStartKey[i] === startKey && seenEndKey[i] === endKey) {
      return false;
    }
  }

  seenStartKey[seenCount] = startKey;
  seenEndKey[seenCount] = endKey;
  seenCount++;

  rangeStartLine[rangeCount] = sl;
  rangeStartChar[rangeCount] = sc;
  rangeEndLine[rangeCount] = el;
  rangeEndChar[rangeCount] = ec;
  rangeCount++;

  return true;
}

/**
 * Adds range from source location to buffer.
 *
 * @param loc - Source location with start/end positions
 */
function addLocRange(loc: { start: { line: number; column: number }; end: { line: number; column: number } }): void {
  addRangeIfUnique(
    loc.start.line - 1,
    loc.start.column,
    loc.end.line - 1,
    loc.end.column,
  );
}

/**
 * Handles textDocument/selectionRange LSP request.
 *
 * @param params - Selection range request parameters
 * @param context - Project context for AST access
 * @returns Array of selection ranges or null
 */
export function handleSelectionRange(
  params: SelectionRangeParams,
  ctx: HandlerContext,
): SelectionRange[] | null {
  const filePath = uriToPath(params.textDocument.uri);
  const ast = ctx.getAST(filePath);
  if (!ast) return null;

  const positions = params.positions;
  const posLen = positions.length;
  const results: SelectionRange[] = new Array(posLen);

  for (let p = 0; p < posLen; p++) {
    const position = positions[p];
    if (!position) continue;
    const targetPos = packPos(position.line + 1, position.character);

    // Reset state for each position
    ancestorCount = 0;
    rangeCount = 0;
    seenCount = 0;

    findAncestorChain(ast, targetPos);

    if (ancestorCount === 0) {
      results[p] = {
        range: {
          start: { line: position.line, character: position.character },
          end: { line: position.line, character: position.character },
        },
      };
      continue;
    }

    buildRanges();
    results[p] = buildLinkedRanges(position);
  }

  releaseNodeReferences();
  return results;
}

/**
 * Checks if child node contains target position and pushes to stack if so.
 *
 * @param child - Child node to check
 * @param targetPos - Packed target position
 * @returns True if child was pushed to stack
 */
function tryPushChild(child: T.Node, targetPos: number): boolean {
  const loc = child.loc;
  if (!loc) return false;

  const childStart = packPos(loc.start.line, loc.start.column);
  const childEnd = packPos(loc.end.line, loc.end.column);

  if (targetPos < childStart || targetPos > childEnd) return false;

  ensureStackCapacity(stackTop + 1);
  stackNodes[stackTop] = child;
  stackChildIdx[stackTop] = 0;
  stackTop++;
  return true;
}

/**
 * Iterates array children starting from startIdx.
 *
 * @param arr - Array of child nodes
 * @param startIdx - Starting index in array
 * @param targetPos - Packed target position
 * @param idx - Stack index
 * @returns True if child containing position was pushed
 */
function tryArrayChildren(
  arr: readonly (T.Node | null | undefined)[],
  startIdx: number,
  targetPos: number,
  idx: number,
): boolean {
  const len = arr.length;
  if (startIdx >= len) return false;
  for (let i = startIdx; i < len; i++) {
    const el = arr[i];
    if (el) {
      stackChildIdx[idx] = i + 1;
      if (tryPushChild(el, targetPos)) return true;
    }
  }
  return false;
}

/**
 * Iterates node children using switch-based dispatch.
 *
 * @param node - AST node to iterate
 * @param childIdx - Current child index
 * @param targetPos - Packed target position
 * @param idx - Stack index
 * @returns True if child containing position was pushed
 */
function iterateNodeChildren(
  node: T.Node,
  childIdx: number,
  targetPos: number,
  idx: number,
): boolean {
  switch (node.type) {
    case "Program":
    case "BlockStatement":
      return tryArrayChildren(node.body, childIdx, targetPos, idx);

    case "SequenceExpression":
      return tryArrayChildren(node.expressions, childIdx, targetPos, idx);

    case "TemplateLiteral":
      return tryArrayChildren(node.expressions, childIdx, targetPos, idx);

    case "ClassBody":
      return tryArrayChildren(node.body, childIdx, targetPos, idx);

    case "JSXFragment":
      return tryArrayChildren(node.children, childIdx, targetPos, idx);

    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.left, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.right, targetPos);

    case "MemberExpression":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.object, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.property, targetPos);

    case "ConditionalExpression":
      if (childIdx > 2) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.test, targetPos)) return true;
      }
      if (childIdx <= 1) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.consequent, targetPos)) return true;
      }
      stackChildIdx[idx] = 3;
      return tryPushChild(node.alternate, targetPos);

    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const params = node.params;
      const paramLen = params.length;
      if (childIdx < paramLen) {
        for (let i = childIdx; i < paramLen; i++) {
          const param = params[i];
          if (!param) continue;
          stackChildIdx[idx] = i + 1;
          if (tryPushChild(param, targetPos)) return true;
        }
      }
      if (childIdx <= paramLen && node.body) {
        stackChildIdx[idx] = paramLen + 1;
        if (tryPushChild(node.body, targetPos)) return true;
      }
      return false;
    }

    case "CallExpression":
    case "NewExpression": {
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.callee, targetPos)) return true;
      }
      const args = node.arguments;
      const startArg = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startArg; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(arg, targetPos)) return true;
      }
      return false;
    }

    case "VariableDeclaration":
      return tryArrayChildren(node.declarations, childIdx, targetPos, idx);

    case "VariableDeclarator":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.id, targetPos)) return true;
      }
      if (node.init) {
        stackChildIdx[idx] = 2;
        return tryPushChild(node.init, targetPos);
      }
      return false;

    case "ExpressionStatement":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.expression, targetPos);

    case "ReturnStatement":
      if (childIdx !== 0 || !node.argument) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "IfStatement":
      if (childIdx > 2) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.test, targetPos)) return true;
      }
      if (childIdx <= 1) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.consequent, targetPos)) return true;
      }
      if (node.alternate) {
        stackChildIdx[idx] = 3;
        return tryPushChild(node.alternate, targetPos);
      }
      return false;

    case "ForStatement":
      if (childIdx > 3) return false;
      if (childIdx === 0 && node.init) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.init, targetPos)) return true;
      }
      if (childIdx <= 1 && node.test) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.test, targetPos)) return true;
      }
      if (childIdx <= 2 && node.update) {
        stackChildIdx[idx] = 3;
        if (tryPushChild(node.update, targetPos)) return true;
      }
      stackChildIdx[idx] = 4;
      return tryPushChild(node.body, targetPos);

    case "ForInStatement":
    case "ForOfStatement":
      if (childIdx > 2) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.left, targetPos)) return true;
      }
      if (childIdx <= 1) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.right, targetPos)) return true;
      }
      stackChildIdx[idx] = 3;
      return tryPushChild(node.body, targetPos);

    case "WhileStatement":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.test, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.body, targetPos);

    case "DoWhileStatement":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.body, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.test, targetPos);

    case "TryStatement":
      if (childIdx > 2) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.block, targetPos)) return true;
      }
      if (childIdx <= 1 && node.handler) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.handler, targetPos)) return true;
      }
      if (node.finalizer) {
        stackChildIdx[idx] = 3;
        return tryPushChild(node.finalizer, targetPos);
      }
      return false;

    case "CatchClause":
      if (childIdx > 1) return false;
      if (childIdx === 0 && node.param) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.param, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.body, targetPos);

    case "SwitchStatement": {
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.discriminant, targetPos)) return true;
      }
      const cases = node.cases;
      const startCase = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startCase; i < cases.length; i++) {
        const caseNode = cases[i];
        if (!caseNode) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(caseNode, targetPos)) return true;
      }
      return false;
    }

    case "SwitchCase": {
      if (childIdx === 0 && node.test) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.test, targetPos)) return true;
      }
      const cons = node.consequent;
      const startCons = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startCons; i < cons.length; i++) {
        const consNode = cons[i];
        if (!consNode) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(consNode, targetPos)) return true;
      }
      return false;
    }

    case "ArrayExpression":
    case "ArrayPattern":
      return tryArrayChildren(node.elements, childIdx, targetPos, idx);

    case "ObjectExpression":
    case "ObjectPattern":
      return tryArrayChildren(node.properties, childIdx, targetPos, idx);

    case "Property": {
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.key, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.value, targetPos);
    }

    case "SpreadElement":
    case "RestElement":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "UnaryExpression":
    case "UpdateExpression":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "AwaitExpression":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "YieldExpression":
      if (childIdx !== 0 || !node.argument) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "TaggedTemplateExpression":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.tag, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.quasi, targetPos);

    case "ClassDeclaration":
    case "ClassExpression":
      if (childIdx > 2) return false;
      if (childIdx === 0 && node.id) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.id, targetPos)) return true;
      }
      if (childIdx <= 1 && node.superClass) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.superClass, targetPos)) return true;
      }
      stackChildIdx[idx] = 3;
      return tryPushChild(node.body, targetPos);

    case "MethodDefinition":
    case "PropertyDefinition": {
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.key, targetPos)) return true;
      }
      if (node.value) {
        stackChildIdx[idx] = 2;
        if (tryPushChild(node.value, targetPos)) return true;
      }
      return false;
    }

    case "JSXElement": {
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.openingElement, targetPos)) return true;
      }
      const children = node.children;
      const startChild = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startChild; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(child, targetPos)) return true;
      }
      if (node.closingElement) {
        stackChildIdx[idx] = children.length + 2;
        if (tryPushChild(node.closingElement, targetPos)) return true;
      }
      return false;
    }

    case "JSXOpeningElement": {
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.name, targetPos)) return true;
      }
      const attrs = node.attributes;
      const startAttr = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startAttr; i < attrs.length; i++) {
        const attr = attrs[i];
        if (!attr) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(attr, targetPos)) return true;
      }
      return false;
    }

    case "JSXAttribute":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.name, targetPos)) return true;
      }
      if (node.value) {
        stackChildIdx[idx] = 2;
        return tryPushChild(node.value, targetPos);
      }
      return false;

    case "JSXSpreadAttribute":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "JSXExpressionContainer":
      if (childIdx !== 0 || node.expression.type === "JSXEmptyExpression") return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.expression, targetPos);

    case "ImportDeclaration": {
      const specs = node.specifiers;
      for (let i = childIdx; i < specs.length; i++) {
        const spec = specs[i];
        if (!spec) continue;
        stackChildIdx[idx] = i + 1;
        if (tryPushChild(spec, targetPos)) return true;
      }
      if (childIdx <= specs.length) {
        stackChildIdx[idx] = specs.length + 1;
        if (tryPushChild(node.source, targetPos)) return true;
      }
      return false;
    }

    case "ExportNamedDeclaration": {
      if (childIdx === 0 && node.declaration) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.declaration, targetPos)) return true;
      }
      const specs = node.specifiers;
      const startSpec = childIdx > 0 ? childIdx - 1 : 0;
      for (let i = startSpec; i < specs.length; i++) {
        const spec = specs[i];
        if (!spec) continue;
        stackChildIdx[idx] = i + 2;
        if (tryPushChild(spec, targetPos)) return true;
      }
      return false;
    }

    case "ExportDefaultDeclaration":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.declaration, targetPos);

    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.expression, targetPos);

    case "ThrowStatement":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.argument, targetPos);

    case "LabeledStatement":
      if (childIdx !== 0) return false;
      stackChildIdx[idx] = 1;
      return tryPushChild(node.body, targetPos);

    case "WithStatement":
      if (childIdx > 1) return false;
      if (childIdx === 0) {
        stackChildIdx[idx] = 1;
        if (tryPushChild(node.object, targetPos)) return true;
      }
      stackChildIdx[idx] = 2;
      return tryPushChild(node.body, targetPos);

    default:
      return false;
  }
}

/**
 * Finds ancestor chain containing target position using iterative traversal.
 *
 * @param ast - Root AST program node
 * @param targetPos - Packed target position to find
 */
function findAncestorChain(ast: T.Program, targetPos: number): void {
  const loc = ast.loc;
  if (!loc) return;

  const rootStart = packPos(loc.start.line, loc.start.column);
  const rootEnd = packPos(loc.end.line, loc.end.column);

  if (targetPos < rootStart || targetPos > rootEnd) return;

  stackNodes[0] = ast;
  stackChildIdx[0] = 0;
  stackTop = 1;

  while (stackTop > 0) {
    const idx = stackTop - 1;
    const node = stackNodes[idx];
    const childIdx = stackChildIdx[idx] ?? 0;
    if (!node) break;

    if (childIdx === 0) {
      ensureAncestorCapacity(ancestorCount + 1);
      ancestorBuffer[ancestorCount++] = node;
    }

    if (!iterateNodeChildren(node, childIdx, targetPos, idx)) {
      stackTop--;
    }
  }
}

/**
 * Builds selection ranges from ancestor chain.
 */
function buildRanges(): void {
  for (let i = ancestorCount - 1; i >= 0; i--) {
    const node = ancestorBuffer[i];
    if (!node) continue;
    addSubNodeRanges(node);
    const loc = node.loc;
    if (loc) {
      addLocRange(loc);
    }
  }
}

/**
 * Adds intermediate selection ranges for specific node types.
 *
 * @param node - AST node to extract sub-ranges from
 */
function addSubNodeRanges(node: T.Node): void {
  switch (node.type) {
    case "Literal": {
      const loc = node.loc;
      if (!loc || loc.end.column - loc.start.column <= 2) break;
      if (typeof node.value === "string") {
        addRangeIfUnique(
          loc.start.line - 1,
          loc.start.column + 1,
          loc.end.line - 1,
          loc.end.column - 1,
        );
      }
      break;
    }

    case "TemplateLiteral": {
      const quasis = node.quasis;
      if (quasis.length === 0) break;
      const first = quasis[0];
      const last = quasis[quasis.length - 1];
      if (!first || !last || !first.loc || !last.loc) break;
      addRangeIfUnique(
        first.loc.start.line - 1,
        first.loc.start.column,
        last.loc.end.line - 1,
        last.loc.end.column,
      );
      break;
    }

    case "CallExpression":
    case "NewExpression": {
      const args = node.arguments;
      if (args.length === 0) break;
      const first = args[0];
      const last = args[args.length - 1];
      if (!first || !last || !first.loc || !last.loc) break;
      addRangeIfUnique(
        first.loc.start.line - 1,
        first.loc.start.column,
        last.loc.end.line - 1,
        last.loc.end.column,
      );
      break;
    }

    case "ObjectExpression":
    case "ObjectPattern": {
      const props = node.properties;
      if (props.length === 0) break;
      const first = props[0];
      const last = props[props.length - 1];
      if (!first || !last || !first.loc || !last.loc) break;
      addRangeIfUnique(
        first.loc.start.line - 1,
        first.loc.start.column,
        last.loc.end.line - 1,
        last.loc.end.column,
      );
      break;
    }

    case "ArrayExpression":
    case "ArrayPattern": {
      const elems = node.elements;
      if (elems.length === 0) break;
      let firstEl: T.Node | null = null;
      let lastEl: T.Node | null = null;
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i];
        if (el) {
          if (!firstEl) firstEl = el;
          lastEl = el;
        }
      }
      if (!firstEl || !lastEl || !firstEl.loc || !lastEl.loc) break;
      addRangeIfUnique(
        firstEl.loc.start.line - 1,
        firstEl.loc.start.column,
        lastEl.loc.end.line - 1,
        lastEl.loc.end.column,
      );
      break;
    }

    case "JSXElement": {
      const children = node.children;
      if (children.length === 0) break;
      const first = children[0];
      const last = children[children.length - 1];
      if (!first || !last || !first.loc || !last.loc) break;
      addRangeIfUnique(
        first.loc.start.line - 1,
        first.loc.start.column,
        last.loc.end.line - 1,
        last.loc.end.column,
      );
      break;
    }

    case "ImportDeclaration": {
      const specs = node.specifiers;
      if (specs.length === 0) break;
      const first = specs[0];
      const last = specs[specs.length - 1];
      if (!first || !last || !first.loc || !last.loc) break;
      addRangeIfUnique(
        first.loc.start.line - 1,
        first.loc.start.column,
        last.loc.end.line - 1,
        last.loc.end.column,
      );
      break;
    }
  }
}

/**
 * Builds linked SelectionRange chain from collected ranges.
 *
 * @param position - Original cursor position
 * @returns Linked SelectionRange chain
 */
function buildLinkedRanges(position: Position): SelectionRange {
  if (rangeCount === 0) {
    return {
      range: {
        start: { line: position.line, character: position.character },
        end: { line: position.line, character: position.character },
      },
    };
  }

  const lastIdx = rangeCount - 1;
  let current: SelectionRange = {
    range: {
      start: { line: rangeStartLine[lastIdx] ?? 0, character: rangeStartChar[lastIdx] ?? 0 },
      end: { line: rangeEndLine[lastIdx] ?? 0, character: rangeEndChar[lastIdx] ?? 0 },
    },
  };

  for (let i = rangeCount - 2; i >= 0; i--) {
    current = {
      range: {
        start: { line: rangeStartLine[i] ?? 0, character: rangeStartChar[i] ?? 0 },
        end: { line: rangeEndLine[i] ?? 0, character: rangeEndChar[i] ?? 0 },
      },
      parent: current,
    };
  }

  return current;
}
