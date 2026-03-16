/**
 * Prefer Show Rule
 *
 * Suggest using `<Show>` component instead of && or ternary for conditional rendering.
 *
 * In Solid.js, `<Show>` provides cleaner semantics and correct behavior:
 * - Only the active branch is rendered
 * - Clear intent for conditional UI
 * - Correct handling of falsy values
 *
 * Problem with &&:
 * ```
 * {loading() && <Spinner />}
 * ```
 * - Renders "false" as a text node in the DOM if left side is falsy
 * - Uses an operator meant for logic, not rendering
 *
 * Problem with ternary:
 * ```
 * {loading() ? <Spinner /> : <Content />}
 * ```
 * - Both branches are evaluated
 * - Less clear that this is conditional rendering
 *
 * Better with <Show>:
 * ```
 * <Show when={loading()} fallback={<Content />}>
 *   <Spinner />
 * </Show>
 * ```
 * - Only active branch is rendered
 * - Explicit intent for conditional rendering
 * - Consistent with Solid.js control flow patterns
 *
 * This rule is a style preference - disabled by default.
 */

import ts from "typescript";
import type { SolidGraph } from "../../impl";
import type { Diagnostic, Fix, FixOperation } from "../../../diagnostic"
import { createDiagnostic } from "../../../diagnostic";
import { isAlphaNumeric, CHAR_UNDERSCORE, CHAR_DOLLAR, CHAR_SPACE, CHAR_TAB, CHAR_NEWLINE } from "@drskillissue/ganko-shared";
import { defineSolidRule } from "../../rule";
import { getJSXElements } from "../../queries";
import { buildSolidImportFix } from "../util";



const EXPENSIVE_TYPES = new Set([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.Identifier,
]);

/**
 * Check if char code is valid JS identifier char (letter, digit, underscore, dollar).
 */
function isJsIdentChar(code: number): boolean {
  return isAlphaNumeric(code) || code === CHAR_UNDERSCORE || code === CHAR_DOLLAR;
}

/**
 * Info about a type guard: the condition and the expression being narrowed.
 */
/** Equality/inequality operators used in typeof narrowing checks. */
const EQUALITY_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

interface TypeGuardInfo {
  /** The narrowed expression (e.g., `x` in `typeof x === "number"`) */
  narrowedExpr: ts.Expression;
}

/**
 * Extract type guard info from a condition expression.
 * Returns the narrowed expression if this is a type guard, null otherwise.
 *
 * Detects: typeof x === "type", x instanceof Class, Array.isArray(x), "prop" in x
 * @param expr - The expression to check for type guard patterns
 * @returns Type guard info or null if not a type guard
 */
function extractTypeGuard(expr: ts.Expression): TypeGuardInfo | null {
  if (ts.isBinaryExpression(expr)) {
    const { left, right, operatorToken } = expr;

    // x instanceof Class -> narrows x
    if (operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      return { narrowedExpr: left };
    }

    // "prop" in obj -> narrows obj
    if (operatorToken.kind === ts.SyntaxKind.InKeyword) {
      return { narrowedExpr: right };
    }

    // typeof x === "string" or "string" === typeof x
    if (EQUALITY_OPERATORS.has(operatorToken.kind)) {
      if (ts.isTypeOfExpression(left)) {
        return { narrowedExpr: left.expression };
      }
      if (ts.isTypeOfExpression(right)) {
        return { narrowedExpr: right.expression };
      }
    }

    return null;
  }

  if (ts.isCallExpression(expr)) {
    // Array.isArray(x) -> narrows x
    const c = expr.expression;
    if (!ts.isPropertyAccessExpression(c)) return null;
    if (!ts.isIdentifier(c.expression) || c.expression.text !== "Array") return null;
    if (c.name.text !== "isArray") return null;
    if (expr.arguments.length === 0) return null;
    const arg = expr.arguments[0];
    if (!arg) return null;
    if (ts.isSpreadElement(arg)) return null;
    return { narrowedExpr: arg };
  }

  return null;
}

/**
 * Find all occurrences of a target expression in source text by position.
 *
 * Uses text-based matching to find where the target appears in the expression,
 * then converts those text positions back to match indices for replacement.
 *
 * @param expr - The expression to search within
 * @param target - The target expression to find
 * @param sourceFile - The source file for text extraction
 * @returns Array of [start, end] ranges relative to expr's start position
 */
