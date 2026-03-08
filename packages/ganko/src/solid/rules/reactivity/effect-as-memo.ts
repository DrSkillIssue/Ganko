/**
 * Effect As Memo Rule
 *
 * Detect `createEffect` being used to store a derived value
 * (should use `createMemo` instead).
 *
 * This pattern is common when developers migrate from React but forget
 * that Solid has a dedicated primitive for memoization.
 *
 * Problem pattern:
 * ```
 * const [doubled, setDoubled] = createSignal(0);
 * createEffect(() => { setDoubled(count() * 2); });
 * ```
 *
 * Better approach:
 * ```
 * const doubled = createMemo(() => count() * 2);
 * ```
 *
 * Why createMemo is better:
 * - Expresses intent (storing a derived value, not side effects)
 * - Avoids unnecessary setter calls
 * - Clearer semantics for derived values
 * - Rule provides auto-fix to convert automatically
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { Fix } from "../../../diagnostic"
import type { CallEntity, VariableEntity, ScopeEntity } from "../../entities";
import { getVariableByNameInScope } from "../../queries/scope";
import { truncateText } from "../../util";
import { extractSignalDestructures, getContainingStatement, getStatementLineStart, getStatementEndWithNewline } from "../util";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";

const messages = {
  effectAsMemo:
    "This createEffect only computes a derived value. Use createMemo() instead: const {{signalName}} = createMemo(() => {{expression}});",
} as const;

const options = {};

export const effectAsMemo = defineSolidRule({
  id: "effect-as-memo",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect createEffect that only sets a derived signal value, which should be createMemo instead",
    fixable: true,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const createEffects = graph.callsByPrimitive.get("createEffect") ?? [];
    const renderEffects = graph.callsByPrimitive.get("createRenderEffect") ?? [];
    const signalCalls = graph.callsByPrimitive.get("createSignal") ?? [];

    const effectCalls = renderEffects.length > 0
      ? [...createEffects, ...renderEffects]
      : createEffects;

    if (effectCalls.length === 0) {
      return;
    }

    // Extract effect candidates (effects with single setter pattern)
    const effectCandidates: EffectCandidate[] = [];
    for (let i = 0, len = effectCalls.length; i < len; i++) {
      const effectCall = effectCalls[i];
      if (!effectCall) continue;
      const candidate = extractEffectCandidate(effectCall);
      if (candidate) {
        effectCandidates.push(candidate);
      }
    }

    if (effectCandidates.length === 0) {
      return;
    }

    // Build setter map from signal calls (lazy - only if we have candidates)
    const destructures = extractSignalDestructures(signalCalls, graph);
    if (destructures.length === 0) {
      return;
    }

    const setterToSignalMap = new Map<string, SignalInfo>();
    for (let j = 0, dlen = destructures.length; j < dlen; j++) {
      const d = destructures[j];
      if (!d) continue;
      setterToSignalMap.set(d.setterName, {
        variable: d.signalVariable,
        signalName: d.signalName,
        setterName: d.setterName,
        declarationNode: d.declarator,
      });
    }

    for (let i = 0, candidateLen = effectCandidates.length; i < candidateLen; i++) {
      const candidate = effectCandidates[i];
      if (!candidate) continue;
      const { call, setterInfo, callbackNode: _callbackNode } = candidate;
      const { setterName, argument, setterCallNode } = setterInfo;

      const signalInfo = setterToSignalMap.get(setterName);
      if (!signalInfo) {
        continue;
      }

      if (!isScopeAccessible(call.scope, signalInfo.variable.scope)) {
        continue;
      }

      // Verify the setter is only used inside this effect (safe to remove)
      const setterVar = getVariableByNameInScope(graph, setterName, call.scope);
      if (setterVar && hasReadsOutsideNode(setterVar, call.node)) {
        continue;
      }

      const expressionText = truncateText(graph.sourceCode.getText(argument));

      const fix = buildFix(graph.sourceCode, call.node, signalInfo, argument);

      emit(
        createDiagnostic(
          graph.file,
          setterCallNode,
          "effect-as-memo",
          "effectAsMemo",
          resolveMessage(messages.effectAsMemo, {
            signalName: signalInfo.signalName,
            expression: expressionText,
          }),
          "error",
          fix,
        ),
      );
    }
  },
});

interface SignalInfo {
  variable: VariableEntity;
  signalName: string;
  setterName: string;
  declarationNode: T.VariableDeclarator;
}

interface SetterCallInfo {
  setterName: string;
  argument: T.Node;
  setterCallNode: T.CallExpression;
}

interface EffectCandidate {
  call: CallEntity;
  setterInfo: SetterCallInfo;
  callbackNode: T.ArrowFunctionExpression | T.FunctionExpression;
}

/**
 * Extract an effect candidate if the call has a single setter pattern.
 *
 * An effect is a candidate if it calls a single setter function with one argument.
 * For example: `createEffect(() => setSomething(computed()))`
 *
 * Returns null if:
 * - The effect has no callback
 * - The callback isn't a function expression
 * - The function body doesn't contain exactly one setter call
 *
 * @param call - The createEffect call to analyze
 * @returns Candidate info or null if not a match
 */
function extractEffectCandidate(call: CallEntity): EffectCandidate | null {
  // Must have at least one argument (the callback)
  const callbackArg = call.arguments[0];
  if (!callbackArg) {
    return null;
  }

  const callbackNode = callbackArg.node;
  // Direct type check for TypeScript narrowing (isFunctionExpression doesn't narrow)
  if (callbackNode.type !== "ArrowFunctionExpression" && callbackNode.type !== "FunctionExpression") {
    return null;
  }

  // Async effects cannot be converted to createMemo (returns Promise<T> not T)
  if (callbackNode.async) {
    return null;
  }

  const setterInfo = extractSingleSetterCall(callbackNode);
  if (!setterInfo) {
    return null;
  }

  return { call, setterInfo, callbackNode };
}

