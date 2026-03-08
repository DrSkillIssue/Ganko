/**
 * Batch Rule
 *
 * Suggests using `batch()` when multiple signal setters are called
 * in the same synchronous scope.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import type { CallEntity, ScopeEntity, VariableEntity, ReadEntity } from "../../entities";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { buildSolidImportFix, extractSignalDestructures, getContainingStatement } from "../util";
import { defineSolidRule } from "../../rule";
import { getCallsByPrimitive, getCallByNode, getFunctionByNode } from "../../queries";

import type { Fix, FixOperation } from "../../../diagnostic";
import { isBlank } from "@ganko/shared";


/**
 * Solid primitives whose direct callbacks execute within runUpdates context.
 * Signal writes in the synchronous portion of these callbacks are auto-batched.
 *
 * Derived from Solid's reactive core: each of these either calls runUpdates()
 * directly or runs its callback inside the runUpdates pipeline via
 * updateComputation/runComputation.
 */
const AUTO_BATCH_PRIMITIVES = new Set([
  "createEffect",
  "createComputed",
  "createRenderEffect",
  "createMemo",
  "onMount",
  "createReaction",
  "batch",
  "startTransition",
]);

const messages = {
  multipleSetters:
    "Multiple signal updates in the same scope cause multiple re-renders. Wrap in batch() for a single update: batch(() => { {{setters}} });",
} as const;

const options = { threshold: 3 };

export const batchOptimization = defineSolidRule({
  id: "batch-optimization",
  severity: "warn",
  messages,
  meta: {
    description:
      "Suggest using batch() when multiple signal setters are called in the same synchronous scope",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    // Step 1: Get all createSignal calls and extract setter variables
    const signalCalls = getCallsByPrimitive(graph, "createSignal");
    if (signalCalls.length === 0) {
      return;
    }

    const destructures = extractSignalDestructures(signalCalls, graph);
    if (destructures.length === 0) {
      return;
    }

    const setterVariables: SetterInfo[] = []
    for (let i = 0, len = destructures.length; i < len; i++) {
      const d = destructures[i];
      if (!d) continue;
      setterVariables.push({ variable: d.setterVariable, name: d.setterName })
    }

    // Step 2: Get batch call ranges (sorted for early termination)
    const batchCalls = getCallsByPrimitive(graph, "batch");
    const batchRanges = extractSortedBatchRanges(batchCalls);

    // Step 3: Find all setter calls via variable reads (O(setters × reads) instead of O(all calls))
    const setterCalls = findSetterCallsViaReads(setterVariables);
    if (setterCalls.length < options.threshold) {
      return;
    }

    // Step 4: Group setter calls by their containing function scope
    const callsByFunctionScope = groupByFunctionScope(setterCalls);

    // Step 5: For each group, check if there are 3+ consecutive setters not in batch
    for (const [scope, calls] of callsByFunctionScope) {
      // Filter out calls already inside batch()
      const unbatchedCalls = filterUnbatchedCalls(calls, batchRanges);

      if (unbatchedCalls.length < options.threshold) {
        continue;
      }

      const consecutiveGroups = findConsecutiveSetterGroups(unbatchedCalls);

      for (let i = 0, len = consecutiveGroups.length; i < len; i++) {
        const group = consecutiveGroups[i];
        if (!group || group.length < options.threshold) {
          continue;
        }

        if (isGroupAutoBatched(scope, group, graph)) {
          continue;
        }

        const firstCall = group[0];
        if (!firstCall) continue;
        const setterList = formatSetterList(group, graph.sourceCode.text);
        const message = resolveMessage(messages.multipleSetters, { setters: setterList });
        const fix = buildFix(group, graph.sourceCode.text, graph, scope);

        emit(
          createDiagnostic(
            graph.file,
            firstCall.callNode,
            "batch-optimization",
            "multipleSetters",
            message,
            "warn",
            fix,
          ),
        );
      }
    }
  },
});

// Caches - WeakMaps to avoid memory leaks across files
// These are module-level to persist across rule invocations on the same AST

/** Cache: BlockStatement/Program -> Map<Node, index in body> */
const blockIndexCache = new WeakMap<T.BlockStatement | T.Program, Map<T.Node, number>>();

interface SetterInfo {
  variable: VariableEntity;
  name: string;
}

/** Minimal setter call info - before expensive AST walks */
interface SetterCallMinimal {
  read: ReadEntity;
  callNode: T.CallExpression;
  name: string;
}

/** Full setter call info - after hydrating with containingStatement */
interface SetterCall extends SetterCallMinimal {
  containingStatement: T.Node | null;
}

