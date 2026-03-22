/**
 * Inline Component Rule
 *
 * Prevent components from being defined inside other components.
 *
 * Defining a component inside another component causes:
 * - Component unmounts and remounts on every parent render
 * - Loss of component state
 * - Loss of DOM state (form inputs, scroll position, etc.)
 * - Unexpected behavior when component state should persist
 *
 * Problem:
 * ```
 * export const Parent = () => {
 *   const Button = () => <button>Click</button>;  // BAD: new component every render
 *   return <Button />;
 * };
 * ```
 *
 * Correct:
 * ```
 * const Button = () => <button>Click</button>;  // GOOD: defined once
 * export const Parent = () => <Button />;
 * ```
 *
 * If you need props from the parent, pass them as props:
 * ```
 * const Button = (props) => <button {...props}>Click</button>;
 * ```
 */

import ts from "typescript";
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";
import type { FunctionEntity } from "../../entities/function";
import { getEnclosingComponentScope } from "../../queries/scope";
import { isIIFE } from "../../util";

const MessageIds = {
  INLINE_COMPONENT:
    "Component '{{name}}' is defined inside another component. This creates a new component type on every render, causing unmount/remount. Move the component definition outside.",
} as const;

/**
 * Pattern for PascalCase names (component names in Solid/React)
 */
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;

const messages = {
  inlineComponent: MessageIds.INLINE_COMPONENT,
} as const;

const options = {};

export const inlineComponent = defineSolidRule({
  id: "inline-component",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect component functions defined inside other components, which causes remount on every parent update",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    // Get all component scopes - quick early exit
    const componentScopes = graph.componentScopes;
    if (componentScopes.size === 0) {
      return;
    }

    // Pre-build a Set of all component tags used in JSX (PascalCase = component)
    const usedComponentTags = new Set<string>();
    for (const el of graph.jsxElements) {
      if (el.tag && PASCAL_CASE_PATTERN.test(el.tag)) {
        usedComponentTags.add(el.tag);
      }
    }

    if (usedComponentTags.size === 0) {
      return;
    }

    // Check each function to see if it's an inline component
    for (const fn of graph.functions) {

      // fn.name covers function declarations: function MyComponent() {}
      // fn.variableName covers variable assignments: const MyComponent = () => {}
      const componentName = fn.name || fn.variableName;

      if (!componentName || !PASCAL_CASE_PATTERN.test(componentName)) {
        continue;
      }

      if (!usedComponentTags.has(componentName)) {
        continue;
      }

      // Check if function is inside a component scope (excluding itself)
      const parentScope = fn.scope.parent;
      if (!parentScope) {
        continue;
      }

      const parentComponent = getEnclosingComponentScope(graph, parentScope);
      if (!parentComponent) {
        continue;
      }

      // Skip render props (functions passed as props or children)
      if (isRenderProp(fn.node)) {
        continue;
      }

      if (isIIFE(fn.node)) {
        continue;
      }

      // This is an inline component - report it
      const reportNode = getReportNode(fn);
      const message = messages.inlineComponent.replace("{{name}}", componentName);
      emit(
        createDiagnostic(graph.filePath, reportNode, graph.sourceFile, "inline-component", "inlineComponent", message, "error"),
      );
    }
  },
});

/**
 * Check if a function node is a render prop (passed as a prop or child).
 *
 * Render props patterns:
 * - <Component render={() => <div />} />
 * - <Component>{() => <div />}</Component>
 * - <Component children={() => <div />} />
 *
 * @param node - The function node to check
 * @returns True if the node is a render prop, false otherwise
 */
function isRenderProp(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }

  if (ts.isJsxExpression(parent)) {
    const grandparent = parent.parent;

    // Child expression: <Component>{() => <div />}</Component>
    if (grandparent && (ts.isJsxElement(grandparent) || ts.isJsxSelfClosingElement(grandparent) || ts.isJsxFragment(grandparent))) {
      return true;
    }

    // Attribute value: <Component render={() => <div />} />
    if (grandparent && ts.isJsxAttribute(grandparent)) {
      return true;
    }
  }

  // e.g., createComponent(Component, { render: () => <div /> })
  if (ts.isPropertyAssignment(parent) && parent.parent && ts.isObjectLiteralExpression(parent.parent)) {
    const objParent = parent.parent.parent;
    if (objParent && ts.isCallExpression(objParent)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the node to report the error on.
 *
 * Prefers the variable declarator if available (for better error positioning),
 * otherwise uses the function identifier or the function itself.
 *
 * @param fn - The function entity to get the report node for
 * @returns The AST node to attach the error diagnostic to
 */
function getReportNode(fn: FunctionEntity): ts.Node {
  const node = fn.node;
  const parent = node.parent;

  if (parent && ts.isVariableDeclaration(parent)) {
    return parent;
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name;
  }

  return node;
}
