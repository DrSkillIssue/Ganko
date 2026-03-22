import type { CSSSourceProvider, CSSSymbolContribution } from "./provider"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { CSSClassNameSource } from "../symbols/class-name"
import { buildCSSResult } from "../../css/impl"
import { createSelectorSymbol } from "../symbols/selector"
import { createDeclarationSymbol } from "../symbols/declaration"
import { createCustomPropertySymbol } from "../symbols/custom-property"
import { createKeyframesSymbol } from "../symbols/keyframes"
import { createFontFaceSymbol } from "../symbols/font-face"
import { createLayerSymbol } from "../symbols/layer"
import { createContainerSymbol } from "../symbols/container"
import { createThemeTokenSymbol } from "../symbols/theme-token"
import type { SelectorSymbol } from "../symbols/selector"
import type { DeclarationSymbol } from "../symbols/declaration"
import type { CustomPropertySymbol } from "../symbols/custom-property"
import type { KeyframesSymbol } from "../symbols/keyframes"
import type { FontFaceSymbol } from "../symbols/font-face"
import type { LayerSymbol } from "../symbols/layer"
import type { ContainerSymbol } from "../symbols/container"
import type { ThemeTokenSymbol } from "../symbols/theme-token"
import type { SelectorEntity } from "../../css/entities/selector"
import type { DeclarationEntity } from "../../css/entities/declaration"
import { parseContainerQueryName } from "../../css/parser/value-util"
import { LAYOUT_ANIMATION_MUTATION_PROPERTIES } from "../../css/layout-taxonomy"
import type { KeyframeLayoutMutation } from "../symbols/keyframes"

