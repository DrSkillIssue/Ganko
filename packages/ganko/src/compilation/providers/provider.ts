import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { CSSClassNameSource } from "../symbols/class-name"
import type { SelectorSymbol } from "../symbols/selector"
import type { DeclarationSymbol } from "../symbols/declaration"
import type { CustomPropertySymbol } from "../symbols/custom-property"
import type { KeyframesSymbol } from "../symbols/keyframes"
import type { FontFaceSymbol } from "../symbols/font-face"
import type { LayerSymbol } from "../symbols/layer"
import type { ContainerSymbol } from "../symbols/container"
import type { ThemeTokenSymbol } from "../symbols/theme-token"

export type CSSSourceProviderKind = "plain-css" | "scss" | "tailwind"

export interface CSSSymbolContribution {
  readonly classNames: ReadonlyMap<string, CSSClassNameSource>
  readonly selectors: readonly SelectorSymbol[]
  readonly declarations: readonly DeclarationSymbol[]
  readonly customProperties: readonly CustomPropertySymbol[]
  readonly keyframes: readonly KeyframesSymbol[]
  readonly fontFaces: readonly FontFaceSymbol[]
  readonly layers: readonly LayerSymbol[]
  readonly containers: readonly ContainerSymbol[]
  readonly themeTokens: readonly ThemeTokenSymbol[]
}

export interface CSSSourceProvider {
  readonly kind: CSSSourceProviderKind
  parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree
  extractSymbols(tree: CSSSyntaxTree): CSSSymbolContribution
}
