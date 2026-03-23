/**
 * No Top-Level Signal Call Rule
 *
 * Detects signals called at component top-level, which captures dead snapshots.
 *
 * Problem:
 * Solid.js components run ONCE inside `untrack()`. When a signal is called at
 * the top level of a component function, it captures a one-time snapshot that
 * never updates when the signal changes. The stored value becomes stale.
 *
 * Examples:
 * - BAD:  const value = count(); return <div>{value}</div>
 * - GOOD: return <div>{count()}</div>
 * - GOOD: const doubled = createMemo(() => count() * 2);
 *
 * Solution:
 * Either call signals directly in JSX expressions (which create implicit
 * tracking effects), or wrap derived computations in createMemo().
 */

import ts from "typescript";
import type { ReadEntity } from "../../entities/variable";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import { isInsideJSXExpression, getEnclosingSyncCallbackMethod } from "../../queries/parent-chain";
import { getDeclaratorName, isEarlyReturnPattern } from "../../util";
import { iterateReactiveReads } from "../../queries/iterate";
import { getEnclosingComponentScope } from "../../queries/scope";
import { isInSyncCallbackAtTopLevel, isInsideValueSemanticArg } from "../../queries/trace";

/**
 * Message info for error message templating.
 */
interface MessageInfo {
  messageId: string;
  data: Record<string, string>;
}

const messages = {
  assignedToVar:
    "'{{name}}()' assigned to '{{varName}}' in {{componentName}} captures a one-time snapshot. " +
    "'{{varName}}' won't update when {{name}} changes. Use createMemo(): `const {{varName}} = createMemo(() => {{name}}());`",
  computedValue:
    "'{{name}}()' in computation at top-level of {{componentName}} captures a stale snapshot. " +
    "Wrap with createMemo(): `const {{varName}} = createMemo(() => /* computation using {{name}}() */);`",
  templateLiteral:
    "'{{name}}()' in template literal at top-level of {{componentName}} captures a stale snapshot. " +
    "Use createMemo() or compute directly in JSX: `{`Hello, ${{{name}}()}!`}`",
  destructuring:
    "Destructuring '{{name}}()' at top-level of {{componentName}} captures a stale snapshot. " +
    "Access properties in JSX or createMemo(): `{{{name}}().propertyName}`",
  objectLiteral:
    "'{{name}}()' in object literal at top-level of {{componentName}} captures a stale snapshot. " +
    "Use createMemo() for the object, or spread in JSX.",
  arrayCreation:
    "'{{name}}()' in array creation at top-level of {{componentName}} captures a stale snapshot. " +
    "Wrap with createMemo(): `const items = createMemo(() => Array.from(...));`",
  earlyReturn:
    "'{{name}}()' in early return at top-level of {{componentName}} captures a stale snapshot. " +
    "Use <Show when={{{name}}()}> for conditional rendering instead.",
  conditionalAssign:
    "'{{name}}()' in ternary at top-level of {{componentName}} captures a stale snapshot. " +
    "Use createMemo() or compute in JSX: `{{{name}}() ? 'Yes' : 'No'}`",
  functionArgument:
    "'{{name}}()' passed as argument at top-level of {{componentName}} captures a stale snapshot. " +
    "Move to createEffect() or compute in JSX.",
  syncCallback:
    "'{{name}}()' inside {{methodName}}() at top-level of {{componentName}} captures a stale snapshot. " +
    "Wrap the entire computation in createMemo(): `const result = createMemo(() => items.{{methodName}}(...));`",
  topLevelCall:
    "'{{name}}()' at top-level of {{componentName}} captures a one-time snapshot. " +
    "Changes to {{name}} won't update the result. Call directly in JSX or wrap in createMemo().",
} as const;

const options = {}

