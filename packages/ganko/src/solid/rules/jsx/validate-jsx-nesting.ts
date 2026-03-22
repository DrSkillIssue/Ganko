/**
 * Validate JSX Nesting Rule
 *
 * Enforce valid HTML element nesting in JSX.
 *
 * This rule catches invalid DOM nesting patterns that would cause browser errors:
 * - Void elements (img, br, input, etc.) cannot have children
 * - List elements (`<li>`) must be inside `<ul>` or `<ol>`
 * - Table structure (`<td>`, `<tr>`) must follow HTML table nesting rules
 * - `<select>` can only contain `<option>` or `<optgroup>` children
 * - `<dl>` can only contain `<dt>` and `<dd>` children
 *
 * These nesting violations are often silently ignored by browsers but can cause
 * rendering bugs, accessibility issues, or unexpected behavior.
 */

import ts from "typescript";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import type { JSXElementEntity } from "../../entities/jsx";
import { findEnclosingDOMElement } from "../../queries";
import { HTML_VOID_ELEMENTS, HEADING_ELEMENTS, isBlank } from "@drskillissue/ganko-shared";

const messages = {
  invalidNesting: "Invalid HTML nesting: <{{child}}> cannot be a child of <{{parent}}>. {{reason}}.",
  voidElementWithChildren: "<{{parent}}> is a void element and cannot have children. Found <{{child}}> as a child.",
  invalidListChild: "<{{child}}> is not a valid direct child of <{{parent}}>. Only <li> elements can be direct children of <ul> and <ol>.",
  invalidSelectChild: "<{{child}}> is not a valid direct child of <select>. Only <option> and <optgroup> elements are allowed.",
  invalidTableChild: "<{{child}}> is not a valid direct child of <{{parent}}>. Expected: {{expected}}.",
  invalidDlChild: "<{{child}}> is not a valid direct child of <dl>. Only <dt>, <dd>, and <div> elements are allowed.",
} as const;

/**
 * Block-level elements that cannot be nested inside `<p>` elements.
 * Per HTML5 spec, `<p>` can only contain phrasing content.
 */
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

/**
 * Interactive content that cannot be nested inside buttons.
 * https://html.spec.whatwg.org/multipage/dom.html#interactive-content
 */
const INTERACTIVE_ELEMENTS = new Set([
  "a",
  "audio",
  "button",
  "details",
  "embed",
  "iframe",
  "img",
  "input",
  "label",
  "select",
  "textarea",
  "video",
]);

/**
 * Valid direct children of `<ul>` and `<ol>`.
 */
const VALID_LIST_CHILDREN = new Set(["li", "script", "template"]);

/**
 * Valid direct children of `<select>`.
 */
const VALID_SELECT_CHILDREN = new Set(["option", "optgroup", "script", "template", "hr"]);

/**
 * Valid direct children of `<dl>`.
 */
const VALID_DL_CHILDREN = new Set(["dt", "dd", "div", "script", "template"]);

/**
 * Valid direct children of `<table>`.
 */
const VALID_TABLE_CHILDREN = new Set([
  "caption",
  "colgroup",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "script",
  "template",
]);

/**
 * Valid direct children of `<tr>`.
 */
const VALID_TR_CHILDREN = new Set(["td", "th", "script", "template"]);

/**
 * Valid direct children of `<thead>`, `<tbody>`, `<tfoot>`.
 */
const VALID_TABLE_SECTION_CHILDREN = new Set(["tr", "script", "template"]);

/**
 * Parents that have special nesting rules.
 * If a parent is not in this set, any child is valid (for nesting purposes).
 */
const PARENTS_WITH_NESTING_RULES = new Set([

  "p",

  "a",
  "button",

  "form",
  "label",

  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",

  "ul",
  "ol",

  "select",

  "dl",

  "table",
  "tr",
  "thead",
  "tbody",
  "tfoot",
]);

interface NestingError {
  messageKey: keyof typeof messages;
  data: Record<string, string>;
}

/**
 * Check if a child element is validly nested within a parent element.
 * Returns an error object if invalid, null if valid.
 *
 * Note: parent and child are assumed to already be lowercase DOM element names.
 * This is guaranteed by the caller which only passes tags from elements where
 * isDomElement is true (which requires lowercase first character).
 *
 * @param parent - The parent element name (lowercase)
 * @param child - The child element name (lowercase)
 * @returns NestingError if nesting is invalid, null if valid
 */
