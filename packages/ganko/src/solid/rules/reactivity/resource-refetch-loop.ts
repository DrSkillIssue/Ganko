/**
 * Resource Refetch Loop Rule
 *
 * Detects `refetch()` calls inside `createEffect` which can cause infinite loops.
 *
 * Problem:
 * When you call `refetch()` inside a `createEffect`, the effect runs reactively
 * whenever the resource changes. The refetch triggers a new fetch, which updates
 * the resource, which re-triggers the effect - creating an infinite loop.
 *
 * Solution:
 * Move refetch to an event handler, or use `on()` with explicit dependencies
 * to control when the effect runs.
 *
 * Examples:
 * - BAD:  createEffect(() => { if (trigger()) refetch(); })
 * - GOOD: const handleRefresh = () => refetch();
 * - GOOD: createEffect(on(() => trigger(), () => refetch()))
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import type { VariableEntity, ReadEntity } from "../../entities/variable";
import { findEnclosingFunction } from "../../queries/parent-chain";
import { getVariableByNameInScope, getEffectiveTrackingContext } from "../../queries/scope";
import { getCallByNode, getCallsByPrimitive } from "../../queries/get";

const messages = {
  refetchInEffect:
    "Calling {{name}}.refetch() inside createEffect may cause infinite loops. " +
    "The resource tracks its own dependencies. Move refetch to an event handler or use on() to control dependencies.",
} as const;

const options = {};

/**
 * Track refetch variables from createResource destructuring.
 *
 * Pattern: const [data, { refetch }] = createResource(...)
 * The refetch is in the second element of the returned tuple, typically destructured.
 *
 * @param graph - The program graph to find createResource calls
 * @returns Set of variable entities representing refetch functions
 */
function getRefetchVariables(graph: SolidGraph): Set<VariableEntity> {
  const refetchVars = new Set<VariableEntity>();

  const resourceCalls = getCallsByPrimitive(graph, "createResource");
  if (resourceCalls.length === 0) {
    return refetchVars;
  }

  for (let i = 0, len = resourceCalls.length; i < len; i++) {
    const call = resourceCalls[i];
    if (!call) continue;
    const parent = call.node.parent;

    // Check if assigned via destructuring: const [data, { refetch }] = createResource(...)
    if (parent?.type !== "VariableDeclarator" || parent.init !== call.node) {
      continue;
    }

    const pattern = parent.id;
    if (pattern.type !== "ArrayPattern") {
      continue;
    }

    // The second element contains { refetch, mutate }
    const secondElement = pattern.elements[1];
    if (!secondElement || secondElement.type !== "ObjectPattern") {
      continue;
    }

    // Look for 'refetch' in the object destructuring
    const properties = secondElement.properties;
    for (let j = 0, plen = properties.length; j < plen; j++) {
      const prop = properties[j];
      if (!prop) continue;
      if (prop.type !== "Property") continue;

      // Handle both: { refetch } and { refetch: myRefetch }
      let localName: string | null = null;

      if (prop.shorthand && prop.key.type === "Identifier" && prop.key.name === "refetch") {
        localName = prop.key.name;
      } else if (prop.key.type === "Identifier" && prop.key.name === "refetch") {
        if (prop.value.type === "Identifier") {
          localName = prop.value.name;
        }
      }

      if (localName) {
        // Find the variable entity for this name in the call's scope
        const variable = getVariableByNameInScope(graph, localName, call.scope);
        if (variable) {
          refetchVars.add(variable);
        }
      }
    }
  }

  return refetchVars;
}

/**
 * Check if a scope is inside a createEffect callback.
 *
 * Checks both the effective tracking context and the scope's direct tracking
 * context to determine if the read is inside a createEffect callback.
 *
 * @param graph - The program graph for context lookup
 * @param readNode - The AST node to check
 * @returns True if the node is inside a createEffect callback
 */
function isInsideCreateEffect(graph: SolidGraph, readNode: T.Node): boolean {
  const enclosingFn = findEnclosingFunction(readNode);
  if (!enclosingFn) {
    return false;
  }

  const fnEntity = graph.functionsByNode.get(enclosingFn);
  if (!fnEntity) {
    return false;
  }

  // Check if this function's tracking context is from createEffect
  const context = getEffectiveTrackingContext(graph, fnEntity.scope);

  // "tracked" context with source "createEffect" means we're in an effect
  if (context.type === "tracked" && context.source === "createEffect") {
    return true;
  }

  // Also check the scope's direct tracking context
  const directContext = fnEntity.scope.trackingContext;
  if (directContext?.type === "tracked" && directContext.source === "createEffect") {
    return true;
  }

  return false;
}

