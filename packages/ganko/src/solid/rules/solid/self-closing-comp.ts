/**
 * Self Closing Component Rule
 *
 * Enforce consistent self-closing syntax for JSX elements.
 *
 * Elements with no children should be written as self-closing for consistency and clarity.
 *
 * Enforce self-closing for:
 * ```
 * // Bad
 * <Component></Component>
 * <div></div>
 * <MyComponent attr="value"></MyComponent>
 *
 * // Good
 * <Component />
 * <div />
 * <MyComponent attr="value" />
 * ```
 *
 * Don't self-close when there are children:
 * ```
 * // Bad
 * <div />
 *   Content here
 * </div>
 *
 * // Good
 * <div>
 *   Content here
 * </div>
 * ```
 *
 * Void elements like <img>, <br>, <input> should always be self-closing:
 * ```
 * <img src="..." />
 * <br />
 * <input type="text" />
 * ```
 */

import ts from "typescript";
import { HTML_VOID_ELEMENTS } from "@drskillissue/ganko-shared";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import type { JSXElementEntity, JSXChildEntity } from "../../entities";

const NON_NBSP_WHITESPACE_G = /(?!\xA0)\s/g;

/**
 * The type of element being analyzed.
 */
type ElementType = "component" | "html-void" | "html-non-void";

/**
 * Check if an element name is a void HTML element.
 *
 * Void elements like img, br, input cannot have children and should
 * always be self-closing.
 *
 * @param name - The element tag name
 * @returns True if the element is a void HTML element
 */
function isVoidDOMElement(name: string): boolean {
  return HTML_VOID_ELEMENTS.has(name);
}

/**
 * Determine the type of a JSX element.
 *
 * Classifies elements as components, void HTML elements, or regular HTML elements.
 * This determines the self-closing rules that apply.
 *
 * @param element - The JSX element to classify
 * @returns The element type classification
 */
function getElementType(element: JSXElementEntity): ElementType {
  // Components: member expressions or PascalCase identifiers
  if (!element.isDomElement) {
    return "component";
  }

  // DOM elements: check if void
  if (element.tag && isVoidDOMElement(element.tag)) {
    return "html-void";
  }

  return "html-non-void";
}

/**
 * Determine if a JSX element can be safely converted to self-closing syntax.
 *
 * An element can be self-closed if it has:
 * - No children, OR
 * - Only whitespace/newline text nodes (formatting whitespace from the source)
 *
 * This prevents converting elements with meaningful content to self-closing form.
 *
 * @param children - The children of the JSX element
 * @returns True if the element can be self-closed without losing content
 */
function canSelfClose(children: readonly JSXChildEntity[]): boolean {

  if (children.length === 0) return true;

  if (children.length !== 1) return false;

  const child = children[0];
  if (!child) return false;
  if (child.kind !== "text") return false;
  if (!ts.isJsxText(child.node)) return false;

  if (child.node.text.indexOf("\n") === -1) return false;

  // Check if it's only whitespace (excluding non-breaking spaces)
  return child.node.text.replace(NON_NBSP_WHITESPACE_G, "") === "";
}

const options = {
  component: "all",
  html: "all",
};

/**
 * Determine if an element should be self-closed based on options.
 *
 * Checks the rule configuration to see if this type of element should
 * use self-closing syntax when it has no children.
 *
 * @param elementType - The type of element (component, void, or non-void HTML)
 * @param options - The rule configuration options
 * @returns True if the element should be self-closed
 */
function shouldBeSelfClosed(elementType: ElementType): boolean {
  switch (elementType) {
    case "component": {
      return options.component === "all";
    }
    case "html-void": {
      return options.html === "all" || options.html === "void";
    }
    case "html-non-void": {
      return options.html === "all";
    }
  }
}

const messages = {
  selfClose:
    "Empty elements should be self-closing. Use `<{{name}} />` instead of `<{{name}}></{{name}}>` for cleaner, more concise JSX.",
  dontSelfClose:
    "This element should not be self-closing based on your configuration. Use `<{{name}}></{{name}}>` instead of `<{{name}} />` for explicit opening and closing tags.",
} as const;

export const selfClosingComp = defineSolidRule({
  id: "self-closing-comp",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow extra closing tags for components without children.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const elements = graph.jsxElements;
    if (elements.length === 0) return;

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      if (!element) continue;
      // Skip fragments (tag is null for fragments)
      if (!element.tag) {
        continue;
      }

      // element.node must be JsxElement when tag is present
      if (!ts.isJsxElement(element.node)) continue;
      const jsxElement = element.node;
      const openingElement = jsxElement.openingElement;

      // Guard: Element must be able to self-close (no meaningful children)

      if (!canSelfClose(element.children)) {
        continue;
      }

      // Note: element.tag is guaranteed non-null here due to the check above
      const tagName = element.tag;
      const elementType = getElementType(element);
      const shouldSelfClose = shouldBeSelfClosed(elementType);

      // Case 1: Should be self-closing but isn't
      // JsxElement always has opening and closing elements
      if (shouldSelfClose) {
        const closingElement = jsxElement.closingElement;
        const message = resolveMessage(messages.selfClose, { name: tagName });
        const fix = [{
          range: [openingElement.end - 1, closingElement.end] as const,
          text: " />",
        }];
        emit(
          createDiagnostic(graph.filePath, openingElement, graph.sourceFile, "self-closing-comp", "selfClose", message, "warn", fix),
        );
      }
    }
  },
});