export const noTopLevelSignalCall = defineSolidRule({
  id: "no-top-level-signal-call",
  severity: "error",
  messages,
  meta: {
    description: "Disallow calling signals at component top-level (captures stale snapshots)",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const componentScopes = graph.componentScopes;

    if (componentScopes.size === 0) {
      return;
    }

    iterateReactiveReads(graph, (variable, read) => {
      // Only care about actual calls (signal())
      if (!read.isProperAccess) return;

      // JSX expression reads are fine - they create fine-grained subscriptions
      if (isInsideJSXExpression(read.node)) return;

      // Signal calls inside value-semantic primitive args (e.g. createSignal's
      // initial value) are intentional one-shot snapshots, not stale reads
      if (isInsideValueSemanticArg(graph, read.node)) return;

      // Check if this read's scope is a component scope
      const componentInfo = componentScopes.get(read.scope);

      if (componentInfo) {
        // Direct top-level read in component scope
        const { messageId, data } = getSpecificMessage(
          read,
          variable.name,
          componentInfo.name,
          null,
        );
        emit(createDiagnostic(
          graph.filePath,
          read.node,
          graph.sourceFile,
          "no-top-level-signal-call",
          messageId,
          resolveMessage(messages[messageId as keyof typeof messages], data),
          "error",
        ));
        return;
      }

      // Check if in a sync callback at component top-level
      const enclosingComponent = getEnclosingComponentScope(graph, read.scope);
      if (enclosingComponent) {
        const syncMethod = getEnclosingSyncCallbackMethod(read.node);
        if (syncMethod && isInSyncCallbackAtTopLevel(graph, read.node, enclosingComponent.scope)) {
          const syncData = {
            name: variable.name,
            methodName: syncMethod,
            componentName: enclosingComponent.name,
          };
          emit(createDiagnostic(
            graph.filePath,
            read.node,
            graph.sourceFile,
            "no-top-level-signal-call",
            "syncCallback",
            resolveMessage(messages.syncCallback, syncData),
            "error",
          ));
        }
      }
    });
  },
});

/**
 * Pattern information detected in a single parent chain walk.
 */
interface PatternInfo {
  isEarlyReturn: boolean;
  isFunctionArgument: boolean;
  isDestructuring: boolean;
  isTemplateLiteral: boolean;
  isObjectLiteral: boolean;
  isArrayCreation: boolean;
  isConditional: boolean;
  isComputation: boolean;
  varDeclarator: ts.VariableDeclaration | null;
}

const patternCache = new WeakMap<ts.Node, PatternInfo>();

const EMPTY_PATTERN_INFO: PatternInfo = Object.freeze({
  isEarlyReturn: false,
  isFunctionArgument: false,
  isDestructuring: false,
  isTemplateLiteral: false,
  isObjectLiteral: false,
  isArrayCreation: false,
  isConditional: false,
  isComputation: false,
  varDeclarator: null,
});

/**
 * Detect all patterns in a single parent chain walk.
 *
 * Uses a cache to avoid re-analyzing the same node. Walks up the AST tree
 * once to detect all relevant patterns (early return, destructuring, etc.).
 *
 * @param callExpr - The call expression to analyze
 * @returns Object containing all detected pattern flags
 */
function detectPatterns(callExpr: ts.Node | undefined): PatternInfo {
  if (!callExpr) return EMPTY_PATTERN_INFO;

  const cached = patternCache.get(callExpr);
  if (cached) return cached;

  const result = computePatterns(callExpr);
  patternCache.set(callExpr, result);
  return result;
}

/**
 * Core logic for detectPatterns.
 *
 * Walks the AST parent chain from the call expression to the nearest
 * function/statement boundary, detecting patterns like destructuring,
 * template literals, conditional expressions, etc.
 *
 * @param callExpr - The call expression to analyze
 * @returns Object with flags for each detected pattern type
 */
