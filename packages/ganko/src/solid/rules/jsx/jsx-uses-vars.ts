/**
 * JSX Uses Vars Rule
 *
 * Detects variables that appear to be components or directives but are never
 * used in JSX. Reports imports/declarations that look like JSX-related code
 * but have no JSX references.
 *
 * Handles:
 * 1. Component references: `<Component />`, `<Namespace.Component />`
 * 2. Custom directives: `<div use:myDirective />`
 */

import type { SolidGraph } from "../../impl";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import { getVariablesByName } from "../../queries/get";

const UPPERCASE_START = /^[A-Z]/;

const messages = {
  unusedComponent: "Component '{{name}}' is imported but never used in JSX.",
  unusedDirective: "Directive '{{name}}' is imported but never used in JSX.",
} as const;

/**
 * Checks if a variable name looks like a component (PascalCase).
 */
function looksLikeComponent(name: string): boolean {
  return UPPERCASE_START.test(name);
}

/**
 * Collects all variable names referenced as JSX tags.
 */
function collectJsxTagReferences(graph: SolidGraph): Set<string> {
  const refs = new Set<string>();
  const elements = graph.jsxElements;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;
    if (!el.tag || el.isDomElement) continue;

    // For member expressions like Foo.Bar, extract root "Foo"
    const root = el.tag.split(".")[0];
    if (!root) continue;
    refs.add(root);
  }

  return refs;
}

/**
 * Collects all directive names used via use: namespace attributes.
 */
function collectDirectiveReferences(graph: SolidGraph): Set<string> {
  const refs = new Set<string>();
  const elements = graph.jsxElements;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;
    const attrs = el.attributes;
    for (let j = 0; j < attrs.length; j++) {
      const attr = attrs[j];
      if (!attr) continue;
      if (attr.namespace === "use" && attr.name) {
        refs.add(attr.name);
      }
    }
  }

  return refs;
}

const options = {}

export const jsxUsesVars = defineSolidRule({
  id: "jsx-uses-vars",
  severity: "warn",
  messages,
  meta: {
    description:
      "Detect imported components and directives that are never used in JSX.",
    fixable: false,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const jsxTagRefs = collectJsxTagReferences(graph);
    const directiveRefs = collectDirectiveReferences(graph);

    const imports = graph.imports;
    for (let i = 0; i < imports.length; i++) {
      const imp = imports[i];
      if (!imp) continue;
      if (imp.isTypeOnly) continue;
      const specifiers = imp.specifiers;

      for (let j = 0; j < specifiers.length; j++) {
        const spec = specifiers[j];
        if (!spec) continue;
        if (spec.isTypeOnly) continue;
        const name = spec.localName;

        // Check if it looks like a component but isn't used in JSX
        if (looksLikeComponent(name) && !jsxTagRefs.has(name)) {
          const variables = getVariablesByName(graph, name);
          const firstVar = variables.length > 0 ? variables[0] : undefined;
          if (firstVar && firstVar.reads.length === 0) {
            emit(
              createDiagnostic(
                graph.file,
                spec.node,
                "jsx-uses-vars",
                "unusedComponent",
                resolveMessage(messages.unusedComponent, { name }),
                "warn",
              ),
            );
          }
        }

        // Check if it looks like a directive but isn't used
        if (!looksLikeComponent(name) && !directiveRefs.has(name)) {
          if (imp.source.includes("directive") || name.startsWith("use")) {
            const variables = getVariablesByName(graph, name);
            const firstVar = variables.length > 0 ? variables[0] : undefined;
            if (firstVar && firstVar.reads.length === 0) {
              emit(
                createDiagnostic(
                  graph.file,
                  spec.node,
                  "jsx-uses-vars",
                  "unusedDirective",
                  resolveMessage(messages.unusedDirective, { name }),
                  "warn",
                ),
              );
            }
          }
        }
      }
    }
  },
});
