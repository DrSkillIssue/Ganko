/**
 * Flags conditional property additions that create inconsistent object shapes.
 *
 * Only flags assignments that ADD new properties conditionally, not mutations
 * to existing properties. Uses TypeScript type information to determine if
 * the property exists on the object's declared type.
 */

import ts from "typescript";
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
 * Get the property name from a PropertyAssignmentEntity property node.
 *
 * @param property - The property node
 * @param computed - Whether the property access is computed
 * @returns The property name string, or a placeholder for dynamic access
 */
function getPropertyName(property: ts.Expression | ts.PrivateIdentifier, computed: boolean): string {
  if (!computed) {
    if (ts.isIdentifier(property)) return property.text;
    if (ts.isPrivateIdentifier(property)) return property.text;
  }
  if (ts.isStringLiteral(property)) {
    return property.text;
  }
  return "[dynamic]";
}

/**
 * Get the object name from a PropertyAssignmentEntity object node.
 *
 * @param object - The object expression node
 * @returns The object name string, or a placeholder for complex expressions
 */
function getObjectName(object: ts.Expression): string {
  if (ts.isIdentifier(object)) return object.text;
  if (object.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isPropertyAccessExpression(object)) {
    const objPart = getObjectName(object.expression);
    const propPart = object.name.text;
    return `${objPart}.${propPart}`;
  }
  if (ts.isElementAccessExpression(object)) {
    const objPart = getObjectName(object.expression);
    const propPart = ts.isStringLiteral(object.argumentExpression)
      ? object.argumentExpression.text
      : "[dynamic]";
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
          graph.filePath,
          pa.target,
          graph.sourceFile,
          "avoid-hidden-class-transition",
          "hiddenClassTransition",
          message,
          "warn",
        ),
      );
    }
  },
});
