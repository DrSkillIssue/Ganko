/**
 * JSX No Duplicate Props Rule
 *
 * Disallow duplicate props in JSX elements.
 *
 * In Solid.js, duplicate props can cause unexpected behavior:
 * - Only one value will be used (typically the last one)
 * - Class props can break unexpectedly with multiple bindings
 * - Children can be specified in multiple conflicting ways
 *
 * This rule detects:
 * - Direct duplicate attributes: <div a="1" a="2" />
 * - Duplicates via spreads: <div a="1" {...{ a: "2" }} />
 * - Event handler normalization: onClick and on:click are the same
 * - Children conflicts: children prop vs JSX children vs innerHTML vs textContent
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { JSXElementEntity, JSXAttributeEntity } from "../../impl";
import { defineSolidRule } from "../../rule";
import type { Fix } from "../../../diagnostic"
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { getSourceCode } from "../../queries/get";
import { isWhitespace } from "@ganko/shared";

const ON_PREFIX = /^on(?:capture)?:/
const ATTR_PROP_PREFIX = /^(?:attr|prop):/

const messages = {
  noDuplicateProps:
    "Duplicate prop detected. Each prop should only be specified once; the second value will override the first.",
  noDuplicateClass:
    "Duplicate `class` prop detected. While this might appear to work, it can break unexpectedly because only one class binding is applied. Use `classList` to conditionally apply multiple classes.",
  noDuplicateChildren:
    "Conflicting children: {{used}}. Only one method of setting children is allowed at a time.",
} as const;

/**
 * Represents a detected duplicate prop issue.
 */
interface DuplicatePropIssue {
  node: T.Node;
  messageKey: "noDuplicateProps" | "noDuplicateClass" | "noDuplicateChildren";
  message: string;
  fix?: Fix;
}

/**
 * Context for tracking props within a single JSX element.
 */
interface PropAnalysisContext {
  seenProps: Set<string>;
  ignoreCase: boolean;
  issues: DuplicatePropIssue[];
  hasChildrenProp: boolean;
  hasInnerHTML: boolean;
  hasTextContent: boolean;
  sourceText: string;
}

/**
 * Normalize a prop name for duplicate detection.
 */
function normalizePropName(name: string, ignoreCase: boolean): string {
  if (ignoreCase || (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110)) {
    return name
      .toLowerCase()
      .replace(ON_PREFIX, "on")
      .replace(ATTR_PROP_PREFIX, "");
  }
  return name;
}

/**
 * Determine the appropriate error message key for a duplicate prop.
 */
function getMessageKeyForDuplicateProp(normalizedName: string): "noDuplicateClass" | "noDuplicateProps" {
  return normalizedName === "class" ? "noDuplicateClass" : "noDuplicateProps";
}

/**
 * Find token before node by scanning source text backwards.
 */
function findTokenEndBefore(node: T.Node, sourceText: string): number {
  let pos = node.range[0] - 1;
  while (pos >= 0 && isWhitespace(sourceText.charCodeAt(pos))) {
    pos--;
  }
  return pos + 1;
}

/**
 * Check a single prop for duplication against already-seen props.
 */
function checkPropForDuplication(ctx: PropAnalysisContext, name: string, propNode: T.Node, canFix: boolean): void {
  const normalizedName = normalizePropName(name, ctx.ignoreCase);

  if (ctx.seenProps.has(normalizedName)) {
    const fix: Fix | undefined = canFix
      ? [{
          range: [findTokenEndBefore(propNode, ctx.sourceText), propNode.range[1]],
          text: "",
        }]
      : undefined;

    const messageKey = getMessageKeyForDuplicateProp(normalizedName);
    const issue: DuplicatePropIssue = {
      node: propNode,
      messageKey,
      message: messages[messageKey],
    };
    if (fix !== undefined) issue.fix = fix;
    ctx.issues.push(issue);
    return;
  }

  ctx.seenProps.add(normalizedName);

  const lowerName = normalizedName.toLowerCase();
  if (lowerName === "children") {
    ctx.hasChildrenProp = true;
  } else if (lowerName === "innerhtml") {
    ctx.hasInnerHTML = true;
  } else if (lowerName === "textcontent") {
    ctx.hasTextContent = true;
  }
}

/**
 * Check for conflicts between different children-specifying methods.
 */
function checkChildrenConflicts(
  ctx: PropAnalysisContext,
  element: JSXElementEntity,
  openingElementNode: T.Node,
): void {
  const elementHasChildren = element.children.length > 0;

  let conflictCount = 0;
  if (ctx.hasChildrenProp) conflictCount++;
  if (elementHasChildren) conflictCount++;
  if (ctx.hasInnerHTML) conflictCount++;
  if (ctx.hasTextContent) conflictCount++;

  if (conflictCount > 1) {
    const usedMethods: string[] = [];
    if (ctx.hasChildrenProp) usedMethods.push("`props.children`");
    if (elementHasChildren) usedMethods.push("JSX children");
    if (ctx.hasInnerHTML) usedMethods.push("`props.innerHTML`");
    if (ctx.hasTextContent) usedMethods.push("`props.textContent`");

    ctx.issues.push({
      node: openingElementNode,
      messageKey: "noDuplicateChildren",
      message: resolveMessage(messages.noDuplicateChildren, { used: usedMethods.join(", ") }),
    });
  }
}

/**
 * Process all props from a spread attribute {...props}.
 */
function processSpreadAttribute(ctx: PropAnalysisContext, attr: JSXAttributeEntity): void {
  const spreadProps = attr.spreadProps;
  for (let i = 0, len = spreadProps.length; i < len; i++) {
    const prop = spreadProps[i];
    if (!prop) continue;
    checkPropForDuplication(ctx, prop.name, prop.keyNode, false);
  }
}

/**
 * Analyze all props on a JSX element for duplicates and conflicts.
 */
function analyzeElementProps(
  element: JSXElementEntity,
  ignoreCase: boolean,
  sourceText: string,
): DuplicatePropIssue[] {
  const ctx: PropAnalysisContext = {
    seenProps: new Set(),
    ignoreCase,
    issues: [],
    hasChildrenProp: false,
    hasInnerHTML: false,
    hasTextContent: false,
    sourceText,
  };

  const attributes = element.attributes;
  for (let i = 0, len = attributes.length; i < len; i++) {
    const attr = attributes[i];
    if (!attr) continue;
    if (attr.kind === "spread") {
      processSpreadAttribute(ctx, attr);
    } else if (attr.name) {
      checkPropForDuplication(ctx, attr.name, attr.node, true);
    }
  }

  if (element.node.type === "JSXElement") {
    checkChildrenConflicts(ctx, element, element.node.openingElement);
  }

  return ctx.issues;
}

const options = {}

export const jsxNoDuplicateProps = defineSolidRule({
  id: "jsx-no-duplicate-props",
  severity: "error",
  messages,
  meta: {
    description: "Disallow passing the same prop twice in JSX.",
    fixable: true,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const elements = graph.jsxElements;
    if (elements.length === 0) return;

    const ignoreCase = false;
    const sourceText = getSourceCode(graph).text;

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      if (!element) continue;

      if (element.node.type === "JSXFragment") {
        continue;
      }

      const issues = analyzeElementProps(element, ignoreCase, sourceText);

      for (let j = 0, issuesLen = issues.length; j < issuesLen; j++) {
        const issue = issues[j];
        if (!issue) continue;
        emit(createDiagnostic(graph.file, issue.node, "jsx-no-duplicate-props", issue.messageKey, issue.message, "error", issue.fix));
      }
    }
  },
});