function findMatchPositions(
  expr: ts.Node,
  target: ts.Node,
  sourceFile: ts.SourceFile,
): Array<[number, number]> {
  const exprText = expr.getText(sourceFile);
  const targetText = target.getText(sourceFile);
  const matches: Array<[number, number]> = [];

  let pos = 0;
  while (true) {
    const idx = exprText.indexOf(targetText, pos);
    if (idx === -1) break;
    matches.push([idx, idx + targetText.length]);
    pos = idx + 1;
  }

  return matches;
}

/**
 * Check if a name appears as an identifier in an expression using source text.
 * Uses word boundary matching to avoid false positives from substrings.
 *
 * @param node - The AST node to check for identifier usage
 * @param name - The identifier name to search for
 * @param sourceFile - The source file for text extraction
 * @returns True if the name appears as an identifier
 */
function isNameUsedInSource(node: ts.Node, name: string, sourceFile: ts.SourceFile): boolean {
  const text = node.getText(sourceFile);
  const len = text.length;
  const nameLen = name.length;

  let pos = 0;
  while (pos <= len - nameLen) {
    const idx = text.indexOf(name, pos);
    if (idx === -1) return false;

    const before = idx === 0 || !isJsIdentChar(text.charCodeAt(idx - 1));
    const after = idx + nameLen >= len || !isJsIdentChar(text.charCodeAt(idx + nameLen));
    if (before && after) return true;
    pos = idx + 1;
  }
  return false;
}

/**
 * Generate a callback parameter name that doesn't conflict with the expression.
 *
 * @param expr - The expression to check for name conflicts
 * @param sourceFile - The source file for text extraction
 * @returns A parameter name that doesn't conflict with identifiers in expr
 */
function generateParamName(expr: ts.Expression, sourceFile: ts.SourceFile): string {
  const candidates = ["value", "v", "item", "data", "result"];
  for (let i = 0, len = candidates.length; i < len; i++) {
    const name = candidates[i];
    if (!name) continue;
    if (!isNameUsedInSource(expr, name, sourceFile)) return name;
  }
  return "_value";
}

/**
 * Replace all occurrences of target expression with replacement string.
 *
 * @param expr - The expression containing occurrences to replace
 * @param target - The target expression to find and replace
 * @param replacement - The replacement string
 * @param sourceFile - The source file for text extraction
 * @returns The expression text with all matches replaced
 */
function replaceMatches(
  expr: ts.Expression,
  target: ts.Node,
  replacement: string,
  sourceFile: ts.SourceFile,
): string {
  const positions = findMatchPositions(expr, target, sourceFile);
  const text = expr.getText(sourceFile);

  if (positions.length === 0) return text;

  // Sort ascending for forward iteration
  positions.sort((a, b) => a[0] - b[0]);

  const parts: string[] = [];
  let lastEnd = 0;

  for (let i = 0, len = positions.length; i < len; i++) {
    const pos = positions[i];
    if (!pos) continue;
    const [start, end] = pos;
    parts.push(text.slice(lastEnd, start));
    parts.push(replacement);
    lastEnd = end;
  }
  parts.push(text.slice(lastEnd));

  return parts.join("");
}

/**
 * Check if an expression contains expensive content that warrants Show.
 * Expensive types include JSX elements, fragments, and identifiers.
 *
 * @param node - The expression to check
 * @returns True if the expression is expensive
 */
function hasExpensiveContent(node: ts.Expression): boolean {
  return EXPENSIVE_TYPES.has(node.kind);
}

/**
 * Convert a JSX node to a string suitable for use inside JSX.
 *
 * Handles the case where JSX elements need to be unwrapped from containers.
 * JSX elements are returned as-is, other expressions are wrapped in curly braces.
 *
 * @param node - The node to convert
 * @param sourceFile - The source file for text extraction
 * @returns String representation suitable for JSX
 */
function nodeToJSXString(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);

  // If it's a JSX element/fragment, use as-is
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return text;
  }

  return `{${text}}`;
}

/**
 * Check if text spans multiple lines.
 * @param text - The text to check
 * @returns True if the text contains newlines
 */
function isMultiline(text: string): boolean {
  return text.indexOf("\n") !== -1;
}

/**
 * Detect the base indentation of a node from the source.
 * @param node - The AST node to detect indentation for
 * @param sourceFile - The source file for text extraction
 * @returns The detected indentation string
 */
