/**
 * Children Helper Misuse Rule
 *
 * Detects misuse of the `children()` helper in Solid.js components.
 *
 * Problems detected:
 * 1. Multiple `children()` calls in the same component
 * 2. Accessing `props.children` in tracked contexts without the helper
 */

import ts from "typescript";
import type { SolidGraph } from "../../impl";
import type { ScopeEntity } from "../../entities";
import type { Diagnostic } from "../../../diagnostic"
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";
import { getCallsByPrimitive, getPropsVariables, getComponentScopes } from "../../queries";
import { getEnclosingComponentScope, getEffectiveTrackingContext } from "../../queries/scope";

const messages = {
  multipleChildrenCalls:
    "The children() helper should only be called once per component. Each call re-resolves children, causing unnecessary computation. Store the result and reuse the accessor.",
  directChildrenAccess:
    "Access props.children through the children() helper in reactive contexts. Direct access won't properly resolve or track children. Use: const resolved = children(() => props.children);",
} as const;

const options = {};

export const childrenHelperMisuse = defineSolidRule({
  id: "children-helper-misuse",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect misuse of the children() helper that causes unnecessary re-computation or breaks reactivity",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const diagnostics: Diagnostic[] = [];

    const childrenCalls = getCallsByPrimitive(graph, "children");
    const propsVars = getPropsVariables(graph);

    if (childrenCalls.length === 0 && propsVars.length === 0) return;

    // Check 1: Multiple children() calls per component
    if (childrenCalls.length > 1) {
      checkMultipleChildrenCalls(graph, childrenCalls, diagnostics, graph.file);
    }

    // Check 2: props.children in tracked contexts
    checkPropsChildrenAccess(graph, propsVars, diagnostics, graph.file);

    for (const diagnostic of diagnostics) {
      emit(diagnostic);
    }
  },
});

/**
 * Check for multiple children() calls in the same component.
 *
 * @param graph - The SolidGraph instance
 * @param calls - The children() calls to check
 * @param diagnostics - Array to push diagnostics into
 */
function checkMultipleChildrenCalls(
  graph: SolidGraph,
  calls: readonly { node: ts.CallExpression | ts.NewExpression; scope: ScopeEntity }[],
  diagnostics: Diagnostic[],
  file: string,
): void {
  const componentScopes = getComponentScopes(graph);
  const countByComponent = new Map<ScopeEntity, number>();

  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const info = getEnclosingComponentScope(graph, call.scope);
    if (!info || !componentScopes.has(info.scope)) continue;

    const count = (countByComponent.get(info.scope) ?? 0) + 1;
    countByComponent.set(info.scope, count);

    if (count > 1) {
      diagnostics.push(
        createDiagnostic(file, call.node, graph.sourceFile, "children-helper-misuse", "multipleChildrenCalls", messages.multipleChildrenCalls, "error"),
      );
    }
  }
}

/**
 * Check for props.children access in tracked contexts.
 *
 * @param graph - The SolidGraph instance
 * @param propsVars - The props variables to check
 * @param diagnostics - Array to push diagnostics into
 */
function checkPropsChildrenAccess(
  graph: SolidGraph,
  propsVars: readonly { reads: readonly { node: ts.Node; scope: ScopeEntity }[] }[],
  diagnostics: Diagnostic[],
  file: string,
): void {
  for (let i = 0, vlen = propsVars.length; i < vlen; i++) {
    const propsVar = propsVars[i];
    if (!propsVar) continue;
    const reads = propsVar.reads;
    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;
      const parent = read.node.parent;

      if (!parent || !ts.isPropertyAccessExpression(parent) || parent.expression !== read.node) continue;
      if (!isChildrenProperty(parent)) continue;
      if (getEffectiveTrackingContext(graph, read.scope).type !== "tracked") continue;

      diagnostics.push(
        createDiagnostic(file, parent, graph.sourceFile, "children-helper-misuse", "directChildrenAccess", messages.directChildrenAccess, "error"),
      );
    }
  }
}

/**
 * Check if a member expression accesses the 'children' property.
 *
 * @param expr - The member expression to check
 * @returns true if accessing .children or ["children"]
 */
function isChildrenProperty(expr: ts.PropertyAccessExpression): boolean {
  return ts.isIdentifier(expr.name) && expr.name.text === "children";
}