/**
 * Extract and sort batch call ranges by start position.
 *
 * Converts batch() call entities into sorted [start, end] character position ranges.
 * Sorting by start position enables early termination in filterUnbatchedCalls()
 * when checking if a setter call is inside a batch scope.
 *
 * When checking if a setter call at position P is inside any batch, we iterate
 * through batches in order. If we find a batch that starts after P ends, we know
 * no remaining batches can contain P (since they're sorted), so we stop.
 *
 * @param batchCalls - All batch() call entities from the graph
 * @returns Sorted array of [start, end] character position ranges
 */
function extractSortedBatchRanges(batchCalls: readonly CallEntity[]): readonly [number, number][] {
  if (batchCalls.length === 0) {
    return [];
  }

  const ranges: [number, number][] = [];
  for (let i = 0, len = batchCalls.length; i < len; i++) {
    const call = batchCalls[i];
    if (!call) continue;
    ranges.push(call.node.range);
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/**
 * Find all setter calls by traversing variable read entities.
 *
 * Finds all calls to setter functions by checking which reads
 * are being called (isProperAccess). This approach checks only the reads
 * from each setter variable rather than scanning all calls.
 *
 * Only includes calls where the identifier is the callee (setValue(...)),
 * not other accesses like passing setValue as a parameter.
 *
 * @param setterVariables - Setter variable definitions to search for
 * @returns Array of setter calls with their containing statements
 */
function findSetterCallsViaReads(setterVariables: SetterInfo[]): SetterCall[] {
  const result: SetterCall[] = [];

  for (let i = 0, len = setterVariables.length; i < len; i++) {
    const setter = setterVariables[i];
    if (!setter) continue;
    const reads = setter.variable.reads;

    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;

      // isProperAccess means the identifier is the callee of a CallExpression
      if (!read.isProperAccess) {
        continue;
      }

      if (read.node.parent?.type !== "CallExpression") continue;
      const callNode = read.node.parent;

      const containingStatement = getContainingStatement(callNode);

      result.push({
        read,
        callNode,
        name: setter.name,
        containingStatement,
      });
    }
  }

  return result;
}

/**
 * Group setter calls by their containing function scope.
 *
 * Organizes all setter calls by the function scope they execute in.
 * Finds the nearest function scope for each call by walking up the scope chain.
 * This allows checking for batching per-function so we don't flag setters
 * in different functions as needing a batch.
 *
 * @param setterCalls - All setter calls to group
 * @returns Map from function scope to setter calls within that scope
 */
function groupByFunctionScope(setterCalls: SetterCall[]): Map<ScopeEntity, SetterCall[]> {
  const groups = new Map<ScopeEntity, SetterCall[]>();

  for (let i = 0, len = setterCalls.length; i < len; i++) {
    const setterCall = setterCalls[i];
    if (!setterCall) continue;
    const functionScope = findFunctionScope(setterCall.read.scope);

    if (!functionScope) {
      continue;
    }

    const group = groups.get(functionScope) ?? [];
    if (!groups.has(functionScope)) {
      groups.set(functionScope, group);
    }
    group.push(setterCall);
  }

  return groups;
}

/**
 * Walk up the scope chain to find the nearest enclosing function scope.
 *
 * Used to determine which function context a setter call executes in.
 * Returns null if the scope is global (no function parent).
 *
 * @param scope - Starting scope to walk up from
 * @returns The nearest function scope, or null if none exists
 */
function findFunctionScope(scope: ScopeEntity): ScopeEntity | null {
  for (let s: ScopeEntity | null = scope; s; s = s.parent) {
    if (s.kind === "function") return s;
  }
  return null;
}

/**
 * Filter out setter calls that are already inside a batch() call.
 *
 * Uses range checking with early termination: since batch ranges are sorted
 * by start position, once we find a batch that starts after the current call
 * ends, no remaining batches can contain that call.
 *
 * @param calls - All setter calls to filter
 * @param sortedBatchRanges - Sorted [start, end] ranges of batch() calls
 * @returns Only the setter calls NOT inside any batch()
 */
function filterUnbatchedCalls(
  calls: SetterCall[],
  sortedBatchRanges: readonly [number, number][],
): SetterCall[] {
  if (sortedBatchRanges.length === 0) {
    return calls;
  }

  const result: SetterCall[] = [];
  const rangeLen = sortedBatchRanges.length;

  outer: for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const callStart = call.callNode.range[0];
    const callEnd = call.callNode.range[1];

    for (let j = 0; j < rangeLen; j++) {
      const batch = sortedBatchRanges[j];
      if (!batch) continue;
      // Early termination: if batch starts after call ends, no more batches can contain it
      if (batch[0] > callEnd) break;
      if (callStart >= batch[0] && callEnd <= batch[1]) continue outer;
    }
    result.push(call);
  }

  return result;
}

