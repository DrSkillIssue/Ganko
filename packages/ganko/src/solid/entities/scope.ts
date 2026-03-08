/**
 * Scope Entity
 *
 * Represents a lexical scope in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FileEntity } from "./file";
import type { VariableEntity } from "./variable";
import type { FunctionEntity } from "./function";

/**
 * Represents a lexical scope in the SolidGraph.
 *
 * Scopes form a tree structure where each scope has at most one parent
 * and can have multiple children. Module scope is the root.
 */
export interface ScopeEntity {
  id: number;
  /** The AST node that creates this scope. May be null for fallback/synthetic scopes. */
  node: T.Node | null;
  file: FileEntity;
  kind: "program" | "function" | "block";
  parent: ScopeEntity | null;
  children: ScopeEntity[];
  variables: VariableEntity[];
  functions: FunctionEntity[];
  trackingContext: TrackingContext | null;
  isModuleScope: boolean;
  /** @internal Resolved context (inherited from parent if trackingContext is null) */
  _resolvedContext: TrackingContext | null;
  /** @internal Scope chain [self, parent, grandparent, ...] for ancestor iteration */
  _scopeChain: ScopeEntity[] | null;
  /** @internal Enclosing component scope if inside a component */
  _enclosingComponent: { scope: ScopeEntity; name: string } | null;
  /** @internal Set of variable names owned by this scope */
  _ownNames: Set<string> | null;
  /** @internal Map from variable name to entity for direct lookup */
  _variablesByName: Map<string, VariableEntity> | null;
  /** @internal Cached descendant scopes */
  _descendantScopes?: ScopeEntity[];
}

/**
 * Describes the reactivity tracking context for a scope.
 *
 * Models Solid.js's runtime tracking semantics:
 * - tracked: Inside reactive computations (createEffect, createMemo, createRenderEffect)
 *   where `Listener` is set and signal reads register dependencies
 * - jsx-expression: Inside JSX expression holes that compile to implicit effects
 * - deferred: Inside callbacks that execute later (event handlers, onMount, onCleanup)
 * - component-body: Inside a component function body — runs ONCE in `untrack()`,
 *   signal reads capture one-time snapshots that never update
 * - untracked: Explicitly untracked regions (untrack(), createRoot())
 * - unknown: Context cannot be determined
 */
export interface TrackingContext {
  type: "tracked" | "jsx-expression" | "deferred" | "component-body" | "untracked" | "unknown";
  source?: string;
  reason?: string;
}

/** The unknown/default tracking context when context cannot be determined */
export const UNKNOWN_CONTEXT: TrackingContext = Object.freeze({ type: "unknown" });

export interface CreateScopeArgs {
  id: number;
  node: T.Node | null;
  file: FileEntity;
  kind: "program" | "function" | "block";
  parent: ScopeEntity | null;
  trackingContext: TrackingContext | null;
  resolvedContext: TrackingContext | null;
}

/**
 * Creates a ScopeEntity from the provided arguments.
 */
export function createScope(args: CreateScopeArgs): ScopeEntity {
  return {
    id: args.id,
    node: args.node,
    file: args.file,
    kind: args.kind,
    parent: args.parent,
    children: [],
    variables: [],
    functions: [],
    trackingContext: args.trackingContext,
    isModuleScope: args.kind === "program",
    _resolvedContext: args.resolvedContext,
    _scopeChain: null,
    _enclosingComponent: null,
    _ownNames: null,
    _variablesByName: null,
  };
}

/**
 * Builds the scope chain array for a scope entity.
 */
export function buildScopeChain(scope: ScopeEntity): void {
  const parent = scope.parent;
  if (parent) {
    const parentChain = parent._scopeChain;
    if (parentChain) {
      const chainLen = parentChain.length;
      const scopeChain = new Array<ScopeEntity>(chainLen + 1);
      scopeChain[0] = scope;
      for (let j = 0; j < chainLen; j++) {
        const chainEntry = parentChain[j];
        if (!chainEntry) continue;
        scopeChain[j + 1] = chainEntry;
      }
      scope._scopeChain = scopeChain;
    } else {
      scope._scopeChain = [scope, parent];
    }
  } else {
    scope._scopeChain = [scope];
  }
}
