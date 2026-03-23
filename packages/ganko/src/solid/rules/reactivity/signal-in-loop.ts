/**
 * Signal In Loop Rule
 *
 * Detects problematic signal usage inside loop callbacks (For/Index children).
 *
 * Detects three patterns:
 *
 * 1. Signal Creation (signalInLoop):
 *    Creating signals inside <For> or <Index> callbacks creates new signal instances
 *    on each render. The callback runs for each array item, and signals created inside
 *    are not preserved across re-renders.
 *
 * 2. Loop-Invariant Signal Calls (signalCallInvariant):
 *    Signal calls inside loops that don't depend on the loop item/index produce the
 *    same value for every iteration. These should be extracted before the loop.
 *
 * 3. Loop-Invariant Derived Calls (derivedCallInvariant):
 *    Function calls that capture reactive variables but don't use the loop item/index.
 *    The function recalculates the same value for every iteration.
 */

import ts from "typescript";
import type { Diagnostic } from "../../../diagnostic"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type {
  CallEntity,
  JSXElementEntity,
  ScopeEntity,
  VariableEntity,
  FunctionEntity,
} from "../../entities";
import {
  expressionReferencesAny,
  expressionReferencesAnyDeep,
  getContainingExpression,
  formatVariableNames,
  findFunctionChildExpression,
} from "../../util";
import { extractSignalDestructures, getFunctionBodyExpression } from "../util";
import {
  getDescendantScopes,
  getFunctionByNode,
  getCallsByPrimitive,
  iterateSignalLikeReads,
  getJSXElementsByTag,
  buildDerivedFunctionMap,
  isInDeferredContext,
  getVariableCallExpressions,
} from "../../queries";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";

const messages = {
  signalInLoop:
    "Creating signals inside <{{component}}> callback creates new signals on each render. Use a store at the parent level, or derive state from the index.",
  signalCallInvariant:
    "Signal '{{name}}' called inside <{{component}}> produces the same value for every item. Extract to a variable or memoize with createMemo() before the loop.",
  signalIndexedByLoop:
    "Signal '{{name}}' is indexed by a loop-dependent key inside <{{component}}>. Each item now depends on the entire signal value, so updating one key re-runs all items. Use createStore for keyed state or derive a per-item accessor outside the loop.",
  derivedCallInvariant:
    "'{{name}}()' inside <{{component}}> captures {{captures}} but doesn't use the loop item. Extract the call before the loop or pass the item as a parameter.",
} as const;

const options = {};

export const signalInLoop = defineSolidRule({
  id: "signal-in-loop",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect problematic signal usage inside For/Index loop callbacks",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    // Early return if no For/Index elements in the file
    const forElements = getJSXElementsByTag(graph, "For");
    const indexElements = getJSXElementsByTag(graph, "Index");
    if (forElements.length === 0 && indexElements.length === 0) {
      return;
    }

    const loopScopeIndex = buildLoopScopeIndex(graph, forElements, indexElements);
    if (loopScopeIndex.size === 0) {
      return;
    }

    const diagnostics: Diagnostic[] = [];
    const objectMapSignals = collectObjectMapSignals(graph);

    // Check 1: Signal/store creation inside loops
    checkSignalCreation(graph, loopScopeIndex, diagnostics, graph.filePath);

    // Check 2 & 3: Signal calls and derived function calls inside loops
    checkSignalCalls(graph, loopScopeIndex, objectMapSignals, diagnostics, graph.filePath);

    for (const diagnostic of diagnostics) {
      emit(diagnostic);
    }
  },
});

interface LoopCallbackInfo {
  element: JSXElementEntity;
  callbackFn: FunctionEntity;
  paramNames: Set<string>;
}

/**
 * Build a loop scope index that maps ALL scopes inside loop callbacks to their loop info.
 *
 * Creates a map from scope IDs to loop callback information. Includes both the
 * callback scope itself and all descendant scopes for lookup.
 *
 * @param graph - The program graph for scope analysis
 * @param forElements - All For elements in the file
 * @param indexElements - All Index elements in the file
 * @returns Map from scope ID to loop callback info
 */
