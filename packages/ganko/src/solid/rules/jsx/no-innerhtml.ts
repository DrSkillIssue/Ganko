/**
 * No innerHTML Rule
 *
 * Disallow usage of innerHTML prop in Solid.js components.
 *
 * innerHTML is dangerous because:
 * - XSS vulnerabilities: unsanitized HTML content can execute malicious scripts
 * - Escaping issues: HTML entities may not be properly handled
 * - DOM reset: setting innerHTML clears event listeners and component state
 *
 * This rule detects:
 * - Direct innerHTML prop: <div innerHTML={html} />
 * - Conflicts: innerHTML alongside JSX children or textContent
 * - Non-HTML content: warns if content isn't actually valid HTML
 *
 * Recommendations:
 * - Use JSX for static HTML
 * - Use sanitization libraries for dynamic HTML (DOMPurify)
 * - Use `innerText` or `textContent` for plain text
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import { ASTUtils } from "@typescript-eslint/utils";
import { isHtml } from "@drskillissue/ganko-shared";
import type { Diagnostic } from "../../../diagnostic"
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";
import type { JSXElementEntity, JSXAttributeEntity } from "../../entities/jsx";
import { getJSXAttributesByKind } from "../../queries/jsx";

const { getStringIfConstant } = ASTUtils;

const messages = {
  dangerous: "Using innerHTML with dynamic content is a security risk. Unsanitized user input can lead to cross-site scripting (XSS) attacks. Use a sanitization library or render content safely.",
  conflict: "The innerHTML prop will overwrite all child elements. Remove the children or use innerHTML on an empty element.",
  notHtml: "The innerHTML value doesn't appear to be HTML. If you're setting text content, use innerText instead for clarity and safety.",
  dangerouslySetInnerHTML: "The dangerouslySetInnerHTML is a React prop that Solid doesn't support. Use innerHTML instead.",
} as const

const options = {}

/**
 * Check if a JSX attribute is the React-style dangerouslySetInnerHTML prop
 * with the expected `{ __html: value }` structure.
 * @param node - The JSX attribute node to check
 * @returns The expression value if found, null otherwise
 */
function getDangerouslySetInnerHTMLValue(node: T.JSXAttribute): T.Expression | null {
  if (node.value?.type !== "JSXExpressionContainer") return null;

  const expr = node.value.expression;
  if (expr.type !== "ObjectExpression") return null;
  if (expr.properties.length !== 1) return null;

  const htmlProp = expr.properties[0];
  if (!htmlProp) return null;
  if (htmlProp.type !== "Property") return null;
  if (htmlProp.key.type !== "Identifier") return null;
  if (htmlProp.key.name !== "__html") return null;
  const value = htmlProp.value;
  if (value.type === "AssignmentPattern" || value.type === "TSEmptyBodyFunctionExpression") return null;

  return value;
}

/**
 * Check if the JSX element has children that would conflict with innerHTML.
 * @param element - The JSX element entity to check
 * @returns True if the element has children
 */
function hasConflictingChildren(element: JSXElementEntity): boolean {
  return element.children.length > 0;
}

/**
 * Build diagnostic for React's dangerouslySetInnerHTML prop.
 * @param file - The file path
 * @param node - The JSX attribute node
 * @returns A diagnostic for the attribute
 */
function buildDangerouslySetInnerHTMLDiagnostic(file: string, node: T.JSXAttribute): Diagnostic {
  const htmlValue = getDangerouslySetInnerHTMLValue(node);

  if (htmlValue) {
    const fix = [
      { range: [node.range[0], htmlValue.range[0]] as const, text: "innerHTML={" },
      { range: [htmlValue.range[1], node.range[1]] as const, text: "}" },
    ];
    return createDiagnostic(file, node, "no-innerhtml", "dangerouslySetInnerHTML", messages.dangerouslySetInnerHTML, "error", fix);
  }

  return createDiagnostic(file, node, "no-innerhtml", "dangerouslySetInnerHTML", messages.dangerouslySetInnerHTML, "error");
}

/**
 * Build diagnostic for innerHTML attribute issues.
 * @param file - The file path
 * @param node - The JSX attribute node
 * @param attr - The attribute entity from the graph
 * @param element - The parent JSX element entity
 * @param allowStatic - Whether static innerHTML is allowed
 * @returns A diagnostic or null if no issue
 */
function buildInnerHTMLDiagnostic(
  file: string,
  node: T.JSXAttribute,
  attr: JSXAttributeEntity,
  element: JSXElementEntity,
  allowStatic: boolean,
): Diagnostic | null {
  if (!allowStatic) {
    return createDiagnostic(file, node, "no-innerhtml", "dangerous", messages.dangerous, "error");
  }

  const innerHtmlExpr = attr.valueNode;
  if (!innerHtmlExpr) {
    return createDiagnostic(file, node, "no-innerhtml", "dangerous", messages.dangerous, "error");
  }
  const innerHtmlValue = getStringIfConstant(innerHtmlExpr);

  if (typeof innerHtmlValue !== "string") {
    return createDiagnostic(file, node, "no-innerhtml", "dangerous", messages.dangerous, "error");
  }

  if (isHtml(innerHtmlValue)) {
    if (hasConflictingChildren(element)) {
      return createDiagnostic(file, element.node, "no-innerhtml", "conflict", messages.conflict, "error");
    }
    return null;
  }

  const fix = [{ range: node.name.range, text: "innerText" }];
  return createDiagnostic(file, node, "no-innerhtml", "notHtml", messages.notHtml, "error", fix);
}

export const noInnerhtml = defineSolidRule({
  id: "no-innerhtml",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow usage of the innerHTML attribute, which can lead to security vulnerabilities.",
    fixable: true,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const allowStatic = true;

    const propAttrs = getJSXAttributesByKind(graph, "prop");
    if (propAttrs.length === 0) return;

    for (let i = 0, len = propAttrs.length; i < len; i++) {
      const entry = propAttrs[i];
      if (!entry) continue;
      const { attr, element } = entry;
      const attrName = attr.name;
      if (attr.node.type !== "JSXAttribute") continue;

      if (attrName === "dangerouslySetInnerHTML") {
        emit(buildDangerouslySetInnerHTMLDiagnostic(graph.file, attr.node));
        continue;
      }

      if (attrName === "innerHTML") {
        const issue = buildInnerHTMLDiagnostic(
          graph.file,
          attr.node,
          attr,
          element,
          allowStatic,
        );
        if (issue) {
          emit(issue);
        }
      }
    }
  },
});
