/**
 * JSX No Script URL Rule
 *
 * Disallow javascript: URLs in JSX attributes.
 *
 * javascript: URLs are a security risk because they can enable cross-site
 * scripting (XSS) attacks. This rule detects:
 *
 * - Direct string literals: <a href="javascript:alert(1)" />
 * - Variable references: const url = "javascript:..."; <a href={url} />
 * - String concatenation: const url = "java" + "script:..."; <a href={url} />
 *
 * The rule handles obfuscation techniques including:
 * - Leading control characters and spaces
 * - Embedded tabs and newlines in the protocol
 * - Case variations (JavaScript, JAVASCRIPT, etc.)
 *
 * @see https://url.spec.whatwg.org/#url-parsing
 * @see https://infra.spec.whatwg.org/#ascii-tab-or-newline
 */

import ts from "typescript";
import type { Diagnostic, Fix } from "../../../diagnostic"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { JSXAttributeEntity, JSXElementEntity } from "../../entities/jsx";
import type { ScopeEntity } from "../../entities/scope";
import type { VariableEntity } from "../../entities/variable";
import { createDiagnostic } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import { getStaticStringValue } from "../../util/static-value";
import { getVariableByNameInScope } from "../../queries/scope";
import { getJSXAttributesByKind } from "../../queries/jsx";

const messages = {
  noJSURL: "Using javascript: URLs is a security risk because it can enable cross-site scripting (XSS) attacks. Use an event handler like onClick instead, or navigate programmatically with useNavigate().",
} as const;

/**
 * Regex to detect javascript: protocol URLs.
 *
 * This regex accounts for various obfuscation techniques:
 *
 * 1. Leading control characters: A javascript: URL can contain leading C0 control
 *    characters or \u0020 SPACE before the protocol.
 *    See: https://url.spec.whatwg.org/#url-parsing
 *
 * 2. Embedded whitespace: Tabs and newlines within the protocol name are filtered
 *    out during URL parsing, so "j\na\tv\nascript:" is equivalent to "javascript:".
 *    Tab or newline are defined as \r\n\t.
 *    See: https://infra.spec.whatwg.org/#ascii-tab-or-newline
 *
 * 3. C0 control range: Code points from \u0000 NULL to \u001F INFORMATION
 *    SEPARATOR ONE, inclusive.
 *    See: https://infra.spec.whatwg.org/#c0-control-or-space
 *
 * @example
 * // All of these match:
 * "javascript:alert(1)"
 * "JAVASCRIPT:alert(1)"
 * "  javascript:alert(1)"
 * "j\na\tv\nascript:alert(1)"
 */
// Intentionally matching control characters for security - these can be used to obfuscate javascript: URLs
/* eslint-disable no-control-regex */
const JAVASCRIPT_PROTOCOL_REGEX =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
/* eslint-enable no-control-regex */

/**
 * Check if a value is a javascript: URL string.
 *
 * @param value - The value to check
 * @returns true if the value is a javascript: URL, false otherwise
 */
function isJavaScriptUrl(value: string | null): boolean {
  return value !== null && JAVASCRIPT_PROTOCOL_REGEX.test(value);
}

/**
 * Resolve a variable to its static string value using scope-aware lookup.
 *
 * @param identifier - The identifier to resolve
 * @param graph - The program graph
 * @param scope - The scope to search from
 * @param visited - Set of visited variable names for cycle detection
 * @returns The static string value, or null if not resolvable
 */
function resolveVariableToStringUses(
  identifier: ts.Identifier,
  graph: SolidGraph,
  scope: ScopeEntity,
  visited: Set<string> = new Set(),
): string | null {
  const name = identifier.text;

  if (visited.has(name)) {
    return null;
  }

  visited.add(name);

  const variable: VariableEntity | null = getVariableByNameInScope(graph, name, scope);
  if (!variable) {
    return null;
  }

  const value = variable.initializer;
  if (!value) return null;

  const staticValue = getStaticStringValue(value);
  if (staticValue !== null) {
    return staticValue;
  }

  if (ts.isIdentifier(value)) {
    return resolveVariableToStringUses(value, graph, scope, visited);
  }

  return null;
}

/**
 * Build a fix to remove or replace javascript: URL.
 *
 * @param attr - The JSX attribute entity
 * @param sourceFile - The source file for position calculations
 * @returns Fix object or undefined if not fixable
 */
function buildScriptUrlFix(attr: JSXAttributeEntity, sourceFile: ts.SourceFile): Fix | undefined {
  if (!ts.isJsxAttribute(attr.node) || !attr.node.initializer) return undefined;

  const valueNode = attr.node.initializer;

  if (ts.isStringLiteral(valueNode)) {
    return [{ range: [valueNode.getStart(sourceFile), valueNode.end], text: '"#"' }];
  }

  if (ts.isJsxExpression(valueNode)) {
    const expr = valueNode.expression;
    if (expr && ts.isStringLiteral(expr)) {
      return [{ range: [expr.getStart(sourceFile), expr.end], text: '"#"' }];
    }
  }

  return undefined;
}

/**
 * Check a JSX attribute for javascript: URL.
 *
 * @param attr - The JSX attribute entity
 * @param element - The parent JSX element entity (for scope access)
 * @param graph - The program graph
 * @returns Diagnostic if javascript: URL detected, null otherwise
 */
function checkAttributeForScriptUrl(
  attr: JSXAttributeEntity,
  element: JSXElementEntity,
  graph: SolidGraph,
  file: string,
): Diagnostic | null {
  const valueExpr = attr.valueNode;
  if (!valueExpr) return null;

  const attrName = attr.name;
  if (!attrName) return null;

  let staticValue = getStaticStringValue(valueExpr);

  if (staticValue === null && ts.isIdentifier(valueExpr)) {
    staticValue = resolveVariableToStringUses(valueExpr, graph, element.scope);
  }

  if (staticValue !== null && isJavaScriptUrl(staticValue)) {
    const reportNode = ts.isJsxAttribute(attr.node) && attr.node.initializer
      ? attr.node.initializer
      : attr.node;

    return createDiagnostic(file, reportNode, graph.sourceFile, "jsx-no-script-url", "noJSURL", messages.noJSURL, "error", buildScriptUrlFix(attr, graph.sourceFile));
  }

  return null;
}

const options = {}

export const jsxNoScriptUrl = defineSolidRule({
  id: "jsx-no-script-url",
  severity: "error",
  messages,
  meta: {
    description: "Disallow javascript: URLs.",
    fixable: true,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const propAttributes = getJSXAttributesByKind(graph, "prop");
    if (propAttributes.length === 0) return;

    for (let i = 0, len = propAttributes.length; i < len; i++) {
      const entry = propAttributes[i];
      if (!entry) continue;
      const { attr, element } = entry;

      const result = checkAttributeForScriptUrl(attr, element, graph, graph.filePath);
      if (result) {
        emit(result);
      }
    }
  },
});