/**
 * Collect all binding identifier names from a parameter or destructuring node.
 * Handles Identifier, ObjectPattern, ArrayPattern, AssignmentPattern, RestElement.
 */
function collectBindingNames(node: ts.Node, names: Set<string>): void {
  if (ts.isIdentifier(node)) {
    names.add(node.text)
  } else if (ts.isBindingElement(node)) {
    collectBindingNames(node.name, names)
  } else if (ts.isObjectBindingPattern(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i]
      if (!el) continue
      collectBindingNames(el, names)
    }
  } else if (ts.isArrayBindingPattern(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i]
      if (el && ts.isBindingElement(el)) collectBindingNames(el, names)
    }
  } else if (ts.isParameter(node)) {
    collectBindingNames(node.name, names)
  }
}

/**
 * Expand a set of loop-dependent names with local variables whose
 * initializers transitively reference any already-known dependent name.
 *
 * Given `(item, i) => { const key = rest.key(item); ... }`, `key` is
 * added because its initializer references `item`. This runs in
 * fixed-point: if `keyStr = String(key)` appears later, `keyStr` is
 * also added on the next pass.
 *
 * Uses `expressionReferencesAnyDeep` which traverses into arrow/function
 * expression bodies, because derived locals like
 * `const needsAnim = () => !markers().has(id)` capture `id` via closure
 * and should be recognized as loop-dependent.
 *
 * Only considers `const`/`let`/`var` declarations in the callback's
 * immediate body (BlockStatement).
 */
function expandWithDerivedLocals(body: ts.Block | ts.Expression, dependentNames: Set<string>): void {
  if (!ts.isBlock(body)) return;

  // Collect all variable declarations in the callback body (top level only)
  const decls: { name: string; init: ts.Expression }[] = [];
  for (let i = 0, len = body.statements.length; i < len; i++) {
    const stmt = body.statements[i];
    if (!stmt) continue;
    if (!ts.isVariableStatement(stmt)) continue;
    for (let j = 0, dlen = stmt.declarationList.declarations.length; j < dlen; j++) {
      const declarator = stmt.declarationList.declarations[j];
      if (!declarator) continue;
      if (!ts.isIdentifier(declarator.name)) continue;
      if (!declarator.initializer) continue;
      decls.push({ name: declarator.name.text, init: declarator.initializer });
    }
  }

  if (decls.length === 0) return;

  // Fixed-point: keep expanding until no new names are added
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0, len = decls.length; i < len; i++) {
      const decl = decls[i];
      if (!decl) continue;
      if (dependentNames.has(decl.name)) continue;
      if (expressionReferencesAnyDeep(decl.init, dependentNames)) {
        dependentNames.add(decl.name);
        changed = true;
      }
    }
  }
}

function buildLoopScopeIndex(
  graph: SolidGraph,
  forElements: readonly JSXElementEntity[],
  indexElements: readonly JSXElementEntity[],
): Map<number, LoopCallbackInfo> {
  const map = new Map<number, LoopCallbackInfo>();

  const processElements = (elements: readonly JSXElementEntity[]) => {
    for (const element of elements) {
      const callbackFn = findLoopCallback(graph, element);
      if (!callbackFn) continue;

      const paramNames = new Set<string>();
      for (const param of callbackFn.params) {
        collectBindingNames(param.node, paramNames)
      }

      // Expand with local variables derived from loop params
      if (callbackFn.body) {
        expandWithDerivedLocals(callbackFn.body, paramNames);
      }

      const info: LoopCallbackInfo = {
        element,
        callbackFn,
        paramNames,
      };

      map.set(callbackFn.scope.id, info);

      const descendants = getDescendantScopes(graph, callbackFn.scope);
      for (let i = 0, len = descendants.length; i < len; i++) {
        const desc = descendants[i];
        if (!desc) continue;
        map.set(desc.id, info);
      }
    }
  };

  processElements(forElements);
  processElements(indexElements);

  return map;
}

