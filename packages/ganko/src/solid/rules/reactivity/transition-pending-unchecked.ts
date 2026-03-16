/**
 * Transition Pending Unchecked Rule
 *
 * Detects `useTransition` usage without handling the `isPending` state.
 *
 * Problem:
 * useTransition returns [isPending, startTransition]. The isPending state should be used
 * to show loading UI during transitions. If isPending is destructured but never used,
 * users won't get feedback during long transitions.
 *
 * Examples:
 * - BAD:  const [isPending, startTransition] = useTransition(); // isPending never used
 * - GOOD: <button disabled={isPending()}>{isPending() ? "Loading..." : "Update"}</button>
 */

import ts from "typescript";
import type { CallEntity, VariableEntity } from "../../entities";
import { getCallsByPrimitive, getVariableByNameInScope } from "../../queries";
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";

const messages = {
  pendingUnchecked:
    "useTransition returns [isPending, startTransition]. The isPending state should be used to show loading UI during transitions.",
} as const;

const options = {};

/**
 * Extract the first element's identifier name from an array destructuring pattern.
 *
 * Handles: const [isPending, startTransition] = useTransition();
 * Returns: "isPending" or null if not destructured properly
 * @param call - The call entity to analyze
 * @returns The first destructured name or null
 */
function getFirstDestructuredName(call: CallEntity): string | null {
  const callNode = call.node;
  const parent = callNode.parent;

  if (!parent || !ts.isVariableDeclaration(parent) || parent.initializer !== callNode) {
    return null;
  }

  const pattern = parent.name;
  if (!ts.isArrayBindingPattern(pattern)) {
    return null;
  }

  const elements = pattern.elements;
  if (elements.length === 0) {
    return null;
  }

  const firstElement = elements[0];
  if (!firstElement || !ts.isBindingElement(firstElement) || !ts.isIdentifier(firstElement.name)) {
    return null;
  }

  return firstElement.name.text;
}

/**
 * Check if a variable has any reads (is used).
 * @param variable - The variable entity to check
 * @returns True if the variable has any reads
 */
function isVariableUsed(variable: VariableEntity): boolean {
  return variable.reads.length > 0;
}

export const transitionPendingUnchecked = defineSolidRule({
  id: "transition-pending-unchecked",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect useTransition usage without handling the isPending state",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const transitionCalls = getCallsByPrimitive(graph, "useTransition");

    if (transitionCalls.length === 0) {
      return;
    }

    for (let i = 0, len = transitionCalls.length; i < len; i++) {
      const call = transitionCalls[i];

      if (!call) continue;

      // Get the first destructured element name (isPending)
      const pendingName = getFirstDestructuredName(call);
      if (pendingName === null) {
        // Not destructured or missing first element - skip
        continue;
      }

      // Look up the variable in the call's scope
      const pendingVariable = getVariableByNameInScope(graph, pendingName, call.scope);
      if (pendingVariable === null) {
        // Variable not found - shouldn't happen but be defensive
        continue;
      }

      if (!isVariableUsed(pendingVariable)) {
        // isPending is destructured but never used
        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "transition-pending-unchecked",
            "pendingUnchecked",
            messages.pendingUnchecked,
            "error",
          ),
        );
      }
    }
  },
});
