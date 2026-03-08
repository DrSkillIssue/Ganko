import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { hasFlag, DECL_IS_IMPORTANT } from "../../entities"
import { emitCSSDiagnostic } from "../util"

const messages = {
  layerOrderInversion:
    "Declaration for `{{property}}` in selector `{{selector}}` appears later but is overridden by an earlier declaration due to @layer precedence.",
} as const

export const noLayerOrderInversion = defineCSSRule({
  id: "no-layer-order-inversion",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow source-order assumptions that are inverted by layer precedence.",
    fixable: false,
    category: "css-cascade",
  },
  options: {},
  check(graph, emit) {
    const layerOrderFor = (name: string | null): number => {
      if (name === null) return -1
      return graph.layerOrder.get(name) ?? -1
    }

    const seen = new Set<number>()

    for (const [property, declarations] of graph.multiDeclarationProperties) {
      for (let i = 1; i < declarations.length; i++) {
        const later = declarations[i]
        if (!later) continue
        const laterRule = later.rule
        if (!laterRule) continue

        for (let j = 0; j < i; j++) {
          const earlier = declarations[j]
          if (!earlier) continue
          const earlierRule = earlier.rule
          if (!earlierRule) continue
          if (earlier.file.path !== later.file.path) continue
          if (earlierRule.selectorText !== laterRule.selectorText) continue
          if (hasFlag(earlier._flags, DECL_IS_IMPORTANT) !== hasFlag(later._flags, DECL_IS_IMPORTANT)) continue
          if (earlier.value === later.value) continue

          const earlierMedia = earlierRule.containingMedia?.params ?? null
          const laterMedia = laterRule.containingMedia?.params ?? null
          if (earlierMedia !== laterMedia) continue

          const earlierLayer = layerOrderFor(earlierRule.containingLayer?.parsedParams.layerName ?? null)
          const laterLayer = layerOrderFor(laterRule.containingLayer?.parsedParams.layerName ?? null)
          if (earlierLayer <= laterLayer) continue
          if (seen.has(later.id)) continue

          seen.add(later.id)
          emitCSSDiagnostic(
            emit,
            later.file.path,
            later.startLine,
            later.startColumn,
            noLayerOrderInversion,
            "layerOrderInversion",
            resolveMessage(messages.layerOrderInversion, {
              property,
              selector: laterRule.selectorText,
            }),
          )
        }
      }
    }
  },
})