/**
 * Find groups of consecutive setter calls using AST statement structure.
 *
 * Sorts calls by range then identifies groups where calls are in consecutive
 * statements (siblings in the same block). This is important because batch()
 * should only be suggested when setters are close together - not spread across
 * far-apart lines.
 *
 * WARNING: Mutates the input array by sorting in place. Caller must pass
 * a fresh array (e.g., from filterUnbatchedCalls()).
 *
 * @param calls - Setter calls to group (WILL BE MUTATED by sort)
 * @returns Groups of consecutive statements with 2+ setter calls
 */
function findConsecutiveSetterGroups(calls: SetterCall[]): SetterCall[][] {
  if (calls.length === 0) {
    return [];
  }

  // Sort in place - caller provides a fresh array from filterUnbatchedCalls
  calls.sort((a, b) => a.callNode.range[0] - b.callNode.range[0]);

  const first = calls[0];
  if (!first) return [];

  const groups: SetterCall[][] = [];
  let currentGroup: SetterCall[] = [first];

  for (let i = 1, len = calls.length; i < len; i++) {
    const current = calls[i];
    if (!current) continue;
    const previous = calls[i - 1];
    if (!previous) continue;

    if (areConsecutiveStatements(previous, current)) {
      currentGroup.push(current);
    } else {
      groups.push(currentGroup);
      currentGroup = [current];
    }
  }
  groups.push(currentGroup);

  return groups;
}

/**
 * Get the index of a statement within its containing block, using cached lookup.
 *
 * Uses a WeakMap cache to avoid rebuilding the index map on every call.
 * The cache is per-block and persists across rule invocations on the same AST.
 *
 * @param block - The containing block or program
 * @param stmt - The statement to find the index of
 * @returns Zero-based index, or -1 if statement not found in block
 */
function getStatementIndex(block: T.BlockStatement | T.Program, stmt: T.Node): number {
  const cached = blockIndexCache.get(block);
  if (cached) return cached.get(stmt) ?? -1;

  const indexMap = new Map<T.Node, number>();
  const body = block.body;
  for (let i = 0, len = body.length; i < len; i++) {
    const stmt = body[i];
    if (!stmt) continue;
    indexMap.set(stmt, i);
  }
  blockIndexCache.set(block, indexMap);
  return indexMap.get(stmt) ?? -1;
}

/**
 * Check if two setter calls are in consecutive statements.
 *
 * Two calls are consecutive if:
 * 1. Both have containing statements
 * 2. Both statements have the same parent block
 * 3. Their indices in that block are N and N+1
 *
 * This ensures setters are physically adjacent in the code, which is
 * what batch() is designed to optimize.
 *
 * @param prev - First setter call
 * @param curr - Second setter call
 * @returns True if the calls are in consecutive statements
 */
function areConsecutiveStatements(prev: SetterCall, curr: SetterCall): boolean {
  const prevStmt = prev.containingStatement;
  const currStmt = curr.containingStatement;

  if (!prevStmt || !currStmt) {
    return false;
  }

  const parent = prevStmt.parent;
  if (parent !== currStmt.parent) {
    return false;
  }

  // Parent must be a BlockStatement (or Program) with a body array
  if (!parent) return false;
  if (parent.type !== "BlockStatement" && parent.type !== "Program") {
    return false;
  }

  const prevIdx = getStatementIndex(parent, prevStmt);
  const currIdx = getStatementIndex(parent, currStmt);

  // Consecutive if indices differ by exactly 1
  return prevIdx >= 0 && currIdx >= 0 && currIdx === prevIdx + 1;
}

/**
 * Format a list of setter calls for the error message.
 *
 * Shows the first 3 setter calls (e.g., "setValue(1); setCount(2); setName('x')").
 * If there are more than 3, adds "..." to indicate truncation.
 *
 * @param calls - The setter calls to format
 * @param sourceText - The full source code to extract call text from
 * @returns Formatted string like "setA(x); setB(y); setC(z); ..."
 */
function formatSetterList(calls: SetterCall[], sourceText: string): string {
  if (calls.length <= 3) {
    return calls
      .map((c) => sourceText.slice(c.callNode.range[0], c.callNode.range[1]))
      .join("; ");
  }

  const first3: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = calls[i];
    if (!c) continue;
    first3.push(sourceText.slice(c.callNode.range[0], c.callNode.range[1]));
  }
  return `${first3.join("; ")}; ...`;
}

