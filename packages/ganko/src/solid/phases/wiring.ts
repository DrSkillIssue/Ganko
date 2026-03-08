/**
 * Wiring Phase (Phase 5)
 *
 * Establishes relationships between entities created in previous phases.
 *
 * This phase:
 * - Wires JSX parent/child hierarchy
 * - Sets enclosing component for nested scopes
 * - Resolves call targets (links CallEntity to FunctionEntity)
 * - Builds call site lists on functions
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import { getVariableByNameInScope } from "../queries/scope";


export function runWiringPhase(graph: SolidGraph, _input: SolidInput): void {
    wireJSXHierarchy(graph);
    wireEnclosingComponents(graph);
    resolveCallTargets(graph);
    wireCalleeRootVariables(graph);
    analyzeTypeAssertions(graph);
};

/**
 * Wires JSX parent-child relationships based on AST hierarchy.
 * @param graph - The solid graph to populate
 */
function wireJSXHierarchy(graph: SolidGraph): void {
  const elements = graph.jsxElements;
  if (elements.length === 0) return;

  // Build parent-child relationships by checking AST hierarchy
  for (let i = 0, len = elements.length; i < len; i++) {
    const element = elements[i];
    if (!element) continue;
    const parentNode = findParentJSXNode(element.node);
    if (parentNode) {
      const parentElement = graph.jsxByNode.get(parentNode);
      if (parentElement) {
        element.parent = parentElement;
        parentElement.childElements.push(element);
      }
    }
  }
}

/**
 * Finds the nearest parent JSX element or fragment in the AST.
 * @param node - The JSX node
 * @returns The parent JSX node or null
 */
function findParentJSXNode(node: T.JSXElement | T.JSXFragment): T.JSXElement | T.JSXFragment | null {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "JSXElement" || current.type === "JSXFragment") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Sets the enclosing component reference for each scope.
 * @param graph - The solid graph to populate
 */
function wireEnclosingComponents(graph: SolidGraph): void {
  const scopes = graph.scopes;
  if (scopes.length === 0) return;
  const componentScopes = graph.componentScopes;

  for (let i = 0, len = scopes.length; i < len; i++) {
    const scope = scopes[i];
    if (!scope) continue;
    let current = scope.parent;

    while (current) {
      const component = componentScopes.get(current);
      if (component) {
        scope._enclosingComponent = component;
        break;
      }
      current = current.parent;
    }
  }
}

/**
 * Resolves call targets by matching callee names to function definitions.
 * @param graph - The solid graph to populate
 */
function resolveCallTargets(graph: SolidGraph): void {
  const calls = graph.calls;
  if (calls.length === 0) return;

  const functionsByName = graph.functionsByName;

  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const callee = call.node.callee;

    if (callee.type === "Identifier") {
      const fns = functionsByName.get(callee.name);
      if (fns && fns.length === 1) {
        const target = fns[0];
        if (!target) continue;
        call.resolvedTarget = target;
        target.callSites.push(call);
      }
    }
  }
}



/**
 * Resolves the root variable for each call's callee expression.
 *
 * Walks MemberExpression chains to find the leftmost identifier, then
 * resolves it against the scope chain. Globals like `console`, `document`,
 * `Math` have no VariableEntity in the graph and remain null.
 *
 * @param graph - The solid graph to populate
 */
function wireCalleeRootVariables(graph: SolidGraph): void {
  const calls = graph.calls;
  if (calls.length === 0) return;

  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const name = extractCalleeRootName(call.callee);
    if (name === null) continue;
    call.calleeRootVariable = getVariableByNameInScope(graph, name, call.scope);
  }
}

/**
 * Extracts the root identifier name from a callee expression.
 *
 * Walks through MemberExpression chains to find the leftmost Identifier.
 * Returns null for non-identifier-rooted callees (CallExpression, ThisExpression,
 * Super, ConditionalExpression, etc.).
 *
 * @param node - The callee expression to extract from
 * @returns The root identifier name or null
 */
function extractCalleeRootName(node: T.Expression | T.Super): string | null {
  let current: T.Expression | T.Super = node;
  for (;;) {
    if (current.type === "Identifier") return current.name;
    if (current.type === "MemberExpression") { current = current.object; continue; }
    return null;
  }
}

/**
 * Analyzes type assertions to detect unnecessary casts.
 * Uses TypeScript type checker to determine if expression type
 * is already assignable to target type.
 * @param graph - The solid graph to populate
 */
function analyzeTypeAssertions(graph: SolidGraph): void {
  const assertions = graph.typeAssertions;
  if (assertions.length === 0) return;

  const typeResolver = graph.typeResolver;
  if (!typeResolver.hasTypeInfo()) return;

  for (let i = 0, len = assertions.length; i < len; i++) {
    const assertion = assertions[i];
    if (!assertion) continue;

    // Skip const-assertions and cast-to-any/unknown - they're intentional
    if (
      assertion.kind === "const-assertion" ||
      assertion.kind === "cast-to-any" ||
      assertion.kind === "cast-to-unknown"
    ) {
      continue;
    }

    // Check if the cast is unnecessary
    const isUnnecessary = typeResolver.isUnnecessaryCast(
      assertion.expression,
      assertion.typeAnnotation,
    );

    assertion.isUnnecessary = isUnnecessary;

    // Get expression type for error messages if cast is unnecessary
    if (isUnnecessary) {
      assertion.expressionType = typeResolver.getTypeString(assertion.expression);
    }
  }
}
