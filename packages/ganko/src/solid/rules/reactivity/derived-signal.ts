/**
 * Derived Signal Rule
 *
 * Detects functions that capture reactive values but are CALLED in untracked contexts.
 *
 * Problem:
 * A function that reads signals/stores/props is a reactive accessor. Unlike `createMemo`,
 * it has no caching or tracking of its own — it just reads signals when called. If called
 * outside a tracking scope (effect, memo, JSX), the result is a one-time snapshot that
 * never updates when the underlying signals change.
 *
 * Strategy - Report on call site, not definition:
 * 1. Find functions that capture reactive variables
 * 2. Find the variable that holds the function (e.g., `const getDoubled = () => ...`)
 * 3. Find all places where that variable is called (reads where parent is CallExpression)
 * 4. Report on calls that happen in untracked contexts with specific, actionable messages
 *
 * Examples:
 * - BAD:  const fn = () => count(); fn(); // called at module scope
 * - BAD:  const fn = () => count(); const x = fn(); // called in untracked context
 * - GOOD: const fn = () => count(); createEffect(() => fn()); // called in tracked context
 * - GOOD: const fn = () => count(); return <div>{fn()}</div>; // called in JSX
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import type { FunctionEntity, ReadEntity, TrackingContext } from "../../entities";
import {
  isInsideJSXExpression,
  getEnclosingFunctionName,
  getEnclosingSyncCallbackMethod,
  getEnclosingComponentName,
  getEffectiveTrackingContext,
  isPassthroughPosition,
  isReachableFromTrackedContext,
  buildDerivedFunctionMap,
  getContainingFunction,
} from "../../queries";
import { isCalleeRead, formatVariableNames, getDeclaratorName } from "../../util";
import { HOOK_PATTERN, COMPONENT_PATTERN } from "@ganko/shared";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";

function isTrackedContext(ctx: TrackingContext): boolean {
  return ctx.type === "tracked" || ctx.type === "jsx-expression";
}

/**
 * A boundary function represents a reactive scope boundary where calling a
 * derived function produces a one-time snapshot that won't update. Non-boundary
 * functions are intermediate helpers where Solid's dynamic Listener tracking
 * means transitive signal reads work correctly.
 */
function isBoundaryFunction(graph: SolidGraph, fn: FunctionEntity): boolean {
  if (graph.componentScopes.has(fn.scope)) return true;

  const ctx = fn.scope._resolvedContext;
  if (ctx?.type === "untracked") return true;

  const fnParent = fn.node.parent;
  if (fnParent?.type === "JSXExpressionContainer") return true;

  if (fnParent?.type === "CallExpression" && fnParent.callee !== fn.node) {
    const call = graph.callsByNode.get(fnParent);
    if (call?.primitive) return true;
  }

  return false;
}

const messages = {
  moduleScopeInit:
    "Assigning '{{fnName}}()' to '{{varName}}' at module scope runs once at startup. It captures {{vars}} which won't trigger updates.",
  moduleScopeCall:
    "'{{fnName}}()' at module scope executes once when the module loads. It captures {{vars}}—changes won't cause this to re-run.",
  componentTopLevelInit:
    "'{{fnName}}()' assigned to '{{varName}}' in '{{componentName}}' captures a one-time snapshot of {{vars}}. Changes won't update '{{varName}}'. Call in JSX or use createMemo().",
  componentTopLevelCall:
    "'{{fnName}}()' at top-level of '{{componentName}}' runs once and captures a snapshot of {{vars}}. Changes won't re-run this. Move inside JSX: {{{fnName}}()} or wrap with createMemo().",
  utilityFnCall:
    "'{{fnName}}()' inside '{{utilityName}}' won't be reactive. Call '{{utilityName}}' from a tracked scope (createEffect, JSX), or pass {{vars}} as parameters.",
  syncCallbackCall:
    "'{{fnName}}()' inside {{methodName}}() callback runs outside a tracking scope. The result captures a snapshot of {{vars}} that won't update.",
  untrackedCall:
    "'{{fnName}}()' called in an untracked context. It captures {{vars}} which won't trigger updates here. Move to JSX or a tracked scope.",
} as const;

interface MessageInfo {
  messageId: keyof typeof messages
  data: Record<string, string>
}

const options = {};

export const derivedSignal = defineSolidRule({
  id: "derived-signal",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect functions that capture reactive values but are called in untracked contexts",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const derivedByVar = buildDerivedFunctionMap(graph);
    if (derivedByVar.size === 0) return;

    for (const [variable, fnInfo] of derivedByVar) {
      // Cache formatted variable names per function (same for all reads)
      let formattedVars: string | null = null;

      const reads = variable.reads;
      for (let j = 0, rlen = reads.length; j < rlen; j++) {
        const read = reads[j];
        if (!read) continue;

        if (!isCalleeRead(read)) continue;
        if (isPassthroughPosition(graph, read.node)) continue;
        if (isInsideJSXExpression(read.node)) continue;

        const callContext = getEffectiveTrackingContext(graph, read.scope);
        if (isTrackedContext(callContext)) continue;
        // Deferred contexts (event handlers, onMount, onCleanup) intentionally read current values
        if (callContext.type === "deferred") continue;
        // on() callbacks are untracked for dependency purposes but re-run when
        // on()'s explicit deps change. Signal reads inside get fresh values on
        // each re-run — not stale snapshots.
        if (callContext.type === "untracked" && callContext.source === "on") continue;
        // Component bodies run in untrack() — skip reachability for direct component-level calls
        if (callContext.type !== "component-body" &&
          isReachableFromTrackedContext(graph, read.node, { treatHooksAsTracked: true }))
          continue;

        // Skip calls inside non-boundary functions. Solid tracks signals
        // transitively via the runtime Listener — a helper calling a derived
        // function for its return value will track correctly when eventually
        // called from a tracked context. Boundary functions (components, flow
        // component callbacks, Solid primitive arguments) represent reactive
        // scope boundaries where snapshot reads are genuinely problematic.
        const enclosingFn = getContainingFunction(graph, read.node);
        if (enclosingFn && !isBoundaryFunction(graph, enclosingFn)) {
          continue;
        }

        // Lazy format: only format once when first diagnostic is found
        if (formattedVars === null) {
          formattedVars = formatVariableNames(fnInfo.captures);
        }
        const { messageId, data } = getSpecificMessage(graph, read, variable.name, formattedVars);
        const msg = resolveMessage(messages[messageId], data);

        emit(createDiagnostic(graph.file, read.node, "derived-signal", messageId, msg, "error"));
      }
    }
  },
});

