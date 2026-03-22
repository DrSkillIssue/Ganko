/**
 * Store Reactive Break Rule
 *
 * Detect patterns that break Solid stores' reactivity.
 *
 * Stores are reactive only when accessed directly. Breaking reactivity causes:
 * - Values don't update when store changes
 * - Stale data in components
 * - Components don't re-render on store changes
 *
 * This rule detects:
 * 1. Spreading stores: `{...store}` - creates static snapshot
 * 2. Top-level destructuring: `const { count } = store` - loses reactivity
 * 3. Top-level access: `const count = store.count` - captures value once
 *
 * Problem patterns:
 * ```
 * const [store, setStore] = createStore({ count: 0 });
 * const count = store.count;  // BREAKS: static value
 * const { count } = store;    // BREAKS: static value
 * const copy = {...store};    // BREAKS: static snapshot
 * ```
 *
 * Correct patterns:
 * ```
 * <div>{store.count}</div>                    // Access in JSX
 * createEffect(() => console.log(store.count)) // Access in reactive context
 * createMemo(() => store.count * 2)            // Derived computation
 * ```
 */

import ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { VariableEntity, ReadEntity } from "../../entities";
import type { Diagnostic } from "../../../diagnostic"
import { getEffectiveTrackingContext } from "../../queries/scope";
import { getStoreVariables } from "../../queries/get";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";



const messages = {
  storeSpread:
    "Spreading a store ({...store}) creates a static snapshot that won't update. Access store properties directly in JSX or tracked contexts.",
  storeTopLevelAccess:
    "Accessing store property '{{property}}' at component top-level captures the value once. Access store.{{property}} directly in JSX or wrap in createMemo().",
  storeDestructure:
    "Destructuring a store breaks reactivity. Access properties via store.{{property}} instead of destructuring.",
} as const;

const options = {};

export const storeReactiveBreak = defineSolidRule({
  id: "store-reactive-break",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect patterns that break store reactivity: spreading stores, top-level property extraction, or destructuring",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const diagnostics: Diagnostic[] = [];

    // Store variables are detected during graph building from createStore/createMutable calls
    const storeVariables = getStoreVariables(graph);
    if (storeVariables.length === 0) {
      return;
    }

    // Check each store variable for reactivity-breaking patterns
    for (let i = 0, len = storeVariables.length; i < len; i++) {
      const storeVar = storeVariables[i];
      if (!storeVar) return;
      checkStoreVariable(graph, storeVar, diagnostics, graph.filePath);
    }

    for (const diagnostic of diagnostics) {
      emit(diagnostic);
    }
  },
});

/**
 * Check a store variable for reactivity-breaking patterns.
 *
 * Examines all reads of the store variable to detect patterns that break
 * reactivity: spreading, destructuring, or top-level property access.
 *
 * @param graph - The program graph for context analysis
 * @param storeVar - The store variable to check
 * @param diagnostics - Array to add diagnostics to (mutated)
 */
function checkStoreVariable(
  graph: SolidGraph,
  storeVar: VariableEntity,
  diagnostics: Diagnostic[],
  file: string,
): void {
  const reads = storeVar.reads;

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const readNode = read.node;
    const parent = readNode.parent;

    if (!parent) continue;

    // Check for spread: { ...store }
    if (isSpreadPattern(parent, readNode)) {
      diagnostics.push(
        createDiagnostic(file, parent, graph.sourceFile, "store-reactive-break", "storeSpread", messages.storeSpread, "error"),
      );
      continue;
    }

    // Check for destructuring: const { prop } = store
    const destructureResult = isDestructuringPattern(parent, readNode);
    if (destructureResult) {
      const properties = getDestructuredPropertyNames(destructureResult.pattern);
      for (let j = 0, plen = properties.length; j < plen; j++) {
        const propName = properties[j];
        if (!propName) continue;
        const msg = resolveMessage(messages.storeDestructure, { property: propName });
        diagnostics.push(
          createDiagnostic(file, destructureResult.pattern, graph.sourceFile, "store-reactive-break", "storeDestructure", msg, "error"),
        );
      }
      continue;
    }

    // Check for top-level property access: const name = store.name
    if (ts.isPropertyAccessExpression(parent) && isTopLevelPropertyAccess(graph, read, parent, readNode)) {
      const propertyName = getPropertyName(parent);
      if (propertyName) {
        const msg = resolveMessage(messages.storeTopLevelAccess, { property: propertyName });
        diagnostics.push(
          createDiagnostic(file, parent, graph.sourceFile, "store-reactive-break", "storeTopLevelAccess", msg, "error"),
        );
      }
    }
  }
}