/**
 * Check if a refetch call is inside on() with explicit deps.
 *
 * Pattern: createEffect(on(() => trigger, () => refetch()))
 * In this case, the refetch is wrapped in on() which controls dependencies,
 * so it won't cause an infinite loop.
 *
 * @param _graph - The program graph (unused but kept for consistency)
 * @param readNode - The AST node to check
 * @returns True if the node is inside an on() wrapper
 */
function isInsideOnWrapper(_graph: SolidGraph, readNode: T.Node): boolean {
  const enclosingFn = findEnclosingFunction(readNode);
  if (!enclosingFn) {
    return false;
  }

  // Check if this function is passed as an argument to on()
  const fnParent = enclosingFn.parent;
  if (fnParent?.type !== "CallExpression") {
    return false;
  }

  const callee = fnParent.callee;
  if (callee.type === "Identifier" && callee.name === "on") {
    return true;
  }

  return false;
}

/**
 * Check if a refetch call is inside untrack().
 *
 * Pattern: createEffect(() => { untrack(() => refetch()); })
 * When inside untrack(), the refetch won't be tracked, preventing infinite loops.
 *
 * Uses graph.getCallByNode() for robust primitive detection.
 *
 * @param graph - The program graph for call entity lookup
 * @param readNode - The AST node to check
 * @returns True if the node is inside an untrack() call
 */
function isInsideUntrack(graph: SolidGraph, readNode: T.Node): boolean {
  let current: T.Node | undefined = readNode.parent;

  while (current) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      // Check if this function is an argument to untrack()
      const fnParent = current.parent;
      if (fnParent?.type === "CallExpression") {
        // Use graph.getCallByNode() for robust primitive detection
        const callEntity = getCallByNode(graph, fnParent);
        if (callEntity?.primitive?.name === "untrack") {
          return true;
        }
      }
      // Don't break here - continue checking outer functions
    }

    current = current.parent;
  }

  return false;
}

/**
 * Check if a read is a call to refetch().
 *
 * Detects pattern: refetch() where the read is the callee of a call expression.
 *
 * @param read - The read entity to check
 * @returns True if this read is calling refetch as a function
 */
function isRefetchCall(read: ReadEntity): boolean {
  const parent = read.node.parent;
  return parent?.type === "CallExpression" && parent.callee === read.node;
}

export const resourceRefetchLoop = defineSolidRule({
  id: "resource-refetch-loop",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect refetch() calls inside createEffect which can cause infinite loops",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const refetchVars = getRefetchVariables(graph);
    if (refetchVars.size === 0) {
      return;
    }

    // Check each refetch variable's reads
    for (const variable of refetchVars) {
      const reads = variable.reads;

      for (let i = 0, len = reads.length; i < len; i++) {
        const read = reads[i];
        if (!read) continue;

        if (!isRefetchCall(read)) {
          continue;
        }

        if (!isInsideCreateEffect(graph, read.node)) {
          continue;
        }

        // Allow if wrapped in on() with explicit deps
        if (isInsideOnWrapper(graph, read.node)) {
          continue;
        }

        // Allow if inside untrack()
        if (isInsideUntrack(graph, read.node)) {
          continue;
        }

        const resourceName = findResourceName(variable);

        emit(
          createDiagnostic(
            graph.file,
            read.node,
            "resource-refetch-loop",
            "refetchInEffect",
            resolveMessage(messages.refetchInEffect, { name: resourceName }),
            "error",
          ),
        );
      }
    }
  },
});

/**
 * Find the resource name from the same destructuring as refetch.
 *
 * Pattern: const [data, { refetch }] = createResource(...)
 * Returns "data" as the resource name for better error messages.
 *
 * @param refetchVariable - The refetch variable entity
 * @returns The resource name (first element of array destructuring) or "resource"
 */
function findResourceName(refetchVariable: VariableEntity): string {

  const declarations = refetchVariable.declarations;
  if (declarations.length === 0) {
    return "resource";
  }

  const decl = declarations[0];
  if (!decl) return "resource";

  let current: T.Node | undefined = decl.parent;
  while (current) {
    if (current.type === "ArrayPattern") {

      const firstElement = current.elements[0];
      if (firstElement?.type === "Identifier") {
        return firstElement.name;
      }
      break;
    }
    current = current.parent;
  }

  return "resource";
}