const STRIP_QUOTES_RE = /["']/g

export interface PlainCSSProvider extends CSSSourceProvider {
  readonly kind: "plain-css"
}

function extractSymbolsFromTree(tree: CSSSyntaxTree): CSSSymbolContribution {
  const filePath = tree.filePath
  const classNamesBuilding = new Map<string, { selectors: SelectorEntity[]; filePaths: string[] }>()
  const selectors: SelectorSymbol[] = []
  const declarations: DeclarationSymbol[] = []
  const customProperties: CustomPropertySymbol[] = []
  const keyframes: KeyframesSymbol[] = []
  const fontFaces: FontFaceSymbol[] = []
  const layers: LayerSymbol[] = []
  const containers: ContainerSymbol[] = []
  const themeTokens: ThemeTokenSymbol[] = []

  const treeSelectors = tree.selectors
  for (let i = 0; i < treeSelectors.length; i++) {
    const entity = treeSelectors[i]
    selectors.push(createSelectorSymbol(entity, filePath))

    const compounds = entity.compounds
    for (let ci = 0; ci < compounds.length; ci++) {
      const compound = compounds[ci]
      const classes = compound.classes
      for (let j = 0; j < classes.length; j++) {
        const cls = classes[j]
        const existing = classNamesBuilding.get(cls)
        if (existing) {
          existing.selectors.push(entity)
          if (existing.filePaths.indexOf(filePath) === -1) existing.filePaths.push(filePath)
        } else {
          classNamesBuilding.set(cls, {
            selectors: [entity],
            filePaths: [filePath],
          })
        }
      }
    }
  }

  const treeDeclarations = tree.declarations
  for (let i = 0; i < treeDeclarations.length; i++) {
    const entity = treeDeclarations[i]
    const sourceOrder = tree.sourceOrderBase + entity.sourceOrder
    const layerOrder = entity.cascadePosition.layerOrder
    declarations.push(createDeclarationSymbol(entity, filePath, sourceOrder, layerOrder))
  }

  const treeVariables = tree.variables
  const seenVars = new Set<string>()
  for (let i = 0; i < treeVariables.length; i++) {
    const entity = treeVariables[i]
    if (!seenVars.has(entity.name)) {
      seenVars.add(entity.name)
      customProperties.push(createCustomPropertySymbol(entity, filePath))
    }
  }

  const treeAtRules = tree.atRules
  let layerOrderCounter = 0
  for (let i = 0; i < treeAtRules.length; i++) {
    const entity = treeAtRules[i]
    switch (entity.kind) {
      case "keyframes": {
        const name = entity.parsedParams.animationName
        if (!name) break

        const byProperty = new Map<string, { values: Set<string>; declarations: DeclarationEntity[] }>()
        const kfRules = entity.rules
        for (let r = 0; r < kfRules.length; r++) {
          const kfRule = kfRules[r]
          const kfDecls = kfRule.declarations
          for (let d = 0; d < kfDecls.length; d++) {
            const decl = kfDecls[d]
            const property = decl.property.toLowerCase()
            if (!LAYOUT_ANIMATION_MUTATION_PROPERTIES.has(property)) continue

            let bucket = byProperty.get(property)
            if (!bucket) {
              bucket = { values: new Set<string>(), declarations: [] }
              byProperty.set(property, bucket)
            }
            bucket.values.add(decl.value.trim().toLowerCase())
            bucket.declarations.push(decl)
          }
        }

        const layoutMutations: KeyframeLayoutMutation[] = []
        for (const [property, bucket] of byProperty) {
          if (bucket.values.size <= 1) continue
          layoutMutations.push({
            property,
            values: [...bucket.values],
            declarations: bucket.declarations,
          })
        }

        keyframes.push(createKeyframesSymbol(entity, name, filePath, layoutMutations))
        break
      }
      case "font-face": {
        const childDecls = entity.declarations
        let family = ""
        let display: string | null = null
        let hasWebFontSource = false
        let hasMetricOverrides = false
        if (childDecls) {
          for (let d = 0; d < childDecls.length; d++) {
            const decl = childDecls[d]
            const prop = decl.property.toLowerCase()
            if (prop === "font-family") family = decl.value.replace(STRIP_QUOTES_RE, "").trim()
            else if (prop === "font-display") display = decl.value.trim().toLowerCase()
            else if (prop === "src" && decl.value.toLowerCase().includes("url(")) hasWebFontSource = true
            else if (prop === "size-adjust" || prop === "ascent-override" || prop === "descent-override" || prop === "line-gap-override") {
              const v = decl.value.trim().toLowerCase()
              if (v !== "normal" && v !== "none" && v.length > 0) hasMetricOverrides = true
            }
          }
        }
        if (family.length > 0) {
          fontFaces.push(createFontFaceSymbol(entity, family, filePath, display, hasWebFontSource, hasMetricOverrides))
        }
        break
      }
      case "layer": {
        const name = entity.params.trim()
        if (name.length > 0) {
          layers.push(createLayerSymbol(entity, name, filePath, layerOrderCounter++))
        }
        break
      }
      case "container": {
        const queryName = parseContainerQueryName(entity.params)
        if (queryName !== null && queryName.length > 0) {
          containers.push(createContainerSymbol(queryName, [], [entity]))
        }
        break
      }
    }
  }

  const treeTokens = tree.tokens
  for (let i = 0; i < treeTokens.length; i++) {
    const entity = treeTokens[i]
    themeTokens.push(createThemeTokenSymbol(entity, filePath))
  }

  const classNamesMap = new Map<string, CSSClassNameSource>()
  for (const [name, entry] of classNamesBuilding) {
    classNamesMap.set(name, { kind: "css", selectors: entry.selectors, filePaths: entry.filePaths })
  }

  return {
    classNames: classNamesMap,
    selectors,
    declarations,
    customProperties,
    keyframes,
    fontFaces,
    layers,
    containers,
    themeTokens,
  }
}

export function createPlainCSSProvider(): PlainCSSProvider {
  return {
    kind: "plain-css",

    parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree {
      const input = { files: [{ path: filePath, content }] }
      const result = buildCSSResult(input)
      const trees = result.trees
      const tree = trees[0]!
      return {
        ...tree,
        sourceOrderBase,
      }
    },

    extractSymbols: extractSymbolsFromTree,
  }
}