function detectIndentation(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = sourceFile.text;
  const start = node.getStart(sourceFile);

  let lineStart = start;
  while (lineStart > 0 && text.charCodeAt(lineStart - 1) !== CHAR_NEWLINE) {
    lineStart--;
  }

  let end = lineStart;
  while (end < start) {
    const code = text.charCodeAt(end);
    if (code !== CHAR_SPACE && code !== CHAR_TAB) break;
    end++;
  }

  return text.slice(lineStart, end);
}

/**
 * Find the minimum indentation in a multiline string (excluding blank lines).
 * @param lines - Array of lines to analyze
 * @returns The minimum indentation level in spaces
 */
function findMinIndent(lines: readonly string[]): number {
  let min = Infinity;

  for (let i = 1, len = lines.length; i < len; i++) {
    const line = lines[i];
    if (!line) continue;
    if (!line.trim()) continue;

    let spaces = 0;
    for (let j = 0, lineLen = line.length; j < lineLen; j++) {
      const code = line.charCodeAt(j);
      if (code === CHAR_SPACE) spaces++;
      else if (code === CHAR_TAB) spaces += 2;
      else break;
    }
    if (spaces < min) min = spaces;
  }

  return min === Infinity ? 0 : min;
}

/**
 * Reindent multiline text to a new base indentation.
 * @param text - The text to reindent
 * @param newIndent - The new indentation string
 * @returns The reindented text
 */
function reindentText(text: string, newIndent: string): string {
  if (text.indexOf("\n") === -1) return text;

  const lines = text.split("\n");
  const minIndent = findMinIndent(lines);

  return lines.map((line, i) => {
    if (i === 0) return line;
    if (!line.trim()) return "";

    const stripped = line.slice(minIndent);
    return newIndent + stripped;
  }).join("\n");
}

/**
 * Get the node that should be replaced when fixing.
 *
 * If a container is provided (from the graph's JSXContext), use it.
 * Otherwise, fall back to the expression itself.
 *
 * @param node - The expression node
 * @param container - The JSX expression container, or null if nested
 * @returns The node to replace in the fix
 */
function getNodeToReplace(node: ts.Expression, container: ts.JsxExpression | null): ts.Node {

  if (container) {
    return container;
  }
  // Fallback for nested expressions (e.g., inside arrow function bodies)
  return node;
}

/**
 * Analyze a LogicalExpression (BinaryExpression with &&) to see if it should use <Show />.
 *
 * @param expr - The binary expression to analyze
 * @param sourceFile - The source file for text extraction
 * @param container - The JSX expression container (from graph's JSXContext)
 * @param graph - The solid graph
 * @returns A diagnostic or null if no issue
 */
function analyzeLogicalExpression(
  expr: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  container: ts.JsxExpression | null,
  graph: SolidGraph,
): Diagnostic | null {
  // Only handle && operator
  if (expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
    return null;
  }

  // Right side must be expensive (JSX or Identifier)
  if (!hasExpensiveContent(expr.right)) {
    return null;
  }

  const nodeToReplace = getNodeToReplace(expr, container);
  const indent = detectIndentation(nodeToReplace, sourceFile);
  const guard = extractTypeGuard(expr.left);

  // Type guard: use keyed callback form with ternary in when
  // e.g., typeof x === "number" && <Foo x={x} />
  // becomes: <Show when={typeof x === "number" ? x : null} keyed>{(v) => <Foo x={v} />}</Show>
  if (guard) {
    const conditionText = expr.left.getText(sourceFile);
    const narrowedText = guard.narrowedExpr.getText(sourceFile);
    const param = generateParamName(expr.right, sourceFile);
    const replacedConsequent = replaceMatches(expr.right, guard.narrowedExpr, param, sourceFile);

    const jsxContent = ts.isJsxElement(expr.right) || ts.isJsxSelfClosingElement(expr.right) || ts.isJsxFragment(expr.right)
      ? replacedConsequent
      : `{${replacedConsequent}}`;

    const replacement = buildShowReplacement(
      indent,
      `${conditionText} ? ${narrowedText} : null`,
      null,
      true,
      jsxContent,
      param,
    );
    const replacementOp: FixOperation = { range: [nodeToReplace.getStart(sourceFile), nodeToReplace.end], text: replacement };
    return createDiagnostic(
      graph.file,
      expr,
      graph.sourceFile,
      "prefer-show",
      "preferShowAnd",
      messages.preferShowAnd,
      "warn",
      buildFixWithImport(graph, replacementOp),
    );
  }

  const conditionText = expr.left.getText(sourceFile);
  const consequentText = nodeToJSXString(expr.right, sourceFile);
  const replacement = buildShowReplacement(
    indent,
    conditionText,
    null,
    false,
    consequentText,
    null,
  );
  const replacementOp: FixOperation = { range: [nodeToReplace.getStart(sourceFile), nodeToReplace.end], text: replacement };
  return createDiagnostic(
    graph.file,
    expr,
    graph.sourceFile,
    "prefer-show",
    "preferShowAnd",
    messages.preferShowAnd,
    "warn",
    buildFixWithImport(graph, replacementOp),
  );
}