/**
 * Find the callback function for a For/Index element.
 *
 * The callback is typically a direct child expression that's a function.
 * Pattern: <For each={items}>{(item) => <div>{item}</div>}</For>
 *
 * @param graph - The program graph to look up function entities
 * @param element - The For/Index JSX element
 * @returns The callback function entity or null if not found
 */
function findLoopCallback(
  graph: SolidGraph,
  element: JSXElementEntity,
): FunctionEntity | null {
  const expr = findFunctionChildExpression(element.children);
  return expr ? getFunctionByNode(graph, expr) : null;
}

/**
 * Check if a scope is inside a loop callback.
 *
 * Uses the loop scope index for lookup.
 *
 * @param scope - The scope to check
 * @param loopScopeIndex - Map from scope IDs to loop callback info
 * @returns Loop callback info if scope is inside a loop, null otherwise
 */
function getLoopCallbackInfo(
  scope: ScopeEntity,
  loopScopeIndex: Map<number, LoopCallbackInfo>,
): LoopCallbackInfo | null {
  return loopScopeIndex.get(scope.id) ?? null;
}

/**
 * Check for createSignal/createStore calls inside loop callbacks.
 *
 * Creating signals/stores inside loops creates new instances on each render,
 * which is usually not the intended behavior.
 *
 * @param graph - The program graph to find signal/store calls
 * @param loopScopeIndex - Map from scope IDs to loop callback info
 * @param diagnostics - Array to add diagnostics to (mutated)
 */
function checkSignalCreation(
  graph: SolidGraph,
  loopScopeIndex: Map<number, LoopCallbackInfo>,
  diagnostics: Diagnostic[],
  file: string,
): void {
  const signalCalls = getCallsByPrimitive(graph, "createSignal");
  const storeCalls = getCallsByPrimitive(graph, "createStore");

  const checkCall = (call: CallEntity): void => {
    const loopInfo = getLoopCallbackInfo(call.scope, loopScopeIndex);
    if (!loopInfo) return;

    diagnostics.push(
      createDiagnostic(
        file,
        call.node,
        graph.sourceFile,
        "signal-in-loop",
        "signalInLoop",
        resolveMessage(messages.signalInLoop, { component: loopInfo.element.tag ?? "For" }),
        "error",
      ),
    );
  };

  for (const call of signalCalls) {
    checkCall(call);
  }

  for (const call of storeCalls) {
    checkCall(call);
  }
}

/**
 * Check for signal calls inside loop callbacks that don't depend on loop params.
 *
 * Signal calls that don't use the loop item/index produce the same value for
 * every iteration, causing unnecessary recomputation.
 *
 * @param graph - The program graph to find signal calls
 * @param loopScopeIndex - Map from scope IDs to loop callback info
 * @param diagnostics - Array to add diagnostics to (mutated)
 */
