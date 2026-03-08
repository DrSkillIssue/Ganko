/**
 * Entity relationship and analysis functions
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { VariableEntity, ReadEntity, AssignmentEntity } from "../entities/variable";
import type { FunctionEntity } from "../entities/function";
import type { CallEntity, ArgumentSemantic } from "../entities/call";
import type { ReturnStatementEntity } from "../entities/return-statement";
import type { PropertyAssignmentEntity } from "../entities/property-assignment";
import type { SpreadSourceKind } from "../entities/spread";
import { getVariableByNameInScope } from "./scope";

export function getArgumentKind(call: CallEntity, position: number): ArgumentSemantic | null {
  const semantics = call.argumentSemantics;
  for (let i = 0, len = semantics.length; i < len; i++) {
    const s = semantics[i];
    if (!s) continue;
    if (s.position === position) {
      return s;
    }
  }
  return null;
}

export function getVariableReads(variable: VariableEntity): readonly ReadEntity[] {
  return variable.reads;
}

export function getVariableAssignments(variable: VariableEntity): readonly AssignmentEntity[] {
  return variable.assignments;
}

export function getCapturedVariables(fn: FunctionEntity): readonly VariableEntity[] {
  return fn.captures;
}

export function getCalledFunction(call: CallEntity): FunctionEntity | null {
  return call.resolvedTarget;
}

export function getCallsTo(fn: FunctionEntity): readonly CallEntity[] {
  return fn.callSites;
}

export function isReactiveVariable(variable: VariableEntity): boolean {
  return variable.isReactive;
}

export function getReturnStatements(fn: FunctionEntity): readonly ReturnStatementEntity[] {
  return fn.returnStatements;
}

export function getEarlyReturns(fn: FunctionEntity): readonly ReturnStatementEntity[] {
  const returns = fn.returnStatements;
  const early: ReturnStatementEntity[] = [];
  for (let i = 0, len = returns.length; i < len; i++) {
    const ret = returns[i];
    if (!ret) continue;
    if (ret.isEarly) early.push(ret);
  }
  return early;
}

export function getCapturedReactiveVariables(fn: FunctionEntity): readonly VariableEntity[] {
  if (fn._cachedReactiveCaptures !== null) return fn._cachedReactiveCaptures;
  const reactive: VariableEntity[] = [];
  const captures = fn.captures;
  for (let i = 0, len = captures.length; i < len; i++) {
    const cap = captures[i];
    if (!cap) continue;
    if (cap.isReactive) reactive.push(cap);
  }
  fn._cachedReactiveCaptures = reactive;
  return reactive;
}

export function isComponentFunction(fn: FunctionEntity): boolean {
  const context = fn.scope.trackingContext;
  return context !== null && context.type === "component-body";
}

/**
 * Checks if a function is exported (directly or via variable).
 */
export function isFunctionExported(graph: SolidGraph, fn: FunctionEntity): boolean {
  if (graph.exportsByEntityId.has(fn.id)) return true;
  if (fn.variable !== null && graph.exportsByEntityId.has(fn.variable.id)) return true;
  return false;
}

export function isSplitPropsVariable(variable: VariableEntity): boolean {
  const assignments = variable.assignments;
  if (assignments.length === 0) return false;
  const first = assignments[0];
  if (!first) return false;
  const value = first.value;
  if (!value) return false;
  
  // Traverse up to find VariableDeclarator
  // Pattern: Identifier -> ArrayPattern -> VariableDeclarator
  let node = value.parent;
  while (node && node.type === "ArrayPattern") {
    node = node.parent;
  }
  if (node?.type !== "VariableDeclarator") return false;
  
  const init = node.init;
  if (init?.type !== "CallExpression") return false;
  const callee = init.callee;
  return callee.type === "Identifier" && callee.name === "splitProps";
}

export function isMergePropsVariable(variable: VariableEntity): boolean {
  const assignments = variable.assignments;
  if (assignments.length === 0) return false;
  const firstAssign = assignments[0];
  if (!firstAssign) return false;
  const value = firstAssign.value;
  if (value?.type !== "CallExpression") return false;
  const callee = value.callee;
  return callee.type === "Identifier" && callee.name === "mergeProps";
}

export function getVariableSourceKind(variable: VariableEntity): SpreadSourceKind {
  const assignments = variable.assignments;
  if (assignments.length === 0) return "other";
  const firstAssignment = assignments[0];
  if (!firstAssignment) return "other";
  const value = firstAssignment.value;
  if (!value) return "other";

  switch (value.type) {
    case "Identifier": return "identifier";
    case "MemberExpression": return "member";
    case "CallExpression": return "call";
    case "ObjectExpression": return "literal";
    case "LogicalExpression": return "logical";
    case "ConditionalExpression": return "conditional";
    default: return "other";
  }
}

export function getFunctionVariable(fn: FunctionEntity): VariableEntity | null {
  return fn.variable;
}

export function getContainingFunction(graph: SolidGraph, node: T.Node): FunctionEntity | null {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression") {
      return graph.functionsByNode.get(current) ?? null;
    }
    current = current.parent;
  }
  return null;
}

export function getConditionalPropertyAssignments(graph: SolidGraph): readonly PropertyAssignmentEntity[] {
  const result: PropertyAssignmentEntity[] = [];
  for (let i = 0, len = graph.propertyAssignments.length; i < len; i++) {
    const pa = graph.propertyAssignments[i];
    if (!pa) continue;
    if (pa.isInConditional) result.push(pa);
  }
  return result;
}