/**
 * Build a formatted <Show> replacement string.
 *
 * Handles multiline content by properly indenting and formatting.
 * @param indent - The base indentation string
 * @param whenAttr - The value for the when attribute
 * @param fallbackAttr - The fallback content or null
 * @param keyed - Whether to add the keyed attribute
 * @param content - The main content to render
 * @param callbackParam - The callback parameter name or null
 * @returns The formatted Show component string
 */
function buildShowReplacement(
  indent: string,
  whenAttr: string,
  fallbackAttr: string | null,
  keyed: boolean,
  content: string,
  callbackParam: string | null,
): string {
  const contentIsMultiline = isMultiline(content);

  // Build opening tag attributes
  const baseAttrs = `when={${whenAttr}}${keyed ? " keyed" : ""}`;
  const attrs = fallbackAttr
    ? isMultiline(fallbackAttr)
      ? `${baseAttrs}\n${indent}  fallback={\n${indent}    ${reindentText(fallbackAttr, indent + "    ")}\n${indent}  }`
      : `${baseAttrs} fallback={${fallbackAttr}}`
    : baseAttrs;

  // Format content based on callback and multiline status
  const formattedContent = callbackParam
    ? contentIsMultiline
      ? `{(${callbackParam}) => (\n${indent}  ${reindentText(content, indent + "  ")}\n${indent})}`
      : `{(${callbackParam}) => ${content}}`
    : contentIsMultiline
      ? `\n${indent}  ${reindentText(content, indent + "  ")}\n${indent}`
      : content;

  return `<Show ${attrs}>${formattedContent}</Show>`;
}

/**
 * Analyze a ConditionalExpression (ternary) to see if it should use <Show />.
 *
 * @param expr - The conditional expression to analyze
 * @param sourceFile - The source file for text extraction
 * @param container - The JSX expression container (from graph's JSXContext)
 * @param graph - The solid graph
 * @returns A diagnostic or null if no issue
 */
function analyzeConditionalExpression(
  expr: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  container: ts.JsxExpression | null,
  graph: SolidGraph,
): Diagnostic | null {
  const consequentExpensive = hasExpensiveContent(expr.whenTrue);
  const alternateExpensive = hasExpensiveContent(expr.whenFalse);

  if (!consequentExpensive && !alternateExpensive) {
    return null;
  }

  const nodeToReplace = getNodeToReplace(expr, container);
  const indent = detectIndentation(nodeToReplace, sourceFile);
  const guard = extractTypeGuard(expr.condition);

  // Type guard: use keyed callback form with ternary in when
  // e.g., typeof x === "number" ? <Foo x={x} /> : <Bar />
  // becomes: <Show when={typeof x === "number" ? x : null} keyed fallback={<Bar />}>{(v) => <Foo x={v} />}</Show>
  if (guard) {
    const conditionText = expr.condition.getText(sourceFile);
    const narrowedText = guard.narrowedExpr.getText(sourceFile);
    const fallbackText = expr.whenFalse.getText(sourceFile);
    const param = generateParamName(expr.whenTrue, sourceFile);
    const replacedConsequent = replaceMatches(expr.whenTrue, guard.narrowedExpr, param, sourceFile);

    const jsxContent = ts.isJsxElement(expr.whenTrue) || ts.isJsxSelfClosingElement(expr.whenTrue) || ts.isJsxFragment(expr.whenTrue)
      ? replacedConsequent
      : `{${replacedConsequent}}`;

    const replacement = buildShowReplacement(
      indent,
      `${conditionText} ? ${narrowedText} : null`,
      fallbackText,
      true,
      jsxContent,
      param,
    );
    const replacementOp: FixOperation = { range: [nodeToReplace.getStart(sourceFile), nodeToReplace.end], text: replacement };
    return createDiagnostic(
      graph.file,
      expr,
      graph.sourceFile,
      "prefer-show",
      "preferShowTernary",
      messages.preferShowTernary,
      "warn",
      buildFixWithImport(graph, replacementOp),
    );
  }

  const conditionText = expr.condition.getText(sourceFile);
  const consequentText = nodeToJSXString(expr.whenTrue, sourceFile);
  const fallbackText = expr.whenFalse.getText(sourceFile);
  const replacement = buildShowReplacement(
    indent,
    conditionText,
    fallbackText,
    false,
    consequentText,
    null,
  );
  const replacementOp: FixOperation = { range: [nodeToReplace.getStart(sourceFile), nodeToReplace.end], text: replacement };
  return createDiagnostic(
    graph.file,
    expr,
    graph.sourceFile,
    "prefer-show",
    "preferShowTernary",
    messages.preferShowTernary,
    "warn",
    buildFixWithImport(graph, replacementOp),
  );
}