/**
 * Determine if a setter group is already auto-batched by Solid's runtime.
 *
 * A group is auto-batched when its containing function scope is a direct
 * callback to a Solid primitive that runs within runUpdates (e.g. createEffect,
 * onMount, batch). For async functions, only the synchronous portion before
 * the first await is auto-batched — after an await the runUpdates context
 * has been torn down and each setter triggers a separate flush.
 */
function isGroupAutoBatched(
  scope: ScopeEntity,
  group: SetterCall[],
  graph: SolidGraph,
): boolean {
  const fn = scope.node;
  if (!fn) return false;

  const primitive = getAutoBatchPrimitive(fn, graph);
  if (!primitive) return false;

  const entity = getFunctionByNode(graph, fn);
  if (!entity) return false;

  // Synchronous callback — entire body is auto-batched
  if (!entity.async) return true;

  // Async callback — only auto-batched before the first await
  if (entity.awaitRanges.length === 0) return true;

  const firstGroupCall = group[0];
  if (!firstGroupCall) return false;
  const groupStart = firstGroupCall.callNode.range[0];
  return !hasAwaitBeforePosition(entity.awaitRanges, groupStart);
}

/**
 * Detect if a function AST node is a direct callback to an auto-batching
 * Solid primitive. Handles both direct callbacks and the on() wrapper pattern.
 *
 * Direct:  createEffect(() => { ... })
 * Wrapped: createEffect(on(deps, () => { ... }))
 */
function getAutoBatchPrimitive(fn: T.Node, graph: SolidGraph): string | null {
  const parent = fn.parent;
  if (!parent || parent.type !== "CallExpression" || parent.callee === fn) return null;

  const name = resolvePrimitiveName(parent, graph);
  if (name && AUTO_BATCH_PRIMITIVES.has(name)) return name;

  // on() wrapper — check if on()'s parent is an auto-batching primitive
  if (name === "on") {
    const grandparent = parent.parent;
    if (grandparent?.type === "CallExpression" && grandparent.callee !== parent) {
      const outer = resolvePrimitiveName(grandparent, graph);
      if (outer && AUTO_BATCH_PRIMITIVES.has(outer)) return outer;
    }
  }

  return null;
}

/**
 * Resolve the Solid primitive name for a call expression.
 * Uses the graph's CallEntity primitive field (which handles import resolution)
 * with a fallback to the callee identifier name.
 */
function resolvePrimitiveName(call: T.CallExpression, graph: SolidGraph): string | null {
  const entity = getCallByNode(graph, call);
  if (entity?.primitive) return entity.primitive.name;
  if (call.callee.type === "Identifier") return call.callee.name;
  return null;
}

/**
 * Check if any await expression in the function occurs before the given position.
 * Uses the pre-computed awaitRanges from the FunctionEntity (populated during
 * graph building), avoiding any AST walking at rule time.
 */
function hasAwaitBeforePosition(ranges: readonly [number, number][], position: number): boolean {
  for (let i = 0, len = ranges.length; i < len; i++) {
    const range = ranges[i];
    if (!range) continue;
    if (range[0] < position) return true;
  }
  return false;
}

/**
 * Build the fix for a setter group.
 *
 * For post-await contexts: expands the fix range to wrap all remaining
 * statements in the function body after the last await. This captures
 * if/else branches, trailing setters, and other statements that all
 * execute without a batch context.
 *
 * For other contexts: wraps just the consecutive setter statements.
 */
function buildFix(
  calls: SetterCall[],
  sourceText: string,
  graph: SolidGraph,
  scope: ScopeEntity,
): Fix | undefined {
  if (calls.length === 0) {
    return undefined;
  }

  const postAwaitRange = getPostAwaitStatementsRange(scope, calls, graph);
  if (postAwaitRange) {
    return buildPostAwaitFix(postAwaitRange, sourceText, graph);
  }

  return buildConsecutiveFix(calls, sourceText, graph);
}

/**
 * For post-await contexts, find the range of all statements from the first
 * post-await statement to the end of the function body. Returns null if
 * this is not a post-await scenario.
 */