function computePatterns(callExpr: ts.Node): PatternInfo {
  const result: PatternInfo = {
    isEarlyReturn: false,
    isFunctionArgument: false,
    isDestructuring: false,
    isTemplateLiteral: false,
    isObjectLiteral: false,
    isArrayCreation: false,
    isConditional: false,
    isComputation: false,
    varDeclarator: null,
  };

  const immediateParent = callExpr.parent;

  // Function argument check: signal() passed as argument to any function call
  // e.g., console.log(signal()), myFunc(signal()), arr.map(x => signal())
  if (immediateParent && ts.isCallExpression(immediateParent) && immediateParent.expression !== callExpr) {
    result.isFunctionArgument = true;
  }

  // Computation check (binary expression on immediate parent)
  if (immediateParent && ts.isBinaryExpression(immediateParent)) {
    result.isComputation = true;
  }

  let current: ts.Node | undefined = callExpr.parent;
  while (current) {
    if (ts.isIfStatement(current)) {
      // Check for early return pattern: if (!signal()) return null;
      if (isEarlyReturnPattern(current)) {
        result.isEarlyReturn = true;
      }
    } else if (ts.isTemplateExpression(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      result.isTemplateLiteral = true;
    } else if (ts.isObjectLiteralExpression(current)) {
      result.isObjectLiteral = true;
    } else if (ts.isArrayLiteralExpression(current)) {
      result.isArrayCreation = true;
    } else if (ts.isConditionalExpression(current)) {
      result.isConditional = true;
    } else if (ts.isCallExpression(current)) {
      // Check for Array.from(...) pattern
      const callee = current.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Array"
      ) {
        result.isArrayCreation = true;
      }
    } else if (ts.isVariableDeclaration(current)) {
      result.varDeclarator = current;

      if (ts.isObjectBindingPattern(current.name) || ts.isArrayBindingPattern(current.name)) {
        result.isDestructuring = true;
      }

      return result;
    } else if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isExpressionStatement(current) ||
      ts.isReturnStatement(current)
    ) {
      return result;
    }

    current = current.parent;
  }

  return result;
}

/**
 * Determine the most specific message for this top-level signal call.
 *
 * Uses pattern detection to select the most helpful error message.
 * Checks patterns in priority order (early return, destructuring, etc.)
 * and returns the first match, or a generic message if no pattern matches.
 *
 * @param read - The signal read entity
 * @param signalName - The name of the signal variable
 * @param componentName - The name of the containing component
 * @param _syncMethod - The sync method name (unused, for future use)
 * @returns Object with messageId and data for error message templating
 */
function getSpecificMessage(
  read: ReadEntity,
  signalName: string,
  componentName: string,
  _syncMethod: string | null,
): MessageInfo {
  const node = read.node;
  const callExpr = node.parent;
  const baseData = { name: signalName, componentName };

  const patterns = detectPatterns(callExpr);
  const varName = patterns.varDeclarator ? getVariableName(patterns.varDeclarator) : null;

  // Check for early return: if (!signal()) return null;
  if (patterns.isEarlyReturn) {
    return {
      messageId: "earlyReturn",
      data: baseData,
    };
  }

  // Check for destructuring: const { a, b } = signal();
  if (patterns.isDestructuring) {
    return {
      messageId: "destructuring",
      data: baseData,
    };
  }

  // Check for template literal: const msg = `Hello ${name()}`;
  if (patterns.isTemplateLiteral) {
    return {
      messageId: "templateLiteral",
      data: { ...baseData, varName: varName || "value" },
    };
  }

  // Check for array creation BEFORE object literal (Array.from uses object args)
  if (patterns.isArrayCreation) {
    return {
      messageId: "arrayCreation",
      data: { ...baseData, varName: varName || "items" },
    };
  }

  // Check for object literal: const obj = { key: signal() };
  if (patterns.isObjectLiteral) {
    return {
      messageId: "objectLiteral",
      data: { ...baseData, varName: varName || "obj" },
    };
  }

  // Check for ternary/conditional: const status = isActive() ? "on" : "off";
  if (patterns.isConditional) {
    return {
      messageId: "conditionalAssign",
      data: { ...baseData, varName: varName || "value" },
    };
  }

  // Check for computation: const doubled = count() * 2;
  if (patterns.isComputation) {
    return {
      messageId: "computedValue",
      data: { ...baseData, varName: varName || "computed" },
    };
  }

  // Simple assignment: const value = signal();
  if (varName) {
    return {
      messageId: "assignedToVar",
      data: { ...baseData, varName },
    };
  }

  // Function argument fallback: signal() passed to any function (e.g., console.log, custom fn)
  // This is low priority - only used when not part of a variable assignment
  if (patterns.isFunctionArgument) {
    return {
      messageId: "functionArgument",
      data: baseData,
    };
  }

  return {
    messageId: "topLevelCall",
    data: baseData,
  };
}

const getVariableName = getDeclaratorName;