/**
 * Analyze an expression and return a diagnostic if it should use <Show />.
 *
 * @param expr - The expression to analyze
 * @param sourceFile - The source file for text extraction
 * @param container - The JSX expression container (from graph's JSXContext)
 * @param graph - The solid graph
 * @returns A diagnostic or null if no issue
 */
function analyzeExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  container: ts.JsxExpression | null,
  graph: SolidGraph,
): Diagnostic | null {
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return analyzeLogicalExpression(expr, sourceFile, container, graph);
  }

  if (ts.isConditionalExpression(expr)) {
    return analyzeConditionalExpression(expr, sourceFile, container, graph);
  }

  return null;
}

/**
 * Build a complete fix with the replacement operation and an import addition if needed.
 */
function buildFixWithImport(graph: SolidGraph, replacementOp: FixOperation): Fix {
  const importFix = buildSolidImportFix(graph, "Show");
  if (importFix) return [importFix, replacementOp];
  return [replacementOp];
}

const options = {};

const messages = {
  preferShowAnd:
    "Prefer Solid's `<Show when={...}>` component for conditional rendering. " +
    "While Solid's compiler handles `&&` expressions, <Show> is more explicit " +
    "and provides better readability for conditional content.",
  preferShowTernary:
    "Prefer Solid's `<Show when={...} fallback={...}>` component for conditional " +
    "rendering with a fallback. This provides clearer intent and better readability " +
    "than ternary expressions.",
} as const;

export const preferShow = defineSolidRule({
  id: "prefer-show",
  severity: "warn",
  messages,
  meta: {
    description:
      "Enforce using Solid's `<Show />` component for conditionally showing content. " +
      "Solid's compiler covers this case, so it's a stylistic rule only.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const elements = getJSXElements(graph);
    if (elements.length === 0) return;

    const sourceFile = graph.sourceFile;

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      if (!element) continue;
      const children = element.children;
      for (let j = 0, childLen = children.length; j < childLen; j++) {
        const child = children[j];
        if (!child) continue;

        if (child.kind !== "expression") continue;
        if (!ts.isJsxExpression(child.node)) continue;

        const container = child.node;
        const expr = container.expression;
        if (!expr) continue;

        if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          const issue = analyzeExpression(expr, sourceFile, container, graph);
          if (issue) {
            emit(issue);
          }
          continue;
        }

        if (ts.isConditionalExpression(expr)) {
          const issue = analyzeExpression(expr, sourceFile, container, graph);
          if (issue) {
            emit(issue);
          }
          continue;
        }

        // Handle arrow function bodies (common in control flow component children)
        // Example: <For each={list}>{(item) => item.visible && <Item />}</For>
        if (ts.isArrowFunction(expr)) {
          const body = expr.body;
          if (ts.isBinaryExpression(body) && body.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            // For arrow function bodies, pass null as container since the expression
            // is nested and the fix should target just the body expression
            const issue = analyzeExpression(body, sourceFile, null, graph);
            if (issue) {
              emit(issue);
            }
          } else if (ts.isConditionalExpression(body)) {
            const issue = analyzeExpression(body, sourceFile, null, graph);
            if (issue) {
              emit(issue);
            }
          }
        }
      }
    }
  },
});
