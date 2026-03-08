/**
 * Cleanup Scope Rule
 *
 * Detects onCleanup() called outside of a valid reactive scope.
 *
 * onCleanup() registers a cleanup function with the current Owner.
 * When called with no Owner (module scope, standalone utility functions),
 * the cleanup silently no-ops in production and warns in development.
 *
 * Valid scopes (Owner is set):
 * - Component bodies (Owner inherited from render tree)
 * - Effect/memo callbacks (Owner is the computation)
 * - createRoot callbacks (Owner is the root)
 * - runWithOwner callbacks (Owner explicitly restored)
 * - JSX expressions (compiled to effects with Owner)
 * - Directive functions referenced via use: in JSX
 *
 * Note: Helper functions containing onCleanup are flagged because the
 * rule cannot verify call sites. Users should eslint-disable for hooks
 * designed to be called from reactive contexts.
 */

import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { ScopeEntity, CallEntity } from "../../entities"
import { getAncestorScopes, getCallByNode, getCallsByPrimitive, getEffectiveTrackingContext, getEnclosingComponentScope } from "../../queries"
import { getJSXAttributesByKind } from "../../queries/jsx"
import { getFunctionName } from "../../util"
import { isFunctionInReactivePrimitiveConfig } from "../../util/pattern-detection"

const messages = {
  cleanupOutsideScope:
    "onCleanup() called outside a reactive scope ({{location}}). The cleanup function will never execute unless this code runs within a component, effect, createRoot, or runWithOwner.",
} as const

const options = {}

export const cleanupScope = defineSolidRule({
  id: "cleanup-scope",
  severity: "error",
  messages,
  meta: {
    description: "Detect onCleanup called outside of a valid reactive scope",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const cleanupCalls = getCallsByPrimitive(graph, "onCleanup")

    if (cleanupCalls.length === 0) {
      return;
    }

    const directiveNames = collectDirectiveNames(graph);

    for (let i = 0, len = cleanupCalls.length; i < len; i++) {
      const call = cleanupCalls[i];

      if (!call) continue;
      if (isInValidCleanupScope(graph, call, directiveNames)) {
        continue;
      }

      const location = getLocationDescription(call.scope);

      emit(
        createDiagnostic(
          graph.file,
          call.node,
          "cleanup-scope",
          "cleanupOutsideScope",
          resolveMessage(messages.cleanupOutsideScope, { location }),
          "error",
        ),
      )
    }
  },
});

/**
 * Collect names of functions used as directives via use: in JSX.
 *
 * Looks at all `use:name` attributes and extracts the directive name.
 * For `use:tooltip`, the entity name is `"use:tooltip"` and the function
 * name is `"tooltip"` (slice off "use:" prefix, 4 chars).
 */
