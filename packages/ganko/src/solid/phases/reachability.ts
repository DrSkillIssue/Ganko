/**
 * Reachability Phase (Phase 7)
 *
 * Computes reachability flags for functions based on their context.
 *
 * This phase:
 * - Identifies hook functions by naming convention (useXxx)
 * - Detects IIFE patterns in reactive contexts
 * - Sets reachability flags used by rules to determine tracking behavior
 *
 * Reachability flags are stored as a bitmask on FunctionEntity._reachability.
 */
import type { TSESTree as _T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { FunctionEntity } from "../entities/function";
import type { CallEntity } from "../entities/call";
import type { ScopeEntity } from "../entities/scope";
import { HOOK_PATTERN } from "@ganko/shared";

const REACHABILITY_BASE = 1;
const FLAG_IS_HOOK = 2;
const FLAG_IS_IIFE_REACTIVE = 4;

export function runReachabilityPhase(graph: SolidGraph, _input: SolidInput): void {
    const functions = graph.functions;
    if (functions.length === 0) return;

    for (let i = 0, len = functions.length; i < len; i++) {
      const fn = functions[i];
      if (!fn) continue;
      fn._reachability = computeReachabilityFlags(fn, graph);
    }
}

/**
 * Computes reachability flags for a function based on its context.
 * @param fn - The function entity
 * @param graph - The solid graph
 * @returns The reachability flags bitmask
 */
function computeReachabilityFlags(fn: FunctionEntity, graph: SolidGraph): number {
  let flags = 0;

  const context = fn.scope._resolvedContext;
  if (context) {
    const t = context.type;
    if (t === "tracked" || t === "jsx-expression") {
      flags |= REACHABILITY_BASE;
    }
  }

  const name = fn.name;
  if (name && HOOK_PATTERN.test(name)) {
    flags |= FLAG_IS_HOOK;
  }

  const callSites = fn.callSites;
  if (callSites.length === 0) return flags;

  for (let i = 0, len = callSites.length; i < len; i++) {
    const site = callSites[i];
    if (!site) continue;
    if (isInReactiveIIFE(site, graph)) {
      flags |= FLAG_IS_IIFE_REACTIVE;
      break;
    }
  }

  return flags;
}

/**
 * Checks if a call is inside a reactive IIFE pattern.
 * @param call - The call entity
 * @param graph - The solid graph
 * @returns True if the call is in a reactive IIFE
 */
function isInReactiveIIFE(call: CallEntity, graph: SolidGraph): boolean {
  // Find the enclosing function from the call's scope
  const scope = call.scope;
  const enclosingFn = findEnclosingFunction(scope, graph);
  if (!enclosingFn) return false;

  const context = enclosingFn.scope._resolvedContext;
  if (!context) return false;

  return context.type === "tracked" || context.type === "jsx-expression";
}

/**
 * Finds the enclosing function entity for a scope.
 * @param scope - The scope entity
 * @param graph - The solid graph
 * @returns The enclosing function entity or null
 */
function findEnclosingFunction(scope: ScopeEntity, graph: SolidGraph): FunctionEntity | null {
  let current: ScopeEntity | null = scope;
  while (current) {
    if (current.kind === "function" && current.node) {
      const fn = graph.functionsByNode.get(current.node);
      if (fn) return fn;
    }
    current = current.parent;
  }
  return null;
}
