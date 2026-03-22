/**
 * Scope and context query functions
 */
import ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree";
import type { ScopeEntity, TrackingContext } from "../entities/scope";
import type { VariableEntity } from "../entities/variable";
import { UNKNOWN_CONTEXT } from "../entities/scope";

/**
 * Returns true if the node is a scope-creating node (function or block boundary).
 */
function isScopeNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isSourceFile(node)
  );
}

export function getScopeFor(graph: SolidGraph, node: ts.Node): ScopeEntity {
  const cached = graph.scopeForCache.get(node);
  if (cached) return cached;

  let pathNodes: ts.Node[] | null = null;
  let foundScope: ScopeEntity | null = null;
  let current: ts.Node | undefined = node.parent;

  while (current) {
    const cachedParent = graph.scopeForCache.get(current);
    if (cachedParent) {
      foundScope = cachedParent;
      break;
    }

    if (isScopeNode(current)) {
      // Find matching scope entity by node reference
      const scopes = graph.scopes;
      for (let i = 0, len = scopes.length; i < len; i++) {
        const scope = scopes[i];
        if (!scope) continue;
        if (scope.node === current) {
          foundScope = scope;
          graph.scopeForCache.set(current, scope);
          break;
        }
      }
      if (foundScope) break;
    }

    if (pathNodes === null) pathNodes = [current];
    else pathNodes.push(current);
    current = current.parent;
  }

  const resultScope = foundScope ?? graph.firstScope;
  if (!resultScope) {
    throw new Error("getScopeFor called before any scopes registered");
  }
  graph.scopeForCache.set(node, resultScope);

  if (pathNodes !== null) {
    for (let i = 0, len = pathNodes.length; i < len; i++) {
      const pathNode = pathNodes[i];
      if (!pathNode) continue;
      graph.scopeForCache.set(pathNode, resultScope);
    }
  }

  return resultScope;
}

export function getVariableByNameInScope(_graph: SolidGraph, name: string, scope: ScopeEntity): VariableEntity | null {
  let current: ScopeEntity | null = scope;
  while (current !== null) {
    const varsByName = current._variablesByName;
    if (varsByName !== null) {
      const variable = varsByName.get(name);
      if (variable) return variable;
    }
    current = current.parent;
  }
  return null;
}

export function getEffectiveTrackingContext(_graph: SolidGraph, scope: ScopeEntity): TrackingContext {
  return scope._resolvedContext ?? UNKNOWN_CONTEXT;
}

export function getEnclosingComponentScope(_graph: SolidGraph, scope: ScopeEntity): { scope: ScopeEntity; name: string } | null {
  return scope._enclosingComponent;
}

/**
 * TRUE if signal reads create dependencies (Listener is set at runtime).
 * Only `tracked` (explicit effects/memos) and `jsx-expression` (implicit effects) qualify.
 */
export function isInTrackedContext(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  const t = context.type;
  return t === "tracked" || t === "jsx-expression";
}

/**
 * TRUE if definitely not tracking (Listener is null at runtime).
 * Component bodies, deferred callbacks, and explicit untrack() all qualify.
 */
export function isInUntrackedContext(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  const t = context.type;
  return t === "untracked" || t === "component-body" || t === "deferred";
}

export function isInDeferredContext(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  return context.type === "deferred";
}

/**
 * TRUE if inside a context that supports reactive operations (Owner is set).
 * Everything except `unknown` has Owner at runtime.
 */
export function isInReactiveContext(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  return context.type !== "unknown";
}

/**
 * TRUE if the scope is inside a component body (untracked, runs once).
 */
export function isInComponentBody(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  return context.type === "component-body";
}

/**
 * TRUE if signals SHOULD be called here (user-facing semantic).
 * Returns true for all known contexts — signals should always be invoked
 * as functions regardless of tracking. Only `unknown` returns false.
 */
export function shouldCallSignals(_graph: SolidGraph, scope: ScopeEntity): boolean {
  const context = scope._resolvedContext;
  if (!context) return false;
  return context.type !== "unknown";
}

export function getAncestorScopes(_graph: SolidGraph, scope: ScopeEntity): readonly ScopeEntity[] {
  return scope._scopeChain ?? [scope];
}

export function getDescendantScopes(_graph: SolidGraph, scope: ScopeEntity): readonly ScopeEntity[] {
  const descendants: ScopeEntity[] = [];
  const stack = [...scope.children];
  for (let idx = 0; idx < stack.length; idx++) {
    const child = stack[idx];
    if (!child) continue;
    descendants.push(child);
    for (let i = 0, len = child.children.length; i < len; i++) {
      const grandchild = child.children[i];
      if (!grandchild) continue;
      stack.push(grandchild);
    }
  }
  return descendants;
}

export function isNameVisible(graph: SolidGraph, name: string, scope: ScopeEntity): boolean {
  return getVariableByNameInScope(graph, name, scope) !== null;
}
