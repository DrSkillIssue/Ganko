import type { CSSSourceProvider, CSSSymbolContribution } from "./provider"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import { cssGraphToSyntaxTrees } from "../core/css-syntax-tree"
import { buildCSSGraph } from "../../css/plugin"
import { createPlainCSSProvider } from "./plain-css"

export interface SCSSProvider extends CSSSourceProvider {
  readonly kind: "scss"
}

export function createSCSSProvider(): SCSSProvider {
  const plainProvider = createPlainCSSProvider()

  return {
    kind: "scss",

    parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree {
      const input = {
        files: [{ path: filePath, content }],
        options: { scss: true },
      }
      const graph = buildCSSGraph(input)
      const trees = cssGraphToSyntaxTrees(graph)
      const tree = trees[0]!
      return {
        ...tree,
        sourceOrderBase,
      }
    },

    extractSymbols(tree: CSSSyntaxTree): CSSSymbolContribution {
      return plainProvider.extractSymbols(tree)
    },
  }
}
