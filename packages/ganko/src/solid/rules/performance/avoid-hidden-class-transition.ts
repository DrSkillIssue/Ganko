/**
 * Flags conditional property additions that create inconsistent object shapes.
 *
 * Only flags assignments that ADD new properties conditionally, not mutations
 * to existing properties. Uses TypeScript type information to determine if
 * the property exists on the object's declared type.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";
import { getHiddenClassTransitions } from "../../queries"

const messages = {
  hiddenClassTransition:
    "Property '{{property}}' added conditionally to '{{object}}' creates inconsistent object shapes. " +
    "Initialize '{{property}}' in the object literal.",
} as const

const options = {}

/**
 * Get the property name from a MemberExpression property node.
 *
 * @param property - The property node
 * @param computed - Whether the property access is computed
 * @returns The property name string, or a placeholder for dynamic access
 */
function getPropertyName(property: T.Expression | T.PrivateIdentifier, computed: boolean): string {
  if (!computed) {
    if (property.type === "Identifier") return property.name;
    if (property.type === "PrivateIdentifier") return property.name;
  }
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return "[dynamic]";
}

/**
 * Get the object name from a MemberExpression object node.
 *
 * @param object - The object expression node
 * @returns The object name string, or a placeholder for complex expressions
 */
function getObjectName(object: T.Expression): string {
  if (object.type === "Identifier") return object.name;
  if (object.type === "ThisExpression") return "this";
  if (object.type === "MemberExpression") {
    const objPart = getObjectName(object.object);
    const propPart = getPropertyName(object.property, object.computed);
    return `${objPart}.${propPart}`;
  }
  return "object";
}

export const avoidHiddenClassTransition = defineSolidRule({
  id: "avoid-hidden-class-transition",
  severity: "warn",
  messages,
  meta: {
    description: "Suggest consistent object shapes to avoid V8 hidden class transitions.",
    fixable: false,
    category: "performance",
  },
  options,

  /**
   * Checks for property assignments that cause hidden class transitions.
   *
   * Only flags assignments where:
   * - The assignment is inside a conditional
   * - The property does NOT exist on the object's declared type (new property, not mutation)
   *
   * @param graph - The SolidGraph to check
   * @param emit - Function to emit diagnostics
   */
  check(graph, emit) {
    const transitions = getHiddenClassTransitions(graph);
    if (transitions.length === 0) return;

    for (let i = 0, len = transitions.length; i < len; i++) {
      const pa = transitions[i];
      if (!pa) continue;
      const property = getPropertyName(pa.property, pa.computed);
      const object = getObjectName(pa.object);

      const message = messages.hiddenClassTransition
        .replace("{{property}}", property)
        .replaceAll("{{property}}", property)
        .replace("{{object}}", object);

      emit(
        createDiagnostic(
          graph.file,
          pa.target,
          "avoid-hidden-class-transition",
          "hiddenClassTransition",
          message,
          "warn",
        ),
      );
    }
  },
});
