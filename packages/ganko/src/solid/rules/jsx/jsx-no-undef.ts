/**
 * JSX No Undef Rule
 *
 * Disallow undefined custom directives in JSX.
 * E.g. `<div use:myDirective />` where myDirective is not defined.
 *
 * Note: Component undefined checks are delegated to TypeScript.
 */

import ts from "typescript";
import type { Diagnostic } from "../../../diagnostic"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { JSXAttributeEntity, JSXElementEntity } from "../../entities/jsx";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import { isNameVisible } from "../../queries/scope";
import { getJSXAttributesByKind } from "../../queries/jsx";

const messages = {
  customDirectiveUndefined:
    "Custom directive '{{identifier}}' is not defined. Directives must be imported or declared in scope before use (e.g., `const {{identifier}} = (el, accessor) => { ... }`).",
} as const;

/**
 * Check a custom directive attribute for undefined directive reference.
 *
 * Custom directives use the `use:` namespace (e.g., `<div use:clickOutside />`).
 * The directive name must be defined in scope.
 *
 * @param attr - The JSX attribute entity to check
 * @param element - The JSX element containing the directive
 * @param graph - The SolidGraph for visibility checking
 * @returns A diagnostic if the directive is undefined, null otherwise
 */
function checkCustomDirective(
   attr: JSXAttributeEntity,
   element: JSXElementEntity,
   graph: SolidGraph,
   file: string,
 ): Diagnostic | null {
  // We know it starts with "use:" because kind === "directive" is already filtered
  const fullName = attr.name;
  if (!fullName) return null;

  // Extract directive name by removing "use:" prefix (4 characters)
  const directiveName = fullName.slice(4);

  // Note: Custom directives must always be defined, regardless of typescriptEnabled
  if (!isNameVisible(graph, directiveName, element.scope)) {
    if (!ts.isJsxAttribute(attr.node)) return null;
    const nameNode = attr.node.name;
    if (ts.isJsxNamespacedName(nameNode)) {
      return createDiagnostic(
        file,
        nameNode.name,
        graph.sourceFile,
        "jsx-no-undef",
        "customDirectiveUndefined",
        resolveMessage(messages.customDirectiveUndefined, { identifier: directiveName }),
        "error",
      );
    }
  }

  return null;
}

const options = {}

export const jsxNoUndef = defineSolidRule({
  id: "jsx-no-undef",
  severity: "error",
  messages,
  meta: {
    description: "Disallow references to undefined variables in JSX. Handles custom directives.",
    fixable: false,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const directiveAttrs = getJSXAttributesByKind(graph, "directive");

    if (directiveAttrs.length === 0) return;

    for (let i = 0, len = directiveAttrs.length; i < len; i++) {
      const entry = directiveAttrs[i];
      if (!entry) continue;
      const { attr, element } = entry;
      const directiveIssue = checkCustomDirective(attr, element, graph, graph.filePath);
      if (directiveIssue) {
        emit(directiveIssue);
      }
    }
  },
});
