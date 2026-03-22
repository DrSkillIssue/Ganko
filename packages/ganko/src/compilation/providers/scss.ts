import type { CSSSourceProvider, CSSSymbolContribution } from "./provider"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import { buildCSSResult } from "../../css/impl"
import { createCSSInput } from "../../css/input"
import { createPlainCSSProvider } from "./plain-css"

export interface SCSSProvider extends CSSSourceProvider {
  readonly kind: "scss"
}

export function createSCSSProvider(): SCSSProvider {
  const plainProvider = createPlainCSSProvider()

  return {
    kind: "scss",

    parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree {
      const input = createCSSInput([{ path: filePath, content }])
      input.options = { scss: true }
      const result = buildCSSResult(input)
      const trees = result.trees
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