function collectDirectiveNames(graph: SolidGraph): ReadonlySet<string> {
  const attrs = getJSXAttributesByKind(graph, "directive");
  if (attrs.length === 0) return EMPTY_SET;

  const names = new Set<string>();
  for (let i = 0, len = attrs.length; i < len; i++) {
    const attrEntry = attrs[i];
    if (!attrEntry) continue;
    const fullName = attrEntry.attr.name;
    if (fullName !== null && fullName.length > 4) {
      names.add(fullName.slice(4));
    }
  }
  return names;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Check if a call is in a valid scope for onCleanup().
 *
 * Valid contexts where Owner is set at runtime:
 * 1. Inside a component function (Owner inherited from render tree)
 * 2. Inside a tracked or jsx-expression context (effect/memo/compiled JSX)
 * 3. Inside a directive function (verified via use: JSX attribute)
 * 4. Inside a createRoot() or runWithOwner() callback
 * 5. Inside a custom reactive primitive (create* convention)
 */
function isInValidCleanupScope(graph: SolidGraph, call: CallEntity, directiveNames: ReadonlySet<string>): boolean {
  const scope = call.scope;

  if (getEnclosingComponentScope(graph, scope) !== null) {
    return true;
  }

  const context = getEffectiveTrackingContext(graph, scope)
  const contextType = context.type;
  if (contextType === "tracked" || contextType === "jsx-expression" || contextType === "component-body") {
    return true;
  }

  if (isInDirective(graph, scope, directiveNames)) {
    return true;
  }

  if (isInOwnerEstablishingPrimitive(graph, scope)) {
    return true;
  }

  return isInCustomReactivePrimitive(graph, scope);
}

/**
 * Check if a scope is inside a function used as a Solid directive.
 *
 * Instead of heuristically matching on parameter count, verifies that
 * the function is actually referenced via `use:name` in JSX. This
 * eliminates false positives from regular 2-parameter functions.
 */
function isInDirective(graph: SolidGraph, scope: ScopeEntity, directiveNames: ReadonlySet<string>): boolean {
  if (directiveNames.size === 0) return false;

  const ancestors = getAncestorScopes(graph, scope);

  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i];
    if (!ancestor) continue;
    if (ancestor.kind !== "function") continue;

    const node = ancestor.node;
    if (node === null) continue;

    const nodeType = node.type;
    if (nodeType !== "FunctionDeclaration" && nodeType !== "FunctionExpression" && nodeType !== "ArrowFunctionExpression") {
      continue;
    }

    const name = getFunctionName(node);
    if (name !== null && directiveNames.has(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a scope is inside a createRoot() or runWithOwner() callback.
 *
 * Both primitives establish an Owner before running their callback:
 * - createRoot: creates a new reactive root (Owner = root)
 * - runWithOwner: explicitly restores a saved Owner
 */
function isInOwnerEstablishingPrimitive(graph: SolidGraph, scope: ScopeEntity): boolean {
  const ancestors = getAncestorScopes(graph, scope);

  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i];
    if (!ancestor) continue;

    if (ancestor.kind === "function" && isOwnerPrimitiveCallback(graph, ancestor)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a function scope is the direct callback argument to
 * createRoot() or runWithOwner().
 */
function isOwnerPrimitiveCallback(graph: SolidGraph, scope: ScopeEntity): boolean {
  const node = scope.node;
  if (node === null) return false;

  const parent = node.parent;
  if (parent?.type !== "CallExpression") return false;

  const callEntity = getCallByNode(graph, parent);
  if (!callEntity?.primitive) return false;

  const name = callEntity.primitive.name;
  return name === "createRoot" || name === "runWithOwner";
}

/**
 * Check if a function name matches Solid's reactive primitive conventions.
 *
 * Two conventions exist in the Solid ecosystem:
 * - `create*` (e.g. createAnimatedValue, createTimer) — Solid's core convention
 * - `use*` (e.g. useIPValidation, useCursorPagination) — React-influenced convention
 *   widely adopted in the Solid ecosystem for hooks that create reactive state
 *
 * Both are custom reactive primitives that inherit their caller's Owner.
 * They are always invoked within a component body, effect, or createRoot —
 * so onCleanup() inside them has a valid Owner at runtime.
 */
function isReactivePrimitiveName(name: string): boolean {
  const len = name.length;
  // create* — must be longer than "create" (6 chars), starts with 'c'
  if (len > 6 && name.charCodeAt(0) === 99 && name.startsWith("create")) return true;
  // use* — must be longer than "use" (3 chars), starts with 'u'
  if (len > 3 && name.charCodeAt(0) === 117 && name.startsWith("use")) return true;
  return false;
}

/**
 * Check if a scope is inside a custom reactive primitive.
 *
 * Walks ancestor scopes looking for an enclosing function whose name matches
 * Solid's reactive primitive naming conventions (create- or use- prefixed).
 */
function isInCustomReactivePrimitive(graph: SolidGraph, scope: ScopeEntity): boolean {
  const ancestors = getAncestorScopes(graph, scope);

  for (let i = 0, len = ancestors.length; i < len; i++) {
    const ancestor = ancestors[i];
    if (!ancestor) continue;
    if (ancestor.kind !== "function") continue;

    const node = ancestor.node;
    if (node === null) continue;

    const nodeType = node.type;
    if (nodeType !== "FunctionDeclaration" && nodeType !== "FunctionExpression" && nodeType !== "ArrowFunctionExpression") {
      continue;
    }

    const name = getFunctionName(node);
    if (name !== null && isReactivePrimitiveName(name)) {
      return true;
    }

    // Check if this function is a property callback inside an object literal
    // argument to a create*/use* call (e.g. createSimpleContext({ init: () => ... }))
    if (isFunctionInReactivePrimitiveConfig(node)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a human-readable description of where onCleanup() was called.
 *
 * Used in error messages to help developers understand the context.
 * Walks up the scope chain to find the enclosing function.
 *
 * @param scope - The scope where onCleanup() was called
 * @returns Human-readable description like "utility function 'foo'" or "module scope"
 *
 * @example
 * ```typescript
 * getLocationDescription(moduleScope); // "module scope"
 * getLocationDescription(functionScope); // "utility function 'useTimer'"
 * getLocationDescription(anonymousFnScope); // "anonymous function"
 * ```
 */
function getLocationDescription(scope: ScopeEntity): string {
  // Check if at module/program scope
  if (scope.isModuleScope) {
    return "module scope";
  }

  let current: ScopeEntity | null = scope;
  while (current !== null) {
    if (current.kind === "function") {
      const node = current.node;
      if (node !== null) {
        const nodeType = node.type;
        if (nodeType === "FunctionDeclaration" || nodeType === "FunctionExpression" || nodeType === "ArrowFunctionExpression") {
          const name = getFunctionName(node);
          if (name) {
            return `utility function '${name}'`;
          }
        }
      }
      return "anonymous function";
    }
    current = current.parent;
  }

  return "unknown scope";
}
