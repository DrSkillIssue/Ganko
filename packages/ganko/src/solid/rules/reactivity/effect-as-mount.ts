/**
 * Effect As Mount Rule
 *
 * Detect `createEffect`/`createRenderEffect` being used only for initialization
 * (should use `onMount`).
 *
 * Problem: Using createEffect for code that should only run once on component mount
 * doesn't express the intent as clearly as using onMount.
 *
 * This rule catches effects with no reactive dependencies:
 * ```
 * createEffect(() => {
 *   console.log("Component mounted!");
 *   setupEventListener();
 * });
 * ```
 *
 * Should be:
 * ```
 * onMount(() => {
 *   console.log("Component mounted!");
 *   setupEventListener();
 * });
 * ```
 *
 * `onMount` is literally `createEffect(() => untrack(fn))` in Solid's source.
 * Effects with no reactive dependencies run exactly once — they never re-run
 * because no signals are tracked and therefore no updates are ever scheduled.
 * Using `onMount` makes the one-shot intent explicit.
 */

import ts from "typescript";
import type { Fix } from "../../../diagnostic";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { FunctionEntity, VariableEntity, ScopeEntity } from "../../entities";
import { defineSolidRule } from "../../rule";
import { buildSolidImportFix } from "../util";
import { getCallsByPrimitive, getFunctionByNode } from "../../queries/get";
import { getCapturedReactiveVariables } from "../../queries/entity";

const messages = {
  effectAsMount:
    "This {{primitive}} has no reactive dependencies and runs only once. Use onMount() for initialization logic that doesn't need to re-run.",
} as const;

const options = {};

export const effectAsMount = defineSolidRule({
  id: "effect-as-mount",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect createEffect/createRenderEffect with no reactive dependencies that should be onMount instead",
    fixable: true,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const createEffects = getCallsByPrimitive(graph, "createEffect");
    const renderEffects = getCallsByPrimitive(graph, "createRenderEffect");

    const effectCalls = renderEffects.length > 0
      ? [...createEffects, ...renderEffects]
      : createEffects;

    if (effectCalls.length === 0) return;

    for (let i = 0, len = effectCalls.length; i < len; i++) {
      const call = effectCalls[i];
      if (!call) continue;
      const callbackArg = call.arguments[0];
      if (!callbackArg) continue;

      const callbackNode = callbackArg.node;
      if (!ts.isArrowFunction(callbackNode) && !ts.isFunctionExpression(callbackNode)) {
        continue;
      }

      if (callbackNode.parameters.length > 0) continue;

      const fnEntity = getFunctionByNode(graph, callbackNode);
      if (!fnEntity) continue;

      const reactiveCaptures = getCapturedReactiveVariables(fnEntity);
      if (reactiveCaptures.length > 0) continue;

      // Conservative: if callback contains calls to non-primitive functions that
      // capture reactive variables, those signals would create subscriptions at
      // runtime but getCapturedReactiveVariables only sees direct captures.
      // Skip when the callback calls functions with reactive captures.
      if (hasIndirectReactiveReads(graph, fnEntity)) continue;

      const name = calleeName(call.node);
      const fix = buildFix(call.node, name, graph);
      const resolved = resolveMessage(messages.effectAsMount, { primitive: name });
      emit(createDiagnostic(graph.filePath, call.node, graph.sourceFile, "effect-as-mount", "effectAsMount", resolved, "error", fix));
    }
  },
});

/**
 * Extract callee name from a call expression.
 */
function calleeName(node: ts.CallExpression | ts.NewExpression): string {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return "createEffect";
}

/**
 * Check if a function may transitively read reactive variables.
 *
 * Solid's Listener is a module-level global that persists across the entire
 * synchronous call stack — any signal read at any call depth creates a
 * subscription. This function checks three layers:
 *
 * 1. The callback body for non-identifier calls on local variables
 *    (e.g. `table.isSomeSelected()`, `props.table.method()`).
 *    Bare identifier calls like `setState()` are NOT checked here — they
 *    are handled by capture analysis in the caller.
 *
 * 2. Captured variables that are functions with reactive captures
 *    (e.g. a helper that reads `count()`).
 *
 * 3. Captured functions' bodies for ANY unresolved call to a local variable
 *    (e.g. `resolveUrl` calling `url()` where `url` could be a signal accessor).
 *    This is more aggressive than layer 1 because the capture analysis does
 *    not recurse into resolved function bodies.
 */