/**
 * Extract setter call info from an effect callback if it contains only one statement.
 *
 * Handles three patterns:
 * 1. `() => setSetter(expr)` - Arrow with expression body
 * 2. `() => { setSetter(expr); }` - Block with expression statement
 * 3. `() => { return setSetter(expr); }` - Block with return statement
 *
 * Returns null if the function does anything other than call a setter once.
 *
 * @param fn - The effect callback function to analyze
 * @returns Setter call info or null if not a single setter pattern
 */
function extractSingleSetterCall(
  fn: T.ArrowFunctionExpression | T.FunctionExpression,
): SetterCallInfo | null {
  const body = fn.body;

  // Arrow function with expression body: () => setSetter(expr)
  if (body.type !== "BlockStatement") {
    return extractSetterFromExpression(body);
  }

  // Block body - must contain exactly one statement
  const statements = body.body;
  if (statements.length !== 1) {
    return null;
  }

  const stmt = statements[0];
  if (!stmt) return null;

  // ExpressionStatement: { setSetter(expr); }
  if (stmt.type === "ExpressionStatement") {
    return extractSetterFromExpression(stmt.expression);
  }

  // ReturnStatement: { return setSetter(expr); }
  if (stmt.type === "ReturnStatement" && stmt.argument) {
    return extractSetterFromExpression(stmt.argument);
  }

  return null;
}

/**
 * Extract setter call info from an expression node.
 *
 * The expression must be a call expression with:
 * - Identifier callee (the setter function)
 * - Exactly one argument (the new value)
 * - No spread elements
 *
 * @param expr - The expression to analyze
 * @returns Setter call info or null if not a setter call
 */
function extractSetterFromExpression(expr: T.Expression): SetterCallInfo | null {
  if (expr.type !== "CallExpression") {
    return null;
  }

  // Callee must be an identifier (the setter function)
  if (expr.callee.type !== "Identifier") {
    return null;
  }

  if (expr.arguments.length !== 1) {
    return null;
  }

  const arg = expr.arguments[0];
  if (!arg) return null;

  if (arg.type === "SpreadElement") {
    return null;
  }

  // Setter function form: setCount(prev => prev + 1) cannot be converted to createMemo
  if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
    return null;
  }

  return {
    setterName: expr.callee.name,
    argument: arg,
    setterCallNode: expr,
  };
}

/**
 * Check if a target scope is accessible from the current scope.
 *
 * Scope is accessible if the target scope is the same as or a parent
 * of the current scope. This ensures the signal variable is in scope
 * for using it in a createMemo() replacement.
 *
 * @param currentScope - The current/read scope
 * @param targetScope - The scope where the signal is defined
 * @returns True if target scope is accessible from current scope
 */
function isScopeAccessible(
  currentScope: ScopeEntity | null,
  targetScope: ScopeEntity,
): boolean {
  let scope: ScopeEntity | null = currentScope;
  while (scope) {
    if (scope === targetScope) {
      return true;
    }
    scope = scope.parent;
  }
  return false;
}

/**
 * Build the fix to convert createEffect + signal to createMemo.
 *
 * Transform:
 * ```tsx
 * const [doubled, setDoubled] = createSignal(0);
 * createEffect(() => { setDoubled(count() * 2); });
 * ```
 *
 * To:
 * ```tsx
 * const doubled = createMemo(() => count() * 2);
 * ```
 *
 * @param sourceCode - ESLint's source code object for text extraction
 * @param effectNode - The createEffect call expression to remove
 * @param signalInfo - Information about the signal being replaced
 * @param callbackNode - The effect callback function node
 * @param argument - The argument passed to the setter (becomes memo body)
 * @returns Fix operations or undefined if fix cannot be applied
 */
function buildFix(
  sourceCode: { text: string; getText(node: T.Node): string },
  effectNode: T.CallExpression | T.NewExpression,
  signalInfo: SignalInfo,
  argument: T.Node,
): Fix | undefined {
  const effectStatement = getContainingStatement(effectNode);
  const signalStatement = getContainingStatement(signalInfo.declarationNode);

  if (!effectStatement || !signalStatement) {
    return undefined;
  }

  let expressionText = sourceCode.getText(argument);

  // () => { x: 1 } is a labeled statement, () => ({ x: 1 }) is an object
  if (argument.type === "ObjectExpression") {
    expressionText = `(${expressionText})`;
  }

  const memoText = `const ${signalInfo.signalName} = createMemo(() => ${expressionText});`;

  // Create fix operations:
  // 1. Replace signal declaration with memo
  // 2. Remove effect statement (including leading whitespace and trailing newline)
  return [
    {
      range: [signalStatement.range[0], signalStatement.range[1]] as const,
      text: memoText,
    },
    {
      range: [getStatementLineStart(sourceCode.text, effectStatement), getStatementEndWithNewline(sourceCode.text, effectStatement)] as const,
      text: "",
    },
  ];
}

/**
 * Check if a variable has reads outside a given AST node.
 *
 * Used to verify a setter is only referenced inside its effect callback.
 * If the setter is passed to another function or read elsewhere, the fix
 * would break that code by removing the setter.
 *
 * @param variable - The variable to check reads for
 * @param container - The AST node to check containment against
 * @returns True if the variable has reads outside the container
 */
function hasReadsOutsideNode(variable: VariableEntity, container: T.Node): boolean {
  const containerRange = container.range;
  const reads = variable.reads;
  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const range = read.node.range;
    if (range[0] < containerRange[0] || range[1] > containerRange[1]) {
      return true;
    }
  }
  return false;
}