function checkNesting(parent: string, child: string): NestingError | null {

  switch (parent) {
    case "p":
      if (BLOCK_ELEMENTS.has(child)) {
        return {
          messageKey: "invalidNesting",
          data: {
            parent,
            child,
            reason: `<p> cannot contain block-level elements like <${child}>`,
          },
        };
      }
      break;

    case "a":
      if (child === "a") {
        return {
          messageKey: "invalidNesting",
          data: { parent, child, reason: "<a> elements cannot be nested" },
        };
      }
      break;

    case "button":
      if (INTERACTIVE_ELEMENTS.has(child)) {
        return {
          messageKey: "invalidNesting",
          data: {
            parent,
            child,
            reason: `<button> cannot contain interactive elements like <${child}>`,
          },
        };
      }
      break;

    case "form":
      if (child === "form") {
        return {
          messageKey: "invalidNesting",
          data: { parent, child, reason: "<form> elements cannot be nested" },
        };
      }
      break;

    case "label":
      if (child === "label") {
        return {
          messageKey: "invalidNesting",
          data: { parent, child, reason: "<label> elements cannot be nested" },
        };
      }
      break;

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      if (HEADING_ELEMENTS.has(child)) {
        return {
          messageKey: "invalidNesting",
          data: { parent, child, reason: "heading elements cannot be nested" },
        };
      }
      break;

    case "ul":
    case "ol":
      if (!VALID_LIST_CHILDREN.has(child)) {
        return {
          messageKey: "invalidListChild",
          data: { parent, child },
        };
      }
      break;

    case "select":
      if (!VALID_SELECT_CHILDREN.has(child)) {
        return {
          messageKey: "invalidSelectChild",
          data: { parent, child },
        };
      }
      break;

    case "dl":
      if (!VALID_DL_CHILDREN.has(child)) {
        return {
          messageKey: "invalidDlChild",
          data: { parent, child },
        };
      }
      break;

    case "table":
      if (!VALID_TABLE_CHILDREN.has(child)) {
        return {
          messageKey: "invalidTableChild",
          data: { parent, child, expected: "caption, colgroup, thead, tbody, tfoot, or tr" },
        };
      }
      break;

    case "tr":
      if (!VALID_TR_CHILDREN.has(child)) {
        return {
          messageKey: "invalidTableChild",
          data: { parent, child, expected: "td or th" },
        };
      }
      break;

    case "thead":
    case "tbody":
    case "tfoot":
      if (!VALID_TABLE_SECTION_CHILDREN.has(child)) {
        return {
          messageKey: "invalidTableChild",
          data: { parent, child, expected: "tr" },
        };
      }
      break;
  }

  return null;
}

/**
 * Check if a JSX element has any meaningful children.
 *
 * Uses the entity's children array which contains pre-analyzed child information.
 * Text children are checked for non-whitespace content.
 *
 * @param element - The JSX element entity to check
 * @returns True if the element has meaningful (non-whitespace) children
 */
function hasChildren(element: JSXElementEntity): boolean {
  const children = element.children;
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.kind === "text") {
      // Text nodes need their actual content checked for whitespace
      const node = child.node;
      if (ts.isJsxText(node) && !isBlank(node.text)) {
        return true;
      }
    } else {
      // Element or expression children are always meaningful
      return true;
    }
  }
  return false;
}

const options = {}

export const validateJsxNesting = defineSolidRule({
  id: "validate-jsx-nesting",
  severity: "error",
  messages,
  meta: {
    description: "Validates that HTML elements are nested according to the HTML5 specification.",
    fixable: false,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const elements = graph.jsxElements;
    if (elements.length === 0) return;

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      if (!element) continue;

      if (!element.isDomElement || !element.tag) {
        continue;
      }

      const childTag = element.tag;
      const node = element.node;

      // Check for void elements with children
      if (HTML_VOID_ELEMENTS.has(childTag) && hasChildren(element)) {
        // Only JSXElement nodes have openingElement - fragments don't have tags
        if (ts.isJsxElement(node)) {
          emit(
            createDiagnostic(
              graph.filePath,
              node.openingElement,
              graph.sourceFile,
              "validate-jsx-nesting",
              "voidElementWithChildren",
              resolveMessage(messages.voidElementWithChildren, { parent: childTag, child: "content" }),
              "error",
            ),
          );
        }
        continue;
      }

      // Use graph API to find enclosing DOM element
      const parentElement = findEnclosingDOMElement(graph, element);
      if (!parentElement || !parentElement.tag) {
        continue;
      }

      const parentTag = parentElement.tag;

      // Skip nesting check if parent has no special rules.
      // Most DOM elements (div, span, section, etc.) have no child restrictions.
      // Also skips void elements (already reported above).
      if (!PARENTS_WITH_NESTING_RULES.has(parentTag)) {
        continue;
      }

      const error = checkNesting(parentTag, childTag);
      if (error) {
        // Only JSXElement nodes have openingElement - fragments don't have tags
        if (ts.isJsxElement(node)) {
          emit(
            createDiagnostic(
              graph.filePath,
              node.openingElement,
              graph.sourceFile,
              "validate-jsx-nesting",
              error.messageKey,
              resolveMessage(messages[error.messageKey], error.data),
              "error",
            ),
          );
        }
      }
    }
  },
});