function getPostAwaitStatementsRange(
  scope: ScopeEntity,
  calls: SetterCall[],
  graph: SolidGraph,
): [number, number] | null {
  const fn = scope.node;
  if (!fn) return null;

  const entity = getFunctionByNode(graph, fn);
  if (!entity || !entity.async || entity.awaitRanges.length === 0) return null;

  if (!getAutoBatchPrimitive(fn, graph)) return null;

  if (entity.body.type !== "BlockStatement") return null;
  const body = entity.body;
  const stmts = body.body;
  if (stmts.length === 0) return null;

  // Find the last await position before this group
  const firstCall = calls[0];
  if (!firstCall) return null;
  const groupStart = firstCall.callNode.range[0];
  let lastAwaitEnd = -1;
  for (let i = 0, len = entity.awaitRanges.length; i < len; i++) {
    const range = entity.awaitRanges[i];
    if (!range) continue;
    if (range[0] < groupStart && range[1] > lastAwaitEnd) {
      lastAwaitEnd = range[1];
    }
  }
  if (lastAwaitEnd < 0) return null;

  // Find the first top-level statement that starts after the last await
  let firstPostAwaitIdx = -1;
  for (let i = 0, len = stmts.length; i < len; i++) {
    const stmt = stmts[i];
    if (!stmt) continue;
    if (stmt.range[0] > lastAwaitEnd) {
      firstPostAwaitIdx = i;
      break;
    }
  }

  // The await might be nested inside a statement (e.g. `const x = await ...`).
  // In that case, the first post-await statement is the one AFTER the statement
  // containing the await.
  if (firstPostAwaitIdx < 0) {
    for (let i = 0, len = stmts.length; i < len; i++) {
      const stmt = stmts[i];
      if (!stmt) continue;
      if (stmt.range[1] >= lastAwaitEnd && i + 1 < len) {
        firstPostAwaitIdx = i + 1;
        break;
      }
    }
  }
  if (firstPostAwaitIdx < 0) return null;

  const firstStmt = stmts[firstPostAwaitIdx];
  const lastStmt = stmts[stmts.length - 1];
  if (!firstStmt || !lastStmt) return null;

  return [firstStmt.range[0], lastStmt.range[1]];
}

/**
 * Build a fix that wraps all post-await statements in batch().
 */
function buildPostAwaitFix(
  range: [number, number],
  sourceText: string,
  graph: SolidGraph,
): Fix {
  // Expand range to include indentation: start from the line start, not the statement start.
  // This way `inner` captures the full lines with their original indentation.
  const lineStart = sourceText.lastIndexOf("\n", range[0]) + 1;
  const indentation = sourceText.slice(lineStart, range[0]);
  const inner = sourceText.slice(lineStart, range[1]);

  // Split into lines. Each line has its full original indentation.
  // The common indentation is `indentation` (the first statement's indent).
  // Strip that common prefix and re-indent with `indentation + "  "`.
  const indentLen = indentation.length;
  const lines = inner.split("\n");
  const reindented: string[] = new Array(lines.length);
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = lines[i];
    if (!line || isBlank(line)) {
      reindented[i] = "";
      continue;
    }
    const stripped = line.slice(indentLen);
    reindented[i] = indentation + "  " + stripped;
  }

  const batchCode = `batch(() => {\n${reindented.join("\n")}\n${indentation}});`;

  const ops: FixOperation[] = [
    { range: [range[0], range[1]], text: batchCode },
  ];

  const importFix = buildSolidImportFix(graph, "batch");
  if (importFix) {
    ops.unshift(importFix);
  }

  return ops;
}

/**
 * Build a fix that wraps just the consecutive setter statements in batch().
 * Used for non-async contexts (event handlers, standalone functions, etc.).
 */
function buildConsecutiveFix(
  calls: SetterCall[],
  sourceText: string,
  graph: SolidGraph,
): Fix | undefined {
  const statements = calls
    .map((c) => c.containingStatement)
    .filter((s) => s !== null);

  if (statements.length !== calls.length) {
    return undefined;
  }

  const firstStmt = statements[0];
  const lastStmt = statements[statements.length - 1];
  if (!firstStmt || !lastStmt) return undefined;

  const lineStart = sourceText.lastIndexOf("\n", firstStmt.range[0]) + 1;
  const indentation = sourceText.slice(lineStart, firstStmt.range[0]);

  const statementsTexts: string[] = [];
  for (let i = 0, len = statements.length; i < len; i++) {
    const s = statements[i];
    if (!s) continue;
    statementsTexts.push(sourceText.slice(s.range[0], s.range[1]));
  }

  const statementsText = statementsTexts.join("\n" + indentation + "  ");
  const batchCode = `batch(() => {\n${indentation}  ${statementsText}\n${indentation}});`;

  const ops: FixOperation[] = [
    {
      range: [firstStmt.range[0], lastStmt.range[1]],
      text: batchCode,
    },
  ];

  const importFix = buildSolidImportFix(graph, "batch");
  if (importFix) {
    ops.unshift(importFix);
  }

  return ops;
}