/**
 * Check if the read is part of a spread expression.
 *
 * Detects pattern: { ...store } or [...store]
 * Spreading creates a static snapshot that won't update reactively.
 *
 * @param parent - The parent node of the read
 * @param readNode - The store variable read node
 * @returns True if this is a spread pattern
 */
function isSpreadPattern(parent: ts.Node, readNode: ts.Node): boolean {
  // Object spread: { ...store }
  if (ts.isSpreadAssignment(parent) && parent.expression === readNode) {
    return true;
  }
  // Array spread: [...store]
  if (ts.isSpreadElement(parent) && parent.expression === readNode) {
    return true;
  }
  return false;
}

/**
 * Check if the read is part of a destructuring pattern.
 *
 * Detects patterns:
 * - const { prop } = store
 * - ({ prop } = store)
 *
 * Destructuring extracts static values that won't update reactively.
 *
 * @param parent - The parent node of the read
 * @param readNode - The store variable read node
 * @returns Object with the destructuring pattern if found, null otherwise
 */
function isDestructuringPattern(
  parent: ts.Node,
  readNode: ts.Node,
): { pattern: ts.ObjectBindingPattern } | null {
  // VariableDeclarator with ObjectPattern: const { prop } = store
  if (ts.isVariableDeclaration(parent) && parent.initializer === readNode) {
    if (ts.isObjectBindingPattern(parent.name)) {
      return { pattern: parent.name };
    }
  }

  // AssignmentExpression with ObjectPattern: ({ prop } = store)
  if (ts.isBinaryExpression(parent) && parent.right === readNode && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (ts.isObjectLiteralExpression(parent.left)) {
      // In TS compiler API, destructuring assignment uses ObjectLiteralExpression
      // This case is unusual; typically handled differently
      return null;
    }
  }

  return null;
}

/**
 * Get the property names from a destructuring pattern.
 *
 * Extracts property names from { prop1, prop2: alias, ...rest } patterns.
 *
 * @param pattern - The object destructuring pattern
 * @returns Array of property names being destructured
 */
function getDestructuredPropertyNames(pattern: ts.ObjectBindingPattern): string[] {
  const names: string[] = [];
  const elements = pattern.elements;

  for (let i = 0, len = elements.length; i < len; i++) {
    const el = elements[i];
    if (!el) continue;
    if (ts.isBindingElement(el)) {
      const propName = el.propertyName ?? el.name;
      if (ts.isIdentifier(propName)) {
        names.push(propName.text);
      }
    }
  }

  return names;
}

/**
 * Check if this is a top-level property access that breaks reactivity.
 *
 * Pattern: const name = store.name (at component top-level)
 * This captures the value once and won't update when the store changes.
 *
 * Property access is fine in:
 * - JSX: <div>{store.name}</div>
 * - Tracked contexts: createEffect(() => store.name)
 * - Deferred contexts: onClick={() => store.name}
 *
 * @param graph - The program graph for context analysis
 * @param read - The store variable read entity
 * @param parent - The parent node of the read
 * @param readNode - The store variable read node
 * @returns True if this is a problematic top-level property access
 */
function isTopLevelPropertyAccess(
  graph: SolidGraph,
  read: ReadEntity,
  parent: ts.Node,
  readNode: ts.Node,
): boolean {

  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== readNode) {
    return false;
  }

  const memberParent = parent.parent;
  if (!memberParent) return false;

  // Only flag if assigned to a variable at component top-level
  if (!ts.isVariableDeclaration(memberParent) || memberParent.initializer !== parent) {
    return false;
  }

  // Check if we're at component top-level (not in a tracked/deferred scope)
  // getEffectiveTrackingContext returns the inherited context, so block scopes
  // inside components will inherit the "component-body" context automatically.
  const context = getEffectiveTrackingContext(graph, read.scope);

  // Component-body context means we're at the component body level (untracked)
  // - "component-body" = top-level component scope (or block scope inheriting it)
  // - "tracked" = inside createEffect/createMemo
  // - "deferred" = inside event handler
  // - "unknown" = might be safe
  return context.type === "component-body";
}

/**
 * Get the property name from a member expression.
 *
 * Handles both dot notation (store.prop) and bracket notation (store["prop"]).
 *
 * @param memberExpr - The member expression to extract the property from
 * @returns The property name as a string, or null if not extractable
 */
function getPropertyName(memberExpr: ts.PropertyAccessExpression): string | null {
  // PropertyAccessExpression always has an Identifier as .name
  return memberExpr.name.text;
}