function checkSignalCalls(
  graph: SolidGraph,
  loopScopeIndex: Map<number, LoopCallbackInfo>,
  objectMapSignals: ReadonlySet<VariableEntity>,
  diagnostics: Diagnostic[],
  file: string,
): void {
  // Track which nodes we've already reported to avoid duplicates

  const reported = new WeakSet<ts.Node>();

  iterateSignalLikeReads(graph, (variable, read) => {
    // Only check actual calls (isProperAccess = true means it's called)
    if (!read.isProperAccess) return;

    // Skip memoized values - they're cached, so calling in loop is safe
    if (variable.isMemoVariable) return;

    const loopInfo = getLoopCallbackInfo(read.scope, loopScopeIndex);
    if (!loopInfo) return;

    // Event handlers fire on user interaction, not per-render iteration.
    // A loop-invariant signal call inside onClick is intentional.
    if (isInDeferredContext(graph, read.scope)) return;

    // (These are already caught by signalInLoop - no need to also flag their calls)
    if (isVariableDeclaredInLoop(variable, loopInfo, loopScopeIndex)) {
      return;
    }

    if (objectMapSignals.has(variable) && isLoopIndexedSignalRead(read.node, loopInfo.paramNames)) {
      if (reported.has(read.node)) return;
      reported.add(read.node);

      diagnostics.push(
        createDiagnostic(
          file,
          read.node,
          graph.sourceFile,
          "signal-in-loop",
          "signalIndexedByLoop",
          resolveMessage(messages.signalIndexedByLoop, {
            name: variable.name,
            component: loopInfo.element.tag ?? "For",
          }),
          "error",
        ),
      );
      return;
    }

    const containingExpr = getContainingExpression(read.node);

    if (expressionReferencesAny(containingExpr, loopInfo.paramNames)) {
      return; // Expression uses loop params, this is fine
    }

    if (reported.has(read.node)) return;
    reported.add(read.node);

    diagnostics.push(
      createDiagnostic(
        file,
        read.node,
        graph.sourceFile,
        "signal-in-loop",
        "signalCallInvariant",
        resolveMessage(messages.signalCallInvariant, {
          name: variable.name,
          component: loopInfo.element.tag ?? "For",
        }),
        "error",
      ),
    );
  });

  // Check derived function calls (functions that capture reactive variables)
  checkDerivedCalls(graph, loopScopeIndex, diagnostics, reported, file);
}

function isLoopIndexedSignalRead(readNode: ts.Node, loopParamNames: Set<string>): boolean {
  const parent = readNode.parent;
  if (!parent || !ts.isCallExpression(parent) || parent.expression !== readNode) {
    return false;
  }

  const accessorParent = parent.parent;
  if (!accessorParent || !ts.isElementAccessExpression(accessorParent) || accessorParent.expression !== parent) {
    return false;
  }

  const argument = accessorParent.argumentExpression;
  if (!argument) return false;

  return expressionReferencesAnyDeep(argument, loopParamNames);
}

function collectObjectMapSignals(graph: SolidGraph): ReadonlySet<VariableEntity> {
  const signalCalls = getCallsByPrimitive(graph, "createSignal");
  const destructures = extractSignalDestructures(signalCalls, graph);
  const result = new Set<VariableEntity>();

  for (let i = 0, len = destructures.length; i < len; i++) {
    const destructure = destructures[i];
    if (!destructure) continue;
    if (!isSignalUpdatedViaSpreadMapSetter(destructure.setterVariable)) continue;
    result.add(destructure.signalVariable);
  }

  return result;
}

function isSignalUpdatedViaSpreadMapSetter(setterVariable: VariableEntity): boolean {
  const calls = getVariableCallExpressions(setterVariable);

  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    if (isSpreadMapSetterCall(call)) return true;
  }

  return false;
}

function isSpreadMapSetterCall(call: ts.CallExpression): boolean {
  const firstArg = call.arguments[0];
  if (!firstArg) return false;

  if (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg)) {
    if (firstArg.parameters.length !== 1) return false;
    const param = firstArg.parameters[0];
    if (!param || !ts.isIdentifier(param.name)) return false;
    if (ts.isBlock(firstArg.body) && firstArg.body.statements.length !== 1) return false;
    const returned = getFunctionBodyExpression(firstArg);
    if (!returned || !ts.isParenthesizedExpression(returned) && !ts.isObjectLiteralExpression(returned)) return false;
    const expr = ts.isParenthesizedExpression(returned) ? returned.expression : returned;
    return isSpreadMapObjectLiteral(expr, param.name.text);
  }

  return false;
}

function isSpreadMapObjectLiteral(node: ts.Expression, paramName: string): boolean {
  if (!ts.isObjectLiteralExpression(node)) return false;

  let hasSpreadPrev = false;
  let hasComputedKeyWrite = false;

  for (let i = 0, len = node.properties.length; i < len; i++) {
    const prop = node.properties[i];
    if (!prop) continue;

    if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression) && prop.expression.text === paramName) {
      hasSpreadPrev = true;
      continue;
    }

    if (ts.isPropertyAssignment(prop) && prop.name && ts.isComputedPropertyName(prop.name)) {
      hasComputedKeyWrite = true;
    }
  }

  return hasSpreadPrev && hasComputedKeyWrite;
}