/**
 * Returns property assignments that create hidden class transitions.
 *
 * Filters to only assignments where:
 * - The assignment is inside a conditional
 * - The property does not exist on the object's declared type
 * - The target object originates from a plain object literal
 *
 * DOM elements, class instances, function parameters, and imported objects
 * have fixed shapes and are not subject to V8 hidden class transitions.
 */
export function getHiddenClassTransitions(graph: SolidGraph): readonly PropertyAssignmentEntity[] {
  const result: PropertyAssignmentEntity[] = [];
  for (let i = 0, len = graph.propertyAssignments.length; i < len; i++) {
    const pa = graph.propertyAssignments[i];
    if (!pa) continue;
    if (pa.isInConditional && !pa.propertyExistsOnType && isObjectLiteralTarget(graph, pa)) {
      result.push(pa);
    }
  }
  return result;
}

/**
 * Determine if a property assignment targets an object that originated
 * from a plain object literal expression.
 *
 * Returns true only when the target object identifier resolves to a
 * variable whose initial assignment value is an ObjectExpression. Returns
 * false for DOM refs, class instances, parameters, destructured values,
 * function return values, and any other non-literal object origin.
 */
function isObjectLiteralTarget(graph: SolidGraph, pa: PropertyAssignmentEntity): boolean {
  const obj = pa.object;
  if (obj.type !== "Identifier") return false;
  const variable = getVariableByNameInScope(graph, obj.name, pa.scope);
  if (!variable) return false;
  const assignments = variable.assignments;
  if (assignments.length === 0) return false;
  const firstA = assignments[0];
  if (!firstA) return false;
  return firstA.value.type === "ObjectExpression";
}

export function getMemberAccessesOnIdentifier(fn: FunctionEntity, identifierName: string): readonly T.MemberExpression[] {
  const cache = fn._memberAccessesByIdentifier;
  if (!cache) return [];
  return cache.get(identifierName) ?? [];
}

/**
 * Info about a function that captures reactive variables in an untracked context.
 */
export interface DerivedFunctionInfo {
  fn: FunctionEntity;
  captures: readonly VariableEntity[];
}

/**
 * Build a map from variable to derived function info for all functions that:
 * 1. Capture reactive variables with at least one direct read in the function body
 * 2. Are NOT in tracked or deferred tracking contexts
 * 3. Are assigned to a variable
 *
 * Functions that only forward reactive references to nested closures (higher-order
 * functions returning callbacks) are excluded — their reactive reads happen lazily
 * when the returned closure is invoked, not when the outer function is called.
 *
 * @param graph - The program graph
 * @returns Map from the function's variable to its derived function info
 */
export function buildDerivedFunctionMap(
  graph: SolidGraph,
): Map<VariableEntity, DerivedFunctionInfo> {
  const functions = graph.functionsWithReactiveCaptures;
  const map = new Map<VariableEntity, DerivedFunctionInfo>();

  for (let i = 0, len = functions.length; i < len; i++) {
    const fn = functions[i];
    if (!fn) continue;

    const ctx = fn.scope._resolvedContext;
    const ctxType = ctx?.type;
    if (ctxType === "tracked" || ctxType === "deferred") continue;

    const fnVar = fn.variable;
    if (!fnVar) continue;

    const captures = getDirectReactiveCaptures(fn);
    if (captures.length === 0) continue;
    map.set(fnVar, { fn, captures });
  }

  return map;
}

/**
 * Returns reactive captures that have at least one read directly in the function
 * body, excluding reads that occur only inside nested function expressions.
 *
 * A "direct read" is one where walking up the AST from the read node reaches
 * the target function node before encountering any other function node. This
 * distinguishes functions that read reactive values at call time (derived functions)
 * from higher-order functions that merely close over reactive references and
 * forward them to returned closures.
 */
function getDirectReactiveCaptures(fn: FunctionEntity): readonly VariableEntity[] {
  const reactiveCaptures = getCapturedReactiveVariables(fn);
  if (reactiveCaptures.length === 0) return reactiveCaptures;

  const fnNode = fn.node;
  const fnStart = fnNode.range[0];
  const fnEnd = fnNode.range[1];
  const out: VariableEntity[] = [];

  for (let i = 0, len = reactiveCaptures.length; i < len; i++) {
    const variable = reactiveCaptures[i];
    if (!variable) continue;
    if (hasDirectReadInFunction(variable, fnNode, fnStart, fnEnd)) {
      out.push(variable);
    }
  }

  return out;
}

function hasDirectReadInFunction(
  variable: VariableEntity,
  fnNode: T.Node,
  fnStart: number,
  fnEnd: number,
): boolean {
  const reads = variable.reads;

  for (let i = 0, len = reads.length; i < len; i++) {
    const readEntry = reads[i];
    if (!readEntry) continue;
    const readNode = readEntry.node;
    const readPos = readNode.range[0];
    if (readPos < fnStart || readPos >= fnEnd) continue;

    if (isDirectChildOfFunction(readNode, fnNode)) return true;
  }

  return false;
}

function isDirectChildOfFunction(node: T.Node, targetFnNode: T.Node): boolean {
  let current: T.Node | undefined = node.parent;

  while (current) {
    if (current === targetFnNode) return true;

    if (
      current.type === "FunctionDeclaration"
      || current.type === "FunctionExpression"
      || current.type === "ArrowFunctionExpression"
    ) {
      return false;
    }

    current = current.parent;
  }

  return false;
}