/**
 * Determine the most specific error message for a derived signal function call.
 *
 * Maps the call context to a specific message:
 * - Module scope (init/call): Different message for assignment vs expression
 * - Component top-level: Different message for assignment vs expression
 * - Sync callback (map, filter, etc.): Method-specific message
 * - Utility function: Explains function won't be reactive
 * - Generic fallback: Generic untracked context message
 *
 * @param _graph - The program graph (unused but kept for consistency)
 * @param read - The read/call of the derived signal function
 * @param fnName - The derived signal function name
 * @param vars - Formatted list of captured reactive variables
 * @returns Object with messageId and data for error message templating
 */
function getSpecificMessage(
  _graph: SolidGraph,
  read: ReadEntity,
  fnName: string,
  vars: string,
): MessageInfo {
  const node = read.node;
  // read.node is the identifier (e.g., `doubled`)
  // Its parent is the CallExpression (e.g., `doubled()`)
  // We need the CallExpression's parent to understand the context
  const callExpr = node.parent;
  const callParent = callExpr?.parent;

  if (read.scope.isModuleScope) {
    return getModuleScopeMessage(node, callExpr, callParent, fnName, vars);
  }

  // Check for component top-level
  const componentName = getEnclosingComponentName(node);
  if (componentName) {
    return getComponentTopLevelMessage(node, callExpr, callParent, fnName, vars, componentName);
  }

  // Check for sync callback (map, filter, find, etc.)
  const syncMethod = getEnclosingSyncCallbackMethod(node);
  if (syncMethod) {
    return {
      messageId: "syncCallbackCall",
      data: { fnName, vars, methodName: syncMethod },
    };
  }

  const utilityName = getEnclosingFunctionName(node);
  if (utilityName && !HOOK_PATTERN.test(utilityName) && !COMPONENT_PATTERN.test(utilityName)) {
    return {
      messageId: "utilityFnCall",
      data: { fnName, vars, utilityName },
    };
  }

  return {
    messageId: "untrackedCall",
    data: { fnName, vars },
  };
}

/**
 * Get the specific error message for a derived signal called at module scope.
 *
 * Module scope code runs only once when the module loads. If the call
 * is assigned to a variable, we report that the assignment is problematic.
 * Otherwise, we report the generic module scope call.
 *
 * @param _node - The identifier node (unused)
 * @param _callExpr - The call expression (unused)
 * @param callParent - The parent of the call expression (used to detect assignments)
 * @param fnName - The function name
 * @param vars - Formatted list of captured reactive variables
 * @returns Error message info
 */
function getModuleScopeMessage(
  _node: T.Node,
  _callExpr: T.Node | undefined,
  callParent: T.Node | undefined,
  fnName: string,
  vars: string,
): MessageInfo {
  // Check if assigned to a variable: const x = fn();
  if (callParent?.type === "VariableDeclarator") {
    const varName = getDeclaratorName(callParent);
    if (varName) {
      return {
        messageId: "moduleScopeInit",
        data: { fnName, vars, varName },
      };
    }
  }

  // Generic module scope call (covers console.log, function args, standalone calls, etc.)
  return {
    messageId: "moduleScopeCall",
    data: { fnName, vars },
  };
}

/**
 * Get the specific error message for a reactive accessor called at component top-level.
 *
 * Solid.js components run ONCE inside `untrack()` (see `createComponent` in solid source).
 * Calls at component top-level capture a one-time snapshot that never updates when the
 * underlying signals change. If assigned to a variable, we report the assignment;
 * otherwise, the call itself.
 *
 * Recommendations: Use in JSX or wrap with createMemo().
 *
 * @param _node - The identifier node (unused)
 * @param _callExpr - The call expression (unused)
 * @param callParent - The parent of the call expression (used to detect assignments)
 * @param fnName - The function name
 * @param vars - Formatted list of captured reactive variables
 * @param componentName - The component function name
 * @returns Error message info
 */
function getComponentTopLevelMessage(
  _node: T.Node,
  _callExpr: T.Node | undefined,
  callParent: T.Node | undefined,
  fnName: string,
  vars: string,
  componentName: string,
): MessageInfo {
  // Check if assigned to a variable: const x = fn();
  if (callParent?.type === "VariableDeclarator") {
    const varName = getDeclaratorName(callParent);
    if (varName) {
      return {
        messageId: "componentTopLevelInit",
        data: { fnName, vars, varName, componentName },
      };
    }
  }

  // Generic component top-level call
  return {
    messageId: "componentTopLevelCall",
    data: { fnName, vars, componentName },
  };
}
