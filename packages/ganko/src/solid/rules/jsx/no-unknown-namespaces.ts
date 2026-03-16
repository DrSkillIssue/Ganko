/**
 * No Unknown Namespaces Rule
 *
 * Disallow unknown XML namespaces in JSX elements.
 *
 * Detects usage of invalid or unrecognized namespace prefixes that indicate
 * either a typo or misunderstanding of how to use Solid features.
 */

import ts from "typescript";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";

type NamespaceCategory = "solid" | "xml" | "style" | "class" | "allowed" | "unknown";

const SOLID_NAMESPACES = new Set(["on", "oncapture", "use", "prop", "attr", "bool"]);
const XML_NAMESPACES = new Set(["xmlns", "xlink"]);
const STYLE_NAMESPACE = "style";
const CLASS_NAMESPACE = "class";

const VALID_NAMESPACES_LIST = Array.from(SOLID_NAMESPACES)
  .map((ns) => `${ns}:`)
  .join(", ");

/**
 * Categorize a namespace prefix.
 * @param namespace - The namespace prefix to categorize
 * @param allowedNamespaces - Set of user-allowed custom namespaces
 * @returns The category of the namespace
 */
function categorizeNamespace(namespace: string, allowedNamespaces: Set<string>): NamespaceCategory {
  if (SOLID_NAMESPACES.has(namespace)) return "solid";
  if (XML_NAMESPACES.has(namespace)) return "xml";
  if (namespace === STYLE_NAMESPACE) return "style";
  if (namespace === CLASS_NAMESPACE) return "class";
  if (allowedNamespaces.has(namespace)) return "allowed";
  return "unknown";
}

/**
 * Get the full namespaced attribute name.
 * @param node - The JSX namespaced name node
 * @returns The full attribute name as "namespace:name"
 */
function getFullAttributeName(node: ts.JsxNamespacedName): string {
  return `${node.namespace.text}:${node.name.text}`;
}





const messages = {
  unknownNamespace:
    "'{{namespace}}:' is not a recognized Solid namespace. " +
    "Valid namespaces are: {{validNamespaces}}.",
  styleNamespace:
    "The 'style:' namespace works but is discouraged. " +
    "Use the style prop with an object instead: style={{ {{property}}: value }}.",
  classNamespace:
    "The 'class:' namespace works but is discouraged. " +
    "Use the classList prop instead: classList={{ \"{{className}}\": condition }}.",
  componentNamespace:
    "Namespaced attributes like '{{namespace}}:' only work on DOM elements, not components. " +
    "The '{{fullName}}' attribute will be passed as a regular prop named '{{fullName}}'.",
} as const;

const options: { allowedNamespaces: string[] } = { allowedNamespaces: [] }

export const noUnknownNamespaces = defineSolidRule({
  id: "no-unknown-namespaces",
  severity: "error",
  messages,
  meta: {
    description:
      "Enforce using only Solid-specific namespaced attribute names (i.e. `'on:'` in `<div on:click={...} />`).",
    fixable: false,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const allowedNamespaces = new Set(options.allowedNamespaces);
    const elements = graph.jsxElements;
    if (elements.length === 0) return;

    for (let i = 0, elemLen = elements.length; i < elemLen; i++) {
      const element = elements[i];
      if (!element) continue;
      if (!element.tag) continue;

      const attributes = element.attributes;
      for (let j = 0, attrLen = attributes.length; j < attrLen; j++) {
        const attr = attributes[j];
        if (!attr) continue;
        if (attr.namespace === null) continue;
        if (!ts.isJsxAttribute(attr.node)) continue;
        const attrNode = attr.node;
        if (!ts.isJsxNamespacedName(attrNode.name)) continue;

        const attrNameNode = attrNode.name;
        const namespace = attrNameNode.namespace.text;
        const attrName = attrNameNode.name.text;
        const fullName = getFullAttributeName(attrNameNode);
        const isComponent = !element.isDomElement;

        if (isComponent) {
          emit(
            createDiagnostic(
              graph.file,
              attrNameNode,
              graph.sourceFile,
              "no-unknown-namespaces",
              "componentNamespace",
              resolveMessage(messages.componentNamespace, { namespace, fullName }),
              "error",
            ),
          );
          continue;
        }

        const category = categorizeNamespace(namespace, allowedNamespaces);
        if (category === "solid" || category === "xml" || category === "allowed") continue;

        if (category === "style") {
          emit(
            createDiagnostic(
              graph.file,
              attrNameNode,
              graph.sourceFile,
              "no-unknown-namespaces",
              "styleNamespace",
              resolveMessage(messages.styleNamespace, { property: attrName }),
              "error",
            ),
          );
          continue;
        }

        if (category === "class") {
          emit(
            createDiagnostic(
              graph.file,
              attrNameNode,
              graph.sourceFile,
              "no-unknown-namespaces",
              "classNamespace",
              resolveMessage(messages.classNamespace, { className: attrName }),
              "error",
            ),
          );
          continue;
        }

        emit(
          createDiagnostic(
            graph.file,
            attrNameNode,
            graph.sourceFile,
            "no-unknown-namespaces",
            "unknownNamespace",
            resolveMessage(messages.unknownNamespace, { namespace, fullName, validNamespaces: VALID_NAMESPACES_LIST }),
            "error",
          ),
        );
      }
    }
  },
});
