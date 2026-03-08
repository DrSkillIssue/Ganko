/**
 * Style Prop Rule
 *
 * Enforce correct usage of the `style` prop in JSX.
 *
 * This rule catches common style-related mistakes:
 * - Invalid CSS property names
 * - camelCase vs kebab-case inconsistencies
 * - Incorrect value types (strings vs numbers)
 *
 * Valid style patterns:
 * ```
 * <div style={{ color: 'red' }} />
 * <div style={{ 'background-color': 'blue' }} />
 * <div style="color: red;" />  // CSS string (sometimes OK)
 * ```
 *
 * Invalid patterns:
 * ```
 * <div style="background-color: blue" color="red" />  // CSS string + HTML props conflict
 * <div style={{ colorr: 'red' }} />  // Typo in CSS property
 * <div style={{ color: 100 }} />  // Need units for most properties
 * ```
 *
 * CSS properties should be:
 * - camelCase in objects: `backgroundColor`
 * - kebab-case in strings: `background-color`
 * - Properly spelled and valid
 * - Have appropriate units when needed (px, %, etc.)
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

import { knownCSSProperties, styleToObject as parseStyle, toKebabCase } from "@drskillissue/ganko-shared";
import type { Diagnostic, Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { getJSXAttributesByKind } from "../../queries";
import { getStaticValue, getPropertyKeyName } from "../../util";

/**
 * Set of CSS property name fragments that accept length/percentage values.
 * Properties containing these fragments need explicit units for numeric values.
 */
const LENGTH_PERCENTAGE_PROPERTIES = new Set([
  "width",
  "height",
  "margin",
  "padding",
  "border-width",
  "font-size",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
]);

/**
 * Discriminated union for style prop issues.
 * Each variant has exactly the fields it needs - no optional properties.
 */
type StyleIssue =
  | {
      type: "kebab";
      node: T.Node;
      name: string;
      kebabName: string;
      fix?: Fix;
    }
  | {
      type: "invalid";
      node: T.Node;
      name: string;
    }
  | {
      type: "numeric";
      node: T.Node;
      value: string;
    }
  | {
      type: "string";
      node: T.Node;
      prop: string;
      value: string;
      fix?: Fix;
    };

/** Check if name is a CSS custom property (starts with "--") */
function isCssCustomProperty(name: string): boolean {
  return name.charCodeAt(0) === 45 && name.charCodeAt(1) === 45;
}

/**
 * Check if a CSS property accepts length/percentage values.
 *
 * These properties require explicit units for numeric values.
 * Uses direct Set lookup for known properties, with fallback pattern matching.
 *
 * @param name - The CSS property name to check
 * @returns True if the property accepts length/percentage values
 */
function isLengthPercentageProperty(name: string): boolean {
  if (name.length < 5) return false;

  // Quick path: direct match
  if (LENGTH_PERCENTAGE_PROPERTIES.has(name)) return true;

  // Fallback: check if name contains any length-related fragment

  return (
    name.indexOf("width") !== -1 ||
    name.indexOf("height") !== -1 ||
    name.indexOf("margin") !== -1 ||
    name.indexOf("padding") !== -1 ||
    name.indexOf("font-size") !== -1
  );
}



/** Get property name, handling computed properties with literal keys */
function getPropertyName(prop: T.Property): string | null {
  if (prop.computed && prop.key.type === "Literal") {
    return String(prop.key.value);
  }
  return prop.computed ? null : getPropertyKeyName(prop.key);
}

/**
 * Detect issues with a CSS property name in a style object.
 * Checks if the property name is valid CSS. If invalid, checks if it's a
 * camelCase version of a valid kebab-case property.
 */
function detectPropertyNameIssue(prop: T.Property): StyleIssue | null {
  const name = getPropertyName(prop);
  if (!name) return null;

  if (isCssCustomProperty(name)) return null;
  if (knownCSSProperties.has(name)) return null;

  const kebabName = toKebabCase(name);
  if (knownCSSProperties.has(kebabName)) {
    return {
      type: "kebab",
      node: prop.key,
      name,
      kebabName,
      fix: [{ range: [prop.key.range[0], prop.key.range[1]], text: `"${kebabName}"` }],
    };
  }

  return {
    type: "invalid",
    node: prop.key,
    name,
  };
}

/**
 * Detect issues with numeric values on length/percentage properties.
 *
 * Solid does not automatically append 'px' like React does, so numeric values
 * on properties that need units will be invalid CSS.
 *
 * @param prop - The property node to check
 * @returns Style issue if found, null if valid
 */
function detectNumericValueIssue(prop: T.Property): StyleIssue | null {
  const name = getPropertyName(prop);

  // CSS custom properties can have any value, skip check
  if (name && isCssCustomProperty(name)) return null;

  // If we can determine the property name and it doesn't accept lengths, skip
  if (name && !isLengthPercentageProperty(name)) return null;

  const staticValue = getStaticValue(prop.value);

  // Only flag non-zero numbers (0 doesn't need a unit)
  if (typeof staticValue?.value === "number" && staticValue.value !== 0) {
    return {
      type: "numeric",
      node: prop.value,
      value: String(staticValue.value),
    };
  }

  return null;
}

