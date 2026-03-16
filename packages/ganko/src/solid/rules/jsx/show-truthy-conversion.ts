/**
 * show-truthy-conversion
 *
 * Detect `<Show when={expr}>` where `expr` is not explicitly boolean,
 * which may have unexpected truthy/falsy behavior.
 *
 * Problem:
 * In Solid.js, `<Show when={count()}>` will hide content when count is 0
 * because 0 is falsy. Similarly, an empty string '' is also falsy.
 * This can lead to unexpected behavior when developers expect the content
 * to show as long as the value exists.
 *
 * Examples:
 * - BAD:  <Show when={count()}>Count: {count()}</Show>
 * - BAD:  <Show when={name()}>Name: {name()}</Show>
 * - GOOD: <Show when={count() > 0}>Count: {count()}</Show>
 * - GOOD: <Show when={count() != null}>Has count</Show>
 * - GOOD: <Show when={Boolean(name())}>Name: {name()}</Show>
 */

import ts from "typescript";
import type { Diagnostic, Fix } from "../../../diagnostic"
import type { SolidGraph } from "../../impl";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import type { JSXElementEntity } from "../../entities/jsx";
import { isExplicitBooleanExpression, getExpressionName } from "../../util";
import { getJSXAttributeValue } from "../../queries/jsx";

// TypeScript TypeFlags for number/string detection
const TS_NUMBER_LIKE = 296; // Number | NumberLiteral
const TS_STRING_LIKE = 402653316; // String | StringLiteral | TemplateLiteral

/**
 * Check if a TypeScript type is potentially problematic for truthy/falsy checks.
 * Returns the problematic type name ("number" | "string") or null if safe.
 *
 * @param graph - The SolidGraph for type information
 * @param node - The AST node to check
 * @returns "number" or "string" if problematic, null if safe
 */
function getProblematicType(
   graph: SolidGraph,
   node: ts.Node,
 ): "number" | "string" | null {
  const typeInfo = graph.typeResolver.getType(node);
  if (!typeInfo) return null;

  // Check for number types (0 is falsy)
  if (typeInfo.flags & TS_NUMBER_LIKE) {
    return "number";
  }

  // Check for string types ('' is falsy)
  if (typeInfo.flags & TS_STRING_LIKE) {
    return "string";
  }

  return null;
}

const messages = {
  showNonBoolean:
    "<Show when={{{{expr}}}}> uses truthy/falsy conversion. Value '0' or empty string '' will hide content. Use explicit boolean: when={Boolean({{expr}})} or when={{{expr}}} != null}",
} as const;

/**
 * Create fix to wrap expression with != null check.
 */
function createNullCheckFix(node: ts.Node, sourceFile: ts.SourceFile): Fix {
  const text = node.getText(sourceFile);
  return [{ range: [node.getStart(sourceFile), node.end], text: `${text} != null` }];
}

/**
 * Analyze a Show element and return a diagnostic if the when prop
 * uses truthy/falsy conversion with a potentially problematic type.
 */
function analyzeShowElement(
   element: JSXElementEntity,
   graph: SolidGraph,
   file: string,
 ): Diagnostic | null {
  const whenNode = getJSXAttributeValue(graph, element, "when");
  if (!whenNode) return null;

  if (isExplicitBooleanExpression(whenNode)) return null;

  const problematicType = getProblematicType(graph, whenNode);
  if (!problematicType) return null;

  const exprText = getExpressionName(whenNode);
  if (!ts.isJsxElement(element.node)) return null;

  const fix = createNullCheckFix(whenNode, graph.sourceFile);

  return createDiagnostic(
    file,
    element.node.openingElement,
    graph.sourceFile,
    "show-truthy-conversion",
    "showNonBoolean",
    resolveMessage(messages.showNonBoolean, { expr: exprText }),
    "error",
    fix,
  );
}

const options = {}

export const showTruthyConversion = defineSolidRule({
  id: "show-truthy-conversion",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect <Show when={expr}> where expr is not explicitly boolean, which may have unexpected truthy/falsy behavior.",
    fixable: true,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    // This rule requires type checking
    if (!graph.typeResolver.hasTypeInfo()) {
      return;
    }

    // Get all <Show> elements using indexed lookup
    const showElements = graph.jsxByTag.get("Show");
    if (!showElements || showElements.length === 0) {
      return;
    }

    for (let i = 0, len = showElements.length; i < len; i++) {
      const element = showElements[i];
      if (!element) continue;

      // Skip DOM elements (lowercase <show> would be isDomElement: true)
      if (element.isDomElement) continue;

      const issue = analyzeShowElement(element, graph, graph.file);
      if (issue) {
        emit(issue);
      }
    }
  },
});
