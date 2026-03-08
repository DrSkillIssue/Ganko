import { resolveMessage } from "../../../diagnostic"
import type { Emit } from "../../../graph"
import { defineCSSRule } from "../../rule"
import type { SelectorEntity } from "../../entities"
import { emitCSSDiagnostic } from "../util"

const maxAttributeSelectors = 0
const maxUniversalSelectors = 0

const messages = {
  tooManyAttributes:
    "Selector `{{selector}}` uses {{count}} attribute selector(s). Maximum allowed is {{max}}.",
  tooManyUniversals:
    "Selector `{{selector}}` uses {{count}} universal selector(s). Maximum allowed is {{max}}.",
} as const

function countSelectorParts(selector: string, marker: string): number {
  let count = 0
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === marker) count++
  }
  return count
}

function emitForSelectors(
  selectors: readonly SelectorEntity[],
  marker: string,
  max: number,
  messageKey: "tooManyAttributes" | "tooManyUniversals",
  emit: Emit,
): void {
  for (let i = 0, len = selectors.length; i < len; i++) {
    const selector = selectors[i]
    if (!selector) continue
    const count = countSelectorParts(selector.raw, marker)
    if (count <= max) continue
    emitCSSDiagnostic(
      emit,
      selector.rule.file.path,
      selector.rule.startLine,
      selector.rule.startColumn,
      selectorMaxAttributeAndUniversal,
      messageKey,
      resolveMessage(messages[messageKey], {
        selector: selector.raw,
        count: String(count),
        max: String(max),
      }),
    )
  }
}

export const selectorMaxAttributeAndUniversal = defineCSSRule({
  id: "selector-max-attribute-and-universal",
  severity: "off",
  messages,
  meta: {
    description: "Disallow selectors with attribute or universal selectors beyond configured limits.",
    fixable: false,
    category: "css-selector",
  },
  options: {
    maxAttributeSelectors,
    maxUniversalSelectors,
  },
  check(graph, emit) {
    emitForSelectors(graph.attributeSelectors, "[", maxAttributeSelectors, "tooManyAttributes", emit)
    emitForSelectors(graph.universalSelectors, "*", maxUniversalSelectors, "tooManyUniversals", emit)
  },
})
