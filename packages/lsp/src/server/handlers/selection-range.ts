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
import ts from "typescript";
import type { HandlerContext } from "./handler-context";
import { uriToPath, Level } from "@drskillissue/ganko-shared";
import { packPos } from "./ts-utils";

const INITIAL_STACK_SIZE = 128;
const INITIAL_ANCESTORS = 64;
const MAX_RANGES = 128;

/** Stack for traversal (dynamically grown). */
let stackNodes: (ts.Node | null)[] = new Array(INITIAL_STACK_SIZE);
let stackChildIdx = new Int32Array(INITIAL_STACK_SIZE);
let stackCapacity = INITIAL_STACK_SIZE;

/** Buffer for ancestor chain (dynamically grown). */
let ancestorBuffer: (ts.Node | null)[] = new Array(INITIAL_ANCESTORS);
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

/** Cached source file for the current request. Set before use, cleared after. */
let currentSf: ts.SourceFile | undefined;

/**
 * Narrow currentSf to a definite SourceFile. Called at the entry of every
 * internal function that needs the source file so TypeScript can prove
 * non-nullability without casts or non-null assertions.
 */
function requireSf(): ts.SourceFile {
  const sf = currentSf;
  if (sf === undefined) throw new Error("selection-range: currentSf must be set before traversal");
  return sf;
}

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
  const newNodes = new Array<ts.Node | null>(newCapacity).fill(null);
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
  const newBuffer: (ts.Node | null)[] = new Array<ts.Node | null>(newCapacity).fill(null);
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
 * Adds range from a ts.Node to the buffer.
 *
 * @param node - TypeScript AST node
 */
function addNodeRange(node: ts.Node): void {
  const sf = requireSf();
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.end);
  addRangeIfUnique(start.line, start.character, end.line, end.character);
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
  const sf = ctx.getAST(filePath);
  if (!sf) return null;
  if (ctx.log.isLevelEnabled(Level.Trace)) ctx.log.trace(`selectionRange: ${params.positions.length} positions for ${filePath}`);

  currentSf = sf;
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

    findAncestorChain(sf, targetPos);

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

  currentSf = undefined;
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
function tryPushChild(child: ts.Node, targetPos: number): boolean {
  const sf = requireSf();
  const childStartPos = sf.getLineAndCharacterOfPosition(child.getStart(sf));
  const childEndPos = sf.getLineAndCharacterOfPosition(child.end);

  const childStart = packPos(childStartPos.line + 1, childStartPos.character);
  const childEnd = packPos(childEndPos.line + 1, childEndPos.character);

  if (targetPos < childStart || targetPos > childEnd) return false;

  ensureStackCapacity(stackTop + 1);
  stackNodes[stackTop] = child;
  stackChildIdx[stackTop] = 0;
  stackTop++;
  return true;
}

/**
 * Collects children of a node into a flat array for indexed iteration.
 *
 * @param node - Parent node
 * @returns Array of child nodes
 */
function getChildrenArray(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, child => {
    children.push(child);
  });
  return children;
}

/**
 * Iterates node children using ts.forEachChild-derived child list.
 *
 * @param node - AST node to iterate
 * @param childIdx - Current child index
 * @param targetPos - Packed target position
 * @param idx - Stack index
 * @returns True if child containing position was pushed
 */
function iterateNodeChildren(
  node: ts.Node,
  childIdx: number,
  targetPos: number,
  idx: number,
): boolean {
  const children = getChildrenArray(node);
  const len = children.length;
  if (childIdx >= len) return false;

  for (let i = childIdx; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    stackChildIdx[idx] = i + 1;
    if (tryPushChild(child, targetPos)) return true;
  }
  return false;
}

/**
 * Finds ancestor chain containing target position using iterative traversal.
 *
 * @param sf - Source file root node
 * @param targetPos - Packed target position to find
 */
function findAncestorChain(sf: ts.SourceFile, targetPos: number): void {
  const startPos = sf.getLineAndCharacterOfPosition(sf.getStart(sf));
  const endPos = sf.getLineAndCharacterOfPosition(sf.end);

  const rootStart = packPos(startPos.line + 1, startPos.character);
  const rootEnd = packPos(endPos.line + 1, endPos.character);

  if (targetPos < rootStart || targetPos > rootEnd) return;

  stackNodes[0] = sf;
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
    addNodeRange(node);
  }
}

/**
 * Adds intermediate selection ranges for specific node types.
 *
 * @param node - AST node to extract sub-ranges from
 */
function addSubNodeRanges(node: ts.Node): void {
  const sf = requireSf();

  if (ts.isStringLiteral(node)) {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const end = sf.getLineAndCharacterOfPosition(node.end);
    if (end.character - start.character > 2 || end.line > start.line) {
      // Select content inside quotes
      addRangeIfUnique(
        start.line,
        start.character + 1,
        end.line,
        end.character - 1,
      );
    }
  } else if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const end = sf.getLineAndCharacterOfPosition(node.end);
    addRangeIfUnique(start.line, start.character, end.line, end.character);
  } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const args = node.arguments;
    if (args && args.length > 0) {
      const first = args[0];
      const last = args[args.length - 1];
      if (first && last) {
        const fStart = sf.getLineAndCharacterOfPosition(first.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(last.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    const props = node.properties;
    if (props.length > 0) {
      const first = props[0];
      const last = props[props.length - 1];
      if (first && last) {
        const fStart = sf.getLineAndCharacterOfPosition(first.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(last.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isObjectBindingPattern(node)) {
    const elements = node.elements;
    if (elements.length > 0) {
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (first && last) {
        const fStart = sf.getLineAndCharacterOfPosition(first.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(last.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    const elems = node.elements;
    if (elems.length > 0) {
      let firstEl: ts.Node | null = null;
      let lastEl: ts.Node | null = null;
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i];
        if (el && !ts.isOmittedExpression(el)) {
          if (!firstEl) firstEl = el;
          lastEl = el;
        }
      }
      if (firstEl && lastEl) {
        const fStart = sf.getLineAndCharacterOfPosition(firstEl.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(lastEl.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isArrayBindingPattern(node)) {
    const elems = node.elements;
    if (elems.length > 0) {
      let firstEl: ts.Node | null = null;
      let lastEl: ts.Node | null = null;
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i];
        if (el && !ts.isOmittedExpression(el)) {
          if (!firstEl) firstEl = el;
          lastEl = el;
        }
      }
      if (firstEl && lastEl) {
        const fStart = sf.getLineAndCharacterOfPosition(firstEl.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(lastEl.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isJsxElement(node)) {
    const children = node.children;
    if (children.length > 0) {
      const first = children[0];
      const last = children[children.length - 1];
      if (first && last) {
        const fStart = sf.getLineAndCharacterOfPosition(first.getStart(sf));
        const lEnd = sf.getLineAndCharacterOfPosition(last.end);
        addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
      }
    }
  } else if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause) {
      const namedBindings = clause.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        const specs = namedBindings.elements;
        if (specs.length > 0) {
          const first = specs[0];
          const last = specs[specs.length - 1];
          if (first && last) {
            const fStart = sf.getLineAndCharacterOfPosition(first.getStart(sf));
            const lEnd = sf.getLineAndCharacterOfPosition(last.end);
            addRangeIfUnique(fStart.line, fStart.character, lEnd.line, lEnd.character);
          }
        }
      }
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
