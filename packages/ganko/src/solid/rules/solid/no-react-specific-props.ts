/**
 * No React Specific Props Rule
 *
 * Disallow usage of React-specific props that were deprecated in Solid v1.4.0.
 *
 * This rule detects:
 * - `className` -> should be `class`
 * - `htmlFor` -> should be `for`
 * - `key` prop on DOM elements (React holdover, not needed in Solid)
 */

import ts from "typescript";
import type { SolidGraph, JSXElementEntity, JSXAttributeEntity } from "../../impl"
import type { Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getJSXAttributeValue } from "../../queries"

const messages = {
  prefer: "Prefer the `{{to}}` prop over the deprecated `{{from}}` prop.",
  noUselessKey: "Elements in a <For> or <Index> list do not need a key prop.",
} as const

/**
 * React-specific props that should be replaced with their standard HTML equivalents.
 * These were deprecated in Solid v1.4.0.
 */
const REACT_SPECIFIC_PROPS: readonly { from: string; to: string }[] = [
  { from: "className", to: "class" },
  { from: "htmlFor", to: "for" },
]

const REACT_PROPS_MAP = new Map<string, string>(
  REACT_SPECIFIC_PROPS.map(({ from, to }) => [from, to]),
)

/**
 * Generate a fix to replace a React-specific prop with its standard equivalent.
 * Only generates a fix if the target prop doesn't already exist.
 */
function generatePropReplaceFix(
  attr: JSXAttributeEntity,
  element: JSXElementEntity,
  to: string,
  graph: SolidGraph,
): Fix | undefined {
  // Don't auto-fix if the target prop already exists
  if (getJSXAttributeValue(graph, element, to) !== null) return undefined

  const node = attr.node
  // Spread attributes don't have a name property
  if (!ts.isJsxAttribute(node)) return undefined

  return [{ range: [node.name.getStart(graph.sourceFile), node.name.end], text: to }]
}

/**
 * Create a fix to remove a JSX attribute including surrounding whitespace.
 */
function createRemoveAttrFix(
  graph: SolidGraph,
  attr: JSXAttributeEntity,
): Fix {
  const node = attr.node
  const sourceText = graph.sourceFile.text;
  // Find the token before by scanning backwards from node start
  const nodeStart = node.getStart(graph.sourceFile);
  let tokenEnd = nodeStart - 1;
  // Skip whitespace backwards
  while (tokenEnd >= 0 && (sourceText[tokenEnd] === ' ' || sourceText[tokenEnd] === '\t' || sourceText[tokenEnd] === '\n' || sourceText[tokenEnd] === '\r')) {
    tokenEnd--;
  }

  if (tokenEnd >= 0) {
    return [{ range: [tokenEnd + 1, node.end], text: "" }]
  }

  return [{ range: [nodeStart, node.end], text: "" }]
}

const options = {}

export const noReactSpecificProps = defineSolidRule({
  id: "no-react-specific-props",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow usage of React-specific `className`/`htmlFor` props, which were deprecated in v1.4.0.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    const elements = graph.jsxElements
    if (elements.length === 0) return

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i]
      if (!element) continue;
      const attrs = element.attributes

      for (let j = 0, attrLen = attrs.length; j < attrLen; j++) {
        const attr = attrs[j]
        if (!attr) continue;
        const attrName = attr.name

        // Skip spread attributes (they have null name)
        if (attrName === null) continue

        // Check for React-specific props (className, htmlFor)
        const replacement = REACT_PROPS_MAP.get(attrName)
        if (replacement) {
          emit(
            createDiagnostic(
              graph.file,
              attr.node,
              graph.sourceFile,
              "no-react-specific-props",
              "prefer",
              resolveMessage(messages.prefer, { from: attrName, to: replacement }),
              "error",
              generatePropReplaceFix(attr, element, replacement, graph),
            ),
          )
          continue
        }

        // Check for key prop on DOM elements (React holdover)
        if (attrName !== "key") continue
        if (!element.isDomElement) continue

        emit(
          createDiagnostic(
            graph.file,
            attr.node,
            graph.sourceFile,
            "no-react-specific-props",
            "noUselessKey",
            messages.noUselessKey,
            "error",
            createRemoveAttrFix(graph, attr),
          ),
        )
      }
    }
  },
})