function hasIndirectReactiveReads(graph: SolidGraph, fn: FunctionEntity): boolean {
  if (hasAmbiguousCallsInScope(graph, fn)) return true;

  const captures = fn.captures;
  const reactiveFns = graph.functionsWithReactiveCaptures;

  for (let i = 0, len = captures.length; i < len; i++) {
    const captured = captures[i];
    if (!captured) continue;
    for (let j = 0, flen = reactiveFns.length; j < flen; j++) {
      const reactiveFn = reactiveFns[j];
      if (!reactiveFn) continue;
      if (reactiveFn.variable === captured) return true;
    }
  }

  for (let i = 0, len = captures.length; i < len; i++) {
    const captured = captures[i];
    if (!captured) continue;
    const capturedFn = findFunctionForVariable(graph, captured);
    if (capturedFn && hasUnresolvedLocalCalls(graph, capturedFn)) return true;
  }

  return false;
}

/**
 * Check the callback body for non-identifier calls that may read signals.
 *
 * Only flags calls where:
 * - The callee is NOT a bare Identifier (those are handled by capture analysis)
 * - The call has no resolvedTarget and no primitive
 * - The call's calleeRootVariable is non-null (local variable, not a global)
 *   OR the callee root is not an Identifier at all (e.g. `getObj().method()`)
 *
 * This correctly skips `console.log()` (global, calleeRootVariable is null)
 * while flagging `table.method()` (local, calleeRootVariable is set) and
 * `getObj().method()` (root is CallExpression, not Identifier).
 */
function hasAmbiguousCallsInScope(graph: SolidGraph, fn: FunctionEntity): boolean {
  const calls = graph.calls;
  const fnScope = fn.scope;
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    if (call.primitive) continue;
    if (call.resolvedTarget) continue;
    if (ts.isIdentifier(call.callee)) continue;
    if (!isScopeDescendant(call.scope, fnScope)) continue;
    // calleeRootVariable is non-null → callee roots at a local variable
    if (call.calleeRootVariable !== null) return true;
    // calleeRootVariable is null → either global OR non-identifier root.
    // For PropertyAccessExpression callees, check if the root is actually an
    // Identifier (global like console) vs something else (CallExpression,
    // ThisExpression, etc. — conservative bail out).
    if (ts.isPropertyAccessExpression(call.callee) && !hasIdentifierRoot(call.callee)) return true;
  }
  return false;
}

/**
 * Check a captured function's body for ANY unresolved call to a local variable.
 *
 * More aggressive than hasAmbiguousCallsInScope: also flags bare identifier
 * calls like `url()` where `url` is a local variable with no resolvedTarget.
 * The capture analysis from the caller does NOT recurse into resolved function
 * bodies, so this is the only place that catches `const url = options.url;
 * url()` inside a resolved helper function.
 */
function hasUnresolvedLocalCalls(graph: SolidGraph, fn: FunctionEntity): boolean {
  const calls = graph.calls;
  const fnScope = fn.scope;
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    if (call.primitive) continue;
    if (call.resolvedTarget) continue;
    if (!isScopeDescendant(call.scope, fnScope)) continue;
    if (call.calleeRootVariable !== null) return true;
    if (ts.isPropertyAccessExpression(call.callee) && !hasIdentifierRoot(call.callee)) return true;
  }
  return false;
}

/**
 * Check if a MemberExpression chain roots at an Identifier.
 *
 * `console.log` → root is `console` (Identifier) → true
 * `a.b.c` → root is `a` (Identifier) → true
 * `getObj().method` → root is `getObj()` (CallExpression) → false
 * `this.foo` → root is `this` (ThisExpression) → false
 */
function hasIdentifierRoot(node: ts.PropertyAccessExpression): boolean {
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current);
}

/**
 * Find the FunctionEntity that a variable's value points to.
 */
function findFunctionForVariable(graph: SolidGraph, variable: VariableEntity): FunctionEntity | null {
  const fns = graph.functions;
  for (let i = 0, len = fns.length; i < len; i++) {
    const fn = fns[i];
    if (!fn) continue;
    if (fn.variable === variable) return fn;
  }
  return null;
}

/**
 * Check if a scope is a descendant of the given ancestor scope.
 */
function isScopeDescendant(scope: ScopeEntity, ancestor: ScopeEntity): boolean {
  let current = scope;
  while (current !== ancestor) {
    const parent = current.parent;
    if (!parent) return false;
    current = parent;
  }
  return true;
}

/**
 * Build fix to convert createEffect/createRenderEffect to onMount.
 */
function buildFix(effectNode: ts.CallExpression | ts.NewExpression, name: string, graph: SolidGraph): Fix | undefined {
  if (!ts.isIdentifier(effectNode.expression) || effectNode.expression.text !== name) {
    return undefined;
  }
  const replaceFix = { range: [effectNode.expression.getStart(graph.sourceFile), effectNode.expression.end] as const, text: "onMount" };
  const importFix = buildSolidImportFix(graph, "onMount");
  return importFix ? [replaceFix, importFix] : [replaceFix];
}