/**
 * Check if a variable is declared within the loop callback scope or its descendants.
 *
 * Variables declared in the loop are already flagged by signalInLoop, so we
 * skip reporting their calls to avoid duplicate diagnostics.
 *
 * @param variable - The variable to check
 * @param loopInfo - The loop callback info to check against
 * @param loopScopeIndex - Map from scope IDs to loop callback info
 * @returns True if the variable is declared in this specific loop callback
 */
function isVariableDeclaredInLoop(
  variable: VariableEntity,
  loopInfo: LoopCallbackInfo,
  loopScopeIndex: Map<number, LoopCallbackInfo>,
): boolean {
  // Check if the variable's scope is within this specific loop callback
  const varLoopInfo = loopScopeIndex.get(variable.scope.id);
  // Variable is in a loop AND it's the same loop callback
  return varLoopInfo === loopInfo;
}
/**
 * Check for derived function calls inside loop callbacks.
 *
 * A derived function is one that captures reactive variables. If called in a
 * loop without using the loop params, it recalculates the same value for every
 * iteration.
 *
 * @param graph - The program graph to find derived functions
 * @param loopScopeIndex - Map from scope IDs to loop callback info
 * @param diagnostics - Array to add diagnostics to (mutated)
 * @param reported - WeakSet to track already-reported nodes and avoid duplicates
 */
function checkDerivedCalls(
  graph: SolidGraph,
  loopScopeIndex: Map<number, LoopCallbackInfo>,
  diagnostics: Diagnostic[],
  reported: WeakSet<ts.Node>,
  file: string,
): void {
  const derivedFunctionsByVar = buildDerivedFunctionMap(graph);
  if (derivedFunctionsByVar.size === 0) return;

  for (const [variable, fnInfo] of derivedFunctionsByVar) {
    const reads = variable.reads;
    for (let i = 0, len = reads.length; i < len; i++) {
      const read = reads[i];
      if (!read) continue;
      const parent = read.node.parent;
      if (!parent || !ts.isCallExpression(parent) || parent.expression !== read.node) continue;

      const loopInfo = loopScopeIndex.get(read.scope.id);
      if (!loopInfo) continue;

      // Event handlers fire on user interaction, not per-render iteration
      if (isInDeferredContext(graph, read.scope)) continue;

      const containingExpr = getContainingExpression(read.node);

      if (expressionReferencesAny(containingExpr, loopInfo.paramNames)) {
        continue; // Expression uses loop params
      }

      /* Check ALL captures (not just reactive ones) for loop-dependent
         names.  A derived function like `const isHovered = () => id === x`
         captures `id` which is a non-reactive local derived from the loop
         parameter (`const id = annotation.id`).  expandWithDerivedLocals
         already added `id` to paramNames, so we need to check the full
         capture list, not just reactive captures. */
      const allCaptures = fnInfo.fn.captures;
      let usesLoopParam = false;
      for (let j = 0, clen = allCaptures.length; j < clen; j++) {
        const capture = allCaptures[j];
        if (!capture) continue;
        if (loopInfo.paramNames.has(capture.name)) {
          usesLoopParam = true;
          break;
        }
      }
      if (usesLoopParam) continue;

      if (reported.has(read.node)) continue;
      reported.add(read.node);

      diagnostics.push(
        createDiagnostic(
          file,
          read.node,
          graph.sourceFile,
          "signal-in-loop",
          "derivedCallInvariant",
          resolveMessage(messages.derivedCallInvariant, {
            name: variable.name,
            component: loopInfo.element.tag ?? "For",
            captures: formatVariableNames(fnInfo.captures),
          }),
          "error",
        ),
      );
    }
  }
}