/**
 * Detect issues with string style values.
 *
 * Style should be an object, not a string, for better type checking and
 * maintainability.
 *
 * @param style - The style value node (string literal or template)
 * @param attrValue - The JSX attribute value for fixing
 * @returns Style issue if found, null if not a string style
 */
function detectStringStyleIssue(
  style: T.Literal | T.TemplateLiteral,
  attrValue: T.JSXAttribute["value"],
): StyleIssue | null {
  if (style.type === "Literal" && typeof style.value === "string") {
    const objectStyles = parseStyle(style.value);
    const keys = objectStyles ? Object.keys(objectStyles) : [];
    const prop = keys[0] ?? "property";
    const value = objectStyles?.[prop] ?? "value";

    const fix: Fix | undefined =
      objectStyles && attrValue
        ? [{ range: [attrValue.range[0], attrValue.range[1]], text: `{${JSON.stringify(objectStyles)}}` }]
        : undefined;

    const issue: StyleIssue = {
      type: "string",
      node: style,
      prop,
      value,
    };
    if (fix !== undefined) issue.fix = fix;
    return issue;
  }

  if (style.type === "TemplateLiteral") {
    return {
      type: "string",
      node: style,
      prop: "property",
      value: "value",
    };
  }

  return null;
}

/**
 * Convert a StyleIssue to a Diagnostic.
 *
 * Maps the discriminated union of style issues to their corresponding
 * diagnostic messages and fixes.
 *
 * @param issue - The style issue to convert
 * @returns Diagnostic with appropriate message and optional fix
 */
function issueToDiagnostic(issue: StyleIssue, file: string): Diagnostic {
  switch (issue.type) {
    case "kebab":
      return createDiagnostic(
        file,
        issue.node,
        "style-prop",
        "kebabStyleProp",
        resolveMessage(messages.kebabStyleProp, { name: issue.name, kebabName: issue.kebabName }),
        "warn",
        issue.fix,
      );

    case "invalid":
      return createDiagnostic(
        file,
        issue.node,
        "style-prop",
        "invalidStyleProp",
        resolveMessage(messages.invalidStyleProp, { name: issue.name }),
        "warn",
      );

    case "numeric":
      return createDiagnostic(
        file,
        issue.node,
        "style-prop",
        "numericStyleValue",
        resolveMessage(messages.numericStyleValue, { value: issue.value }),
        "warn",
      );

    case "string":
      return createDiagnostic(
        file,
        issue.node,
        "style-prop",
        "stringStyle",
        resolveMessage(messages.stringStyle, { prop: issue.prop, value: issue.value }),
        "warn",
        issue.fix,
      );
  }
}

const messages = {
  kebabStyleProp:
    "Solid uses kebab-case for CSS property names, not camelCase like React. " +
    "Use '{{kebabName}}' instead of '{{name}}'.",
  invalidStyleProp:
    "'{{name}}' is not a valid CSS property. Check for typos, or if this is a custom " +
    "property, prefix it with '--' (e.g., '--{{name}}').",
  numericStyleValue:
    "Numeric values for dimensional properties need explicit units in Solid. " +
    "Unlike React, Solid does not auto-append 'px'. Use '{{value}}px' or another appropriate unit.",
  stringStyle:
    "Use an object for the style prop instead of a string for better approach and type safety. " +
    "Example: style={{ '{{prop}}': '{{value}}' }}.",
} as const;

const options = {};

export const styleProp = defineSolidRule({
  id: "style-prop",
  severity: "warn",
  messages,
  meta: {
    description:
      "Require CSS properties in the `style` prop to be valid and kebab-cased (ex. 'font-size'), " +
      "not camel-cased (ex. 'fontSize') like in React, and that property values with dimensions " +
      "are strings, not numbers with implicit 'px' units.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const styleAttrs = getJSXAttributesByKind(graph, "style");
    if (styleAttrs.length === 0) return;

    for (let i = 0, len = styleAttrs.length; i < len; i++) {
      const entry = styleAttrs[i];
      if (!entry) continue;
      const { attr } = entry;
      const value = attr.valueNode;
      if (!value) continue;
      if (attr.node.type !== "JSXAttribute") continue;

      if (value.type === "Literal" || value.type === "TemplateLiteral") {
        const issue = detectStringStyleIssue(value, attr.node.value);
        if (issue) {
          emit(issueToDiagnostic(issue, graph.file));
        }
        continue;
      }

      if (value.type === "ObjectExpression") {
        const properties = value.properties;
        for (let j = 0, propLen = properties.length; j < propLen; j++) {
          const prop = properties[j];
          if (!prop) continue;
          if (prop.type !== "Property") continue;

          const nameIssue = detectPropertyNameIssue(prop);
          if (nameIssue) {
            emit(issueToDiagnostic(nameIssue, graph.file));
            continue;
          }

          const valueIssue = detectNumericValueIssue(prop);
          if (valueIssue) {
            emit(issueToDiagnostic(valueIssue, graph.file));
          }
        }
      }
    }
  },
});
