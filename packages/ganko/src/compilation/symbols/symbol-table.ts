import type { TailwindValidator } from "../../css/tailwind"
import type { SelectorEntity } from "../../css/entities/selector"
import type { DeclarationEntity } from "../../css/entities/declaration"
import type { RuleEntity } from "../../css/entities/rule"
import type { AtRuleEntity } from "../../css/entities/at-rule"
import type { VariableEntity } from "../../css/entities/variable"
import type { ThemeTokenEntity } from "../../css/entities/token"
import type { MixinEntity, SCSSFunctionEntity, PlaceholderEntity } from "../../css/entities/scss"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { ClassNameSymbol } from "./class-name"
import type { SelectorSymbol } from "./selector"
import type { DeclarationSymbol } from "./declaration"
import type { CustomPropertySymbol } from "./custom-property"
import type { KeyframesSymbol, KeyframeLayoutMutation } from "./keyframes"
import type { FontFaceSymbol } from "./font-face"
import type { LayerSymbol } from "./layer"
import type { ContainerSymbol } from "./container"
import type { ThemeTokenSymbol } from "./theme-token"
import type { ComponentHostSymbol } from "./component-host"
import { createClassNameSymbol } from "./class-name"
import { createSelectorSymbol } from "./selector"
import { createDeclarationSymbol } from "./declaration"
import { createCustomPropertySymbol } from "./custom-property"
import { createKeyframesSymbol } from "./keyframes"
import { createFontFaceSymbol } from "./font-face"
import { createLayerSymbol } from "./layer"
import { createContainerSymbol } from "./container"
import { createThemeTokenSymbol } from "./theme-token"
import {
  hasFlag,
  SEL_HAS_ID,
  SEL_HAS_ATTRIBUTE,
  SEL_HAS_UNIVERSAL,
  DECL_IS_IMPORTANT,
  VAR_IS_USED,
  MIXIN_IS_USED,
  SCSSFN_IS_USED,
  PLACEHOLDER_IS_USED,
} from "../../css/entities"
import {
  LAYOUT_ANIMATION_MUTATION_PROPERTIES,
  LAYOUT_CLASS_GEOMETRY_PROPERTIES,
} from "../../css/layout-taxonomy"
import {
  normalizeAnimationName,
  parseContainerNames,
  parseContainerNamesFromShorthand,
  parseContainerQueryName,
  CSS_WIDE_KEYWORDS,
  splitComma,
} from "../../css/parser/value-util"
import { extractKeyframeNames } from "@drskillissue/ganko-shared"

export interface SymbolTable {
  readonly classNames: ReadonlyMap<string, ClassNameSymbol>
  readonly selectors: ReadonlyMap<number, SelectorSymbol>
  readonly customProperties: ReadonlyMap<string, CustomPropertySymbol>
  readonly componentHosts: ReadonlyMap<string, ComponentHostSymbol>
  readonly keyframes: ReadonlyMap<string, KeyframesSymbol>
  readonly fontFaces: ReadonlyMap<string, readonly FontFaceSymbol[]>
  readonly layers: ReadonlyMap<string, LayerSymbol>
  readonly containers: ReadonlyMap<string, ContainerSymbol>
  readonly themeTokens: ReadonlyMap<string, ThemeTokenSymbol>
  readonly referencedCustomPropertyNames: ReadonlySet<string>

  readonly selectorsByDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorSymbol[]>
  readonly selectorsWithoutSubjectTag: readonly SelectorSymbol[]

  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationSymbol[]>
  declarationsForProperties(...properties: string[]): readonly DeclarationEntity[]

  readonly duplicateSelectors: ReadonlyMap<string, { readonly selector: string; readonly rules: readonly RuleEntity[] }>
  readonly multiDeclarationProperties: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly layoutPropertiesByClassToken: ReadonlyMap<string, readonly string[]>
  readonly usedFontFamilies: ReadonlySet<string>
  readonly usedFontFamiliesByRule: ReadonlyMap<number, readonly string[]>
  readonly idSelectors: readonly SelectorEntity[]
  readonly attributeSelectors: readonly SelectorEntity[]
  readonly universalSelectors: readonly SelectorEntity[]
  readonly selectorsTargetingCheckbox: readonly SelectorEntity[]
  readonly selectorsTargetingTableCell: readonly SelectorEntity[]
  readonly importantDeclarations: readonly DeclarationEntity[]
  readonly emptyRules: readonly RuleEntity[]
  readonly emptyKeyframes: readonly AtRuleEntity[]
  readonly deepNestedRules: readonly RuleEntity[]
  readonly overqualifiedSelectors: readonly SelectorEntity[]
  readonly unresolvedAnimationRefs: readonly { readonly declaration: DeclarationEntity; readonly name: string }[]
  readonly unknownContainerQueries: readonly AtRuleEntity[]
  readonly unusedContainerNames: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly keyframeDeclarations: readonly DeclarationEntity[]
  readonly tokensByCategory: ReadonlyMap<string, readonly ThemeTokenEntity[]>
  readonly mixinsByName: ReadonlyMap<string, MixinEntity>
  readonly functionsByName: ReadonlyMap<string, SCSSFunctionEntity>
  readonly placeholdersByName: ReadonlyMap<string, PlaceholderEntity>
  readonly unusedVariables: readonly VariableEntity[]
  readonly unusedKeyframes: readonly AtRuleEntity[]
  readonly unusedMixins: readonly MixinEntity[]
  readonly unusedFunctions: readonly SCSSFunctionEntity[]
  readonly unusedPlaceholders: readonly PlaceholderEntity[]
  readonly tokenCategories: readonly string[]

  hasClassName(name: string): boolean
  getClassName(name: string): ClassNameSymbol | null
  getSelectorsByClassName(name: string): readonly SelectorSymbol[]
  getCustomProperty(name: string): CustomPropertySymbol | null
  getKeyframes(name: string): KeyframesSymbol | null
  getFontFaces(family: string): readonly FontFaceSymbol[]
  getLayerOrder(name: string): number
}

const EMPTY_SELECTOR_SYMBOLS: readonly SelectorSymbol[] = []
const EMPTY_FONT_FACE_SYMBOLS: readonly FontFaceSymbol[] = []
const FONT_LAYOUT_PROPERTIES = ["font-family"]
const FONT_GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "emoji", "math", "fangsong",
])
const WHITESPACE_RE = /\s+/

function normalizeCssValue(value: string): string {
  return value.trim().toLowerCase()
}

function firstDeclaration<T extends { readonly property: string }>(
  declarations: readonly T[],
  property: string,
): T | null {
  const needle = property.toLowerCase()
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    if (!decl) continue
    if (decl.property.toLowerCase() === needle) return decl
  }
  return null
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if (first !== last) return value
  if (first !== "\"" && first !== "'") return value
  return value.slice(1, -1).trim()
}

function collapseWhitespace(value: string): string {
  const parts = value.split(WHITESPACE_RE)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || part.length === 0) continue
    out.push(part)
  }
  return out.join(" ")
}

function normalizeFontFamily(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const unquoted = stripQuotes(trimmed)
  if (unquoted.length === 0) return null
  const normalized = collapseWhitespace(unquoted.toLowerCase())
  if (normalized.length === 0) return null
  if (FONT_GENERIC_FAMILIES.has(normalized)) return null
  return normalized
}

function parseFontFamilyList(value: string): readonly string[] {
  const out: string[] = []
  const tokens = splitComma(value)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    const family = normalizeFontFamily(token)
    if (!family) continue
    out.push(family)
  }
  return out
}

function firstToken(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return ""
  const parts = normalized.split(WHITESPACE_RE)
  return parts[0] ?? ""
}

function isWebFontSource(value: string): boolean {
  return value.toLowerCase().includes("url(")
}

function isEffectiveFontMetricValue(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return false
  return normalized !== "normal" && normalized !== "none"
}

function hasEffectiveMetricOverrides(
  declarations: readonly { readonly property: string; readonly value: string }[],
): boolean {
  const sizeAdjust = firstDeclaration(declarations, "size-adjust")
  if (sizeAdjust && isEffectiveFontMetricValue(sizeAdjust.value)) return true
  const ascentOverride = firstDeclaration(declarations, "ascent-override")
  const descentOverride = firstDeclaration(declarations, "descent-override")
  const lineGapOverride = firstDeclaration(declarations, "line-gap-override")
  if (!ascentOverride || !descentOverride || !lineGapOverride) return false
  return isEffectiveFontMetricValue(ascentOverride.value)
    && isEffectiveFontMetricValue(descentOverride.value)
    && isEffectiveFontMetricValue(lineGapOverride.value)
}

function buildDedupKey(rule: RuleEntity, selector: string): string {
  let ancestry = ""
  let current: RuleEntity["parent"] = rule.parent
  while (current !== null) {
    if (current.kind === "rule") {
      ancestry = current.selectorText + "\0" + ancestry
      current = current.parent
    } else {
      ancestry = `@${current.name} ${current.params}\0` + ancestry
      current = current.parent
    }
  }
  return `${rule.file.path}\0${ancestry}${selector}`
}

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key)
  if (arr !== undefined) arr.push(value)
  else map.set(key, [value])
}

export function buildSymbolTable(trees: readonly CSSSyntaxTree[], tailwindValidator?: TailwindValidator | null, solidClassTokens?: ReadonlySet<string> | null): SymbolTable {
  const classNamesMap = new Map<string, { selectors: SelectorEntity[]; filePaths: Set<string> }>()
  const selectorsMap = new Map<number, SelectorSymbol>()
  const customPropertiesMap = new Map<string, CustomPropertySymbol>()
  const layersMap = new Map<string, LayerSymbol>()
  const themeTokensMap = new Map<string, ThemeTokenSymbol>()

  const selectorsByDispatchKeyMap = new Map<string, SelectorSymbol[]>()
  const selectorsBySubjectTagMap = new Map<string, SelectorSymbol[]>()
  const selectorsWithoutSubjectTagArr: SelectorSymbol[] = []

  const declarationsByPropertyMap = new Map<string, DeclarationSymbol[]>()
  const mergedDeclarationsByProperty = new Map<string, DeclarationEntity[]>()

  const selectorDedupIndex = new Map<string, RuleEntity[]>()
  const duplicateSelectorsMap = new Map<string, { selector: string; rules: RuleEntity[] }>()

  const idSelectorsArr: SelectorEntity[] = []
  const attributeSelectorsArr: SelectorEntity[] = []
  const universalSelectorsArr: SelectorEntity[] = []
  const selectorsTargetingCheckboxArr: SelectorEntity[] = []
  const selectorsTargetingTableCellArr: SelectorEntity[] = []
  const importantDeclarationsArr: DeclarationEntity[] = []
  const tokensByCategoryMap = new Map<string, ThemeTokenEntity[]>()
  const mixinsByNameMap = new Map<string, MixinEntity>()
  const functionsByNameMap = new Map<string, SCSSFunctionEntity>()
  const placeholdersByNameMap = new Map<string, PlaceholderEntity>()

  const allRules: RuleEntity[] = []
  const allSelectors: SelectorEntity[] = []
  const allDeclarations: DeclarationEntity[] = []
  const allVariables: VariableEntity[] = []
  const referencedCustomPropertyNamesSet = new Set<string>()
  const allAtRules: AtRuleEntity[] = []
  const allKeyframeAtRules: AtRuleEntity[] = []
  const allFontFaceAtRules: AtRuleEntity[] = []
  const allLayerAtRules: AtRuleEntity[] = []
  const allMixins: MixinEntity[] = []
  const allFunctions: SCSSFunctionEntity[] = []
  const allPlaceholders: PlaceholderEntity[] = []

  let layerOrderCounter = 0

  for (let t = 0; t < trees.length; t++) {
    const tree = trees[t]
    if (!tree) continue
    const filePath = tree.filePath

    // Selectors
    const treeSelectors = tree.selectors
    for (let i = 0; i < treeSelectors.length; i++) {
      const entity = treeSelectors[i]
      if (!entity) continue
      allSelectors.push(entity)

      const symbol = createSelectorSymbol(entity, filePath)
      selectorsMap.set(entity.id, symbol)

      const dispatchKeys = symbol.dispatchKeys
      for (let j = 0; j < dispatchKeys.length; j++) {
        const key = dispatchKeys[j]
        if (!key) continue
        pushToMapArray(selectorsByDispatchKeyMap, key, symbol)
      }

      const subjectTag = entity.anchor.subjectTag
      if (subjectTag !== null) {
        pushToMapArray(selectorsBySubjectTagMap, subjectTag, symbol)
      } else {
        selectorsWithoutSubjectTagArr.push(symbol)
      }

      const flags = entity.complexity._flags
      if (hasFlag(flags, SEL_HAS_ID)) idSelectorsArr.push(entity)
      if (hasFlag(flags, SEL_HAS_ATTRIBUTE)) attributeSelectorsArr.push(entity)
      if (hasFlag(flags, SEL_HAS_UNIVERSAL)) universalSelectorsArr.push(entity)

      if (entity.anchor.targetsCheckbox) selectorsTargetingCheckboxArr.push(entity)
      if (entity.anchor.targetsTableCell) selectorsTargetingTableCellArr.push(entity)

      // Class name index
      const compounds = entity.compounds
      for (let ci = 0; ci < compounds.length; ci++) {
        const compound = compounds[ci]
        if (!compound) continue
        const classes = compound.classes
        for (let j = 0; j < classes.length; j++) {
          const cls = classes[j]
          if (!cls) continue
          let entry = classNamesMap.get(cls)
          if (!entry) {
            entry = { selectors: [], filePaths: new Set() }
            classNamesMap.set(cls, entry)
          }
          entry.selectors.push(entity)
          entry.filePaths.add(filePath)
        }
      }
    }

    // Rules — duplicate detection + collection
    const treeRules = tree.rules
    for (let i = 0; i < treeRules.length; i++) {
      const rule = treeRules[i]
      if (!rule) continue
      allRules.push(rule)

      const selectorText = rule.selectorText
      // Skip keyframe selectors
      let isKeyframeChild = false
      let parent: RuleEntity["parent"] = rule.parent
      while (parent !== null) {
        if (parent.kind === "keyframes") { isKeyframeChild = true; break }
        parent = parent.parent
      }
      if (isKeyframeChild) continue

      const dedupKey = buildDedupKey(rule, selectorText)
      const dedupExisting = selectorDedupIndex.get(dedupKey)
      if (dedupExisting) {
        dedupExisting.push(rule)
        const dups = duplicateSelectorsMap.get(selectorText)
        if (dups) {
          dups.rules.push(rule)
        } else {
          const first = dedupExisting[0]
          if (!first) continue
          duplicateSelectorsMap.set(selectorText, { selector: selectorText, rules: [first, rule] })
        }
      } else {
        selectorDedupIndex.set(dedupKey, [rule])
      }
    }

    // Declarations
    const treeDeclarations = tree.declarations
    for (let i = 0; i < treeDeclarations.length; i++) {
      const entity = treeDeclarations[i]
      if (!entity) continue
      allDeclarations.push(entity)

      const sourceOrder = tree.sourceOrderBase + entity.id
      const layerOrder = entity.cascadePosition.layerOrder
      const symbol = createDeclarationSymbol(entity, filePath, sourceOrder, layerOrder)
      pushToMapArray(declarationsByPropertyMap, entity.property, symbol)
      pushToMapArray(mergedDeclarationsByProperty, entity.property, entity)

      if (hasFlag(entity._flags, DECL_IS_IMPORTANT) || entity.node.important) {
        importantDeclarationsArr.push(entity)
      }
    }

    // Variables
    const treeVariables = tree.variables
    for (let i = 0; i < treeVariables.length; i++) {
      const entity = treeVariables[i]
      if (!entity) continue
      allVariables.push(entity)
      if (!customPropertiesMap.has(entity.name)) {
        customPropertiesMap.set(entity.name, createCustomPropertySymbol(entity, filePath))
      }
    }

    const treeVariableRefs = tree.variableRefs
    for (let i = 0; i < treeVariableRefs.length; i++) {
      const ref = treeVariableRefs[i]
      if (ref) referencedCustomPropertyNamesSet.add(ref.name)
    }

    // At-rules
    const treeAtRules = tree.atRules
    for (let i = 0; i < treeAtRules.length; i++) {
      const entity = treeAtRules[i]
      if (!entity) continue
      allAtRules.push(entity)

      switch (entity.kind) {
        case "keyframes":
          allKeyframeAtRules.push(entity)
          break
        case "font-face":
          allFontFaceAtRules.push(entity)
          break
        case "layer": {
          allLayerAtRules.push(entity)
          const layerName = entity.params.trim()
          if (layerName && !layersMap.has(layerName)) {
            layersMap.set(layerName, createLayerSymbol(entity, layerName, filePath, layerOrderCounter++))
          }
          break
        }
      }
    }

    // Tokens
    const treeTokens = tree.tokens
    for (let i = 0; i < treeTokens.length; i++) {
      const entity = treeTokens[i]
      if (!entity) continue
      if (!themeTokensMap.has(entity.name)) {
        themeTokensMap.set(entity.name, createThemeTokenSymbol(entity, filePath))
      }
      pushToMapArray(tokensByCategoryMap, entity.category, entity)
    }

    // Mixins
    const treeMixins = tree.mixins
    for (let i = 0; i < treeMixins.length; i++) {
      const mixin = treeMixins[i]
      if (!mixin) continue
      allMixins.push(mixin)
      if (!mixinsByNameMap.has(mixin.name)) mixinsByNameMap.set(mixin.name, mixin)
    }

    // Functions
    const treeFunctions = tree.functions
    for (let i = 0; i < treeFunctions.length; i++) {
      const fn = treeFunctions[i]
      if (!fn) continue
      allFunctions.push(fn)
      if (!functionsByNameMap.has(fn.name)) functionsByNameMap.set(fn.name, fn)
    }

    // Placeholders
    const treePlaceholders = tree.placeholders
    for (let i = 0; i < treePlaceholders.length; i++) {
      const ph = treePlaceholders[i]
      if (!ph) continue
      allPlaceholders.push(ph)
      if (!placeholdersByNameMap.has(ph.name)) placeholdersByNameMap.set(ph.name, ph)
    }
  }

  // Build ClassNameSymbol map — CSS + Tailwind resolved in one pass
  const twValidator = tailwindValidator ?? null
  const classNameSymbols = new Map<string, ClassNameSymbol>()
  for (const [name, entry] of classNamesMap) {
    const twCSS = twValidator !== null && twValidator.has(name) ? twValidator.resolve(name) : null
    classNameSymbols.set(name, createClassNameSymbol(name, entry.selectors, [...entry.filePaths], twCSS))
  }

  // Tailwind-only classes from solid trees (not in any CSS selector)
  if (twValidator !== null && solidClassTokens !== null && solidClassTokens !== undefined) {
    for (const name of solidClassTokens) {
      if (classNameSymbols.has(name)) continue
      if (!twValidator.has(name)) continue
      const resolvedCSS = twValidator.resolve(name)
      classNameSymbols.set(name, {
        symbolKind: "className",
        name,
        filePath: null,
        source: {
          kind: "tailwind",
          candidate: { raw: name, variants: [], utility: name, value: null, modifier: null, important: false, negative: false },
          resolvedCSS,
          declarations: [],
          diagnostics: [],
        },
        tailwindResolvedCSS: resolvedCSS,
      })
    }
  }

  // Build keyframe indexes
  const knownKeyframeNames = new Set<string>()
  for (let i = 0; i < allKeyframeAtRules.length; i++) {
    const kf = allKeyframeAtRules[i]
    if (!kf) continue
    const name = kf.parsedParams.animationName
    if (name) knownKeyframeNames.add(name)
  }

  const IGNORED_KEYFRAME_NAMES = new Set([...CSS_WIDE_KEYWORDS, "none"])

  const unresolvedAnimationRefsArr: { declaration: DeclarationEntity; name: string }[] = []
  const animDecls = declarationsForPropertiesImpl(mergedDeclarationsByProperty, "animation", "animation-name")
  for (let i = 0; i < animDecls.length; i++) {
    const d = animDecls[i]
    if (!d) continue
    const names = extractKeyframeNames(d.value, d.property.toLowerCase())
    for (let j = 0; j < names.length; j++) {
      const name = names[j]
      if (!name) continue
      if (IGNORED_KEYFRAME_NAMES.has(name)) continue
      if (name.includes("(")) continue
      if (knownKeyframeNames.has(name)) continue
      unresolvedAnimationRefsArr.push({ declaration: d, name })
    }
  }

  const keyframeDeclarationsArr: DeclarationEntity[] = []
  const byAnimationByProperty = new Map<string, Map<string, { values: Set<string>; declarations: DeclarationEntity[] }>>()

  for (let i = 0; i < allDeclarations.length; i++) {
    const d = allDeclarations[i]
    if (!d) continue
    const rule = d.rule
    if (!rule) continue
    const parent = rule.parent
    if (!parent) continue
    if (parent.kind === "rule") continue
    if (parent.kind !== "keyframes") continue
    keyframeDeclarationsArr.push(d)

    const property = d.property.toLowerCase()
    if (!LAYOUT_ANIMATION_MUTATION_PROPERTIES.has(property)) continue

    const animationName = normalizeAnimationName(parent.params)
    if (!animationName) continue

    let byProperty = byAnimationByProperty.get(animationName)
    if (!byProperty) {
      byProperty = new Map()
      byAnimationByProperty.set(animationName, byProperty)
    }

    let bucket = byProperty.get(property)
    if (!bucket) {
      bucket = { values: new Set(), declarations: [] }
      byProperty.set(property, bucket)
    }

    bucket.values.add(normalizeCssValue(d.value))
    bucket.declarations.push(d)
  }

  const keyframeLayoutMutationsByName = new Map<string, readonly KeyframeLayoutMutation[]>()
  for (const [animationName, byProperty] of byAnimationByProperty) {
    const mutations: KeyframeLayoutMutation[] = []
    for (const [property, bucket] of byProperty) {
      if (bucket.values.size <= 1) continue
      mutations.push({ property, values: [...bucket.values], declarations: bucket.declarations })
    }
    if (mutations.length === 0) continue
    keyframeLayoutMutationsByName.set(animationName, mutations)
  }

  // Build KeyframesSymbol map
  const keyframesMap = new Map<string, KeyframesSymbol>()
  for (let i = 0; i < allKeyframeAtRules.length; i++) {
    const kf = allKeyframeAtRules[i]
    if (!kf) continue
    const name = kf.parsedParams.animationName ?? kf.params.trim()
    if (!name) continue
    if (keyframesMap.has(name)) continue
    const mutations = keyframeLayoutMutationsByName.get(name) ?? []
    keyframesMap.set(name, createKeyframesSymbol(kf, name, kf.file.path, mutations))
  }

  // Build unused keyframes
  const usedAnimationNames = new Set<string>()
  for (let i = 0; i < animDecls.length; i++) {
    const d = animDecls[i]
    if (!d) continue
    const names = extractKeyframeNames(d.value, d.property.toLowerCase())
    for (let j = 0; j < names.length; j++) {
      const name = names[j]
      if (name) usedAnimationNames.add(name)
    }
  }
  const unusedKeyframesArr: AtRuleEntity[] = []
  for (let i = 0; i < allKeyframeAtRules.length; i++) {
    const kf = allKeyframeAtRules[i]
    if (!kf) continue
    const name = kf.parsedParams.animationName ?? kf.params.trim()
    if (!usedAnimationNames.has(name)) unusedKeyframesArr.push(kf)
  }

  // Build container name indexes
  const declaredContainerNames = new Map<string, DeclarationEntity[]>()
  for (let i = 0; i < allDeclarations.length; i++) {
    const d = allDeclarations[i]
    if (!d) continue
    const p = d.property.toLowerCase()
    let names: readonly string[] | null = null
    if (p === "container-name") names = parseContainerNames(d.value)
    else if (p === "container") names = parseContainerNamesFromShorthand(d.value)
    if (!names) continue
    for (let j = 0; j < names.length; j++) {
      const name = names[j]
      if (!name) continue
      const existing = declaredContainerNames.get(name)
      if (existing) existing.push(d)
      else declaredContainerNames.set(name, [d])
    }
  }

  const containerQueryNames = new Map<string, AtRuleEntity[]>()
  for (let i = 0; i < allAtRules.length; i++) {
    const at = allAtRules[i]
    if (!at) continue
    if (at.kind !== "container") continue
    const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params)
    if (!name) continue
    const existing = containerQueryNames.get(name)
    if (existing) existing.push(at)
    else containerQueryNames.set(name, [at])
  }

  const unusedContainerNamesMap = new Map<string, DeclarationEntity[]>()
  for (const [name, decls] of declaredContainerNames) {
    if (!containerQueryNames.has(name)) unusedContainerNamesMap.set(name, decls)
  }

  const unknownContainerQueriesArr: AtRuleEntity[] = []
  for (const [name, atRules] of containerQueryNames) {
    if (!declaredContainerNames.has(name)) {
      for (let i = 0; i < atRules.length; i++) {
        const atRule = atRules[i]
        if (atRule) unknownContainerQueriesArr.push(atRule)
      }
    }
  }

  // Build ContainerSymbol map
  const containersMap = new Map<string, ContainerSymbol>()
  for (const [name, decls] of declaredContainerNames) {
    const queries = containerQueryNames.get(name) ?? []
    containersMap.set(name, createContainerSymbol(name, decls, queries))
  }
  for (const [name, queries] of containerQueryNames) {
    if (!containersMap.has(name)) {
      containersMap.set(name, createContainerSymbol(name, [], queries))
    }
  }

  // Build multiDeclarationProperties (sort by sourceOrder, keep 2+)
  const multiDeclarationPropertiesMap = new Map<string, readonly DeclarationEntity[]>()
  for (const [property, declarations] of mergedDeclarationsByProperty) {
    declarations.sort((a, b) => a.sourceOrder - b.sourceOrder)
    if (declarations.length >= 2) {
      multiDeclarationPropertiesMap.set(property, declarations)
    }
  }

  // Build layoutPropertiesByClassToken
  const layoutByClass = new Map<string, Set<string>>()
  for (let i = 0; i < allSelectors.length; i++) {
    const selector = allSelectors[i]
    if (!selector) continue
    if (selector.anchor.classes.length === 0) continue

    const properties = new Set<string>()
    const rule = selector.rule
    const ruleDecls = rule.declarations
    for (let j = 0; j < ruleDecls.length; j++) {
      const decl = ruleDecls[j]
      if (!decl) continue
      const property = decl.property.toLowerCase()
      if (!LAYOUT_CLASS_GEOMETRY_PROPERTIES.has(property)) continue
      properties.add(property)
    }
    if (properties.size === 0) continue

    const anchorClasses = selector.anchor.classes
    for (let j = 0; j < anchorClasses.length; j++) {
      const className = anchorClasses[j]
      if (!className) continue
      let existing = layoutByClass.get(className)
      if (!existing) {
        existing = new Set()
        layoutByClass.set(className, existing)
      }
      for (const property of properties) existing.add(property)
    }
  }
  const layoutPropertiesByClassTokenMap = new Map<string, readonly string[]>()
  for (const [className, properties] of layoutByClass) {
    layoutPropertiesByClassTokenMap.set(className, [...properties])
  }

  // Build font indexes
  const usedFontFamiliesSet = new Set<string>()
  const usedFontFamiliesByRuleMap = new Map<number, readonly string[]>()
  const fontDecls = declarationsForPropertiesImpl(mergedDeclarationsByProperty, ...FONT_LAYOUT_PROPERTIES)
  for (let i = 0; i < fontDecls.length; i++) {
    const declaration = fontDecls[i]
    if (!declaration) continue
    const rule = declaration.rule
    if (!rule) continue
    const families = parseFontFamilyList(declaration.value)
    if (families.length === 0) continue
    for (let j = 0; j < families.length; j++) {
      const family = families[j]
      if (!family) continue
      usedFontFamiliesSet.add(family)
    }
    const existing = usedFontFamiliesByRuleMap.get(rule.id)
    if (!existing) {
      usedFontFamiliesByRuleMap.set(rule.id, families)
    } else {
      const merged = new Set(existing)
      for (let j = 0; j < families.length; j++) {
        const family = families[j]
        if (!family) continue
        merged.add(family)
      }
      usedFontFamiliesByRuleMap.set(rule.id, [...merged])
    }
  }

  // Build FontFaceSymbol map
  const fontFacesMap = new Map<string, FontFaceSymbol[]>()
  for (let i = 0; i < allFontFaceAtRules.length; i++) {
    const fontFace = allFontFaceAtRules[i]
    if (!fontFace) continue
    const familyDeclaration = firstDeclaration(fontFace.declarations, "font-family")
    if (!familyDeclaration) continue
    const family = normalizeFontFamily(familyDeclaration.value)
    if (!family) continue
    const displayDeclaration = firstDeclaration(fontFace.declarations, "font-display")
    const srcDeclaration = firstDeclaration(fontFace.declarations, "src")
    const display = displayDeclaration ? firstToken(displayDeclaration.value) : null
    const hasWebFont = srcDeclaration ? isWebFontSource(srcDeclaration.value) : false
    const hasMetricOverrides = hasEffectiveMetricOverrides(fontFace.declarations)
    const symbol = createFontFaceSymbol(fontFace, family, fontFace.file.path, display, hasWebFont, hasMetricOverrides)
    const existing = fontFacesMap.get(family)
    if (existing) existing.push(symbol)
    else fontFacesMap.set(family, [symbol])
  }

  // Build emptyRules
  const emptyRulesArr: RuleEntity[] = []
  for (let i = 0; i < allRules.length; i++) {
    const r = allRules[i]
    if (!r) continue
    if (r.declarations.length === 0 && r.nestedRules.length === 0 && r.nestedAtRules.length === 0) {
      emptyRulesArr.push(r)
    }
  }

  // Build emptyKeyframes
  const emptyKeyframesArr: AtRuleEntity[] = []
  for (let i = 0; i < allKeyframeAtRules.length; i++) {
    const kf = allKeyframeAtRules[i]
    if (!kf) continue
    if (!kf.parsedParams.animationName) continue
    if (kf.rules.length === 0) {
      emptyKeyframesArr.push(kf)
      continue
    }
    let hasDeclaration = false
    for (let j = 0; j < kf.rules.length; j++) {
      const kfRule = kf.rules[j]
      if (!kfRule) continue
      if (kfRule.declarations.length > 0) { hasDeclaration = true; break }
    }
    if (!hasDeclaration) emptyKeyframesArr.push(kf)
  }

  // Build deepNestedRules
  const deepNestedRulesArr: RuleEntity[] = []
  for (let i = 0; i < allRules.length; i++) {
    const r = allRules[i]
    if (!r) continue
    if (r.depth > 3) deepNestedRulesArr.push(r)
  }

  // Build overqualifiedSelectors
  const overqualifiedSelectorsArr: SelectorEntity[] = []
  for (let i = 0; i < idSelectorsArr.length; i++) {
    const sel = idSelectorsArr[i]
    if (!sel) continue
    const compounds = sel.compounds
    if (compounds.length === 0) continue
    const subject = compounds[compounds.length - 1]
    if (!subject) continue
    if (subject.idValue !== null && (subject.tagName !== null || subject.classes.length > 0 || subject.attributes.length > 0)) {
      overqualifiedSelectorsArr.push(sel)
    }
  }

  // Build unused indexes
  const unusedVariablesArr: VariableEntity[] = []
  for (let i = 0; i < allVariables.length; i++) {
    const v = allVariables[i]
    if (!v) continue
    if (!hasFlag(v._flags, VAR_IS_USED)) unusedVariablesArr.push(v)
  }
  const unusedMixinsArr: MixinEntity[] = []
  for (let i = 0; i < allMixins.length; i++) {
    const m = allMixins[i]
    if (!m) continue
    if (!hasFlag(m._flags, MIXIN_IS_USED)) unusedMixinsArr.push(m)
  }
  const unusedFunctionsArr: SCSSFunctionEntity[] = []
  for (let i = 0; i < allFunctions.length; i++) {
    const f = allFunctions[i]
    if (!f) continue
    if (!hasFlag(f._flags, SCSSFN_IS_USED)) unusedFunctionsArr.push(f)
  }
  const unusedPlaceholdersArr: PlaceholderEntity[] = []
  for (let i = 0; i < allPlaceholders.length; i++) {
    const p = allPlaceholders[i]
    if (!p) continue
    if (!hasFlag(p._flags, PLACEHOLDER_IS_USED)) unusedPlaceholdersArr.push(p)
  }

  // Build selectorsByClassName lookup for getters
  const selectorSymbolsByClassName = new Map<string, SelectorSymbol[]>()
  for (const [, symbol] of selectorsMap) {
    const compounds = symbol.entity.compounds
    for (let ci = 0; ci < compounds.length; ci++) {
      const compound = compounds[ci]
      if (!compound) continue
      const classes = compound.classes
      for (let j = 0; j < classes.length; j++) {
        const cls = classes[j]
        if (!cls) continue
        pushToMapArray(selectorSymbolsByClassName, cls, symbol)
      }
    }
  }

  return {
    classNames: classNameSymbols,
    selectors: selectorsMap,
    customProperties: customPropertiesMap,
    componentHosts: new Map<string, ComponentHostSymbol>(), // Phase 6: populated during binding — empty in Phase 2
    keyframes: keyframesMap,
    fontFaces: fontFacesMap,
    layers: layersMap,
    containers: containersMap,
    themeTokens: themeTokensMap,

    selectorsByDispatchKey: selectorsByDispatchKeyMap,
    selectorsBySubjectTag: selectorsBySubjectTagMap,
    selectorsWithoutSubjectTag: selectorsWithoutSubjectTagArr,

    declarationsByProperty: declarationsByPropertyMap,
    declarationsForProperties(...properties: string[]): readonly DeclarationEntity[] {
      return declarationsForPropertiesImpl(mergedDeclarationsByProperty, ...properties)
    },

    duplicateSelectors: duplicateSelectorsMap,
    multiDeclarationProperties: multiDeclarationPropertiesMap,
    layoutPropertiesByClassToken: layoutPropertiesByClassTokenMap,
    usedFontFamilies: usedFontFamiliesSet,
    usedFontFamiliesByRule: usedFontFamiliesByRuleMap,
    idSelectors: idSelectorsArr,
    attributeSelectors: attributeSelectorsArr,
    universalSelectors: universalSelectorsArr,
    selectorsTargetingCheckbox: selectorsTargetingCheckboxArr,
    selectorsTargetingTableCell: selectorsTargetingTableCellArr,
    importantDeclarations: importantDeclarationsArr,
    emptyRules: emptyRulesArr,
    emptyKeyframes: emptyKeyframesArr,
    deepNestedRules: deepNestedRulesArr,
    overqualifiedSelectors: overqualifiedSelectorsArr,
    unresolvedAnimationRefs: unresolvedAnimationRefsArr,
    unknownContainerQueries: unknownContainerQueriesArr,
    unusedContainerNames: unusedContainerNamesMap,
    keyframeDeclarations: keyframeDeclarationsArr,
    tokensByCategory: tokensByCategoryMap,
    mixinsByName: mixinsByNameMap,
    functionsByName: functionsByNameMap,
    placeholdersByName: placeholdersByNameMap,
    unusedVariables: unusedVariablesArr,
    unusedKeyframes: unusedKeyframesArr,
    unusedMixins: unusedMixinsArr,
    unusedFunctions: unusedFunctionsArr,
    unusedPlaceholders: unusedPlaceholdersArr,
    tokenCategories: [...tokensByCategoryMap.keys()],
    referencedCustomPropertyNames: referencedCustomPropertyNamesSet,

    hasClassName(name: string): boolean {
      return classNameSymbols.has(name)
    },
    getClassName(name: string): ClassNameSymbol | null {
      return classNameSymbols.get(name) ?? null
    },
    getSelectorsByClassName(name: string): readonly SelectorSymbol[] {
      return selectorSymbolsByClassName.get(name) ?? EMPTY_SELECTOR_SYMBOLS
    },
    getCustomProperty(name: string): CustomPropertySymbol | null {
      return customPropertiesMap.get(name) ?? null
    },
    getKeyframes(name: string): KeyframesSymbol | null {
      return keyframesMap.get(name) ?? null
    },
    getFontFaces(family: string): readonly FontFaceSymbol[] {
      return fontFacesMap.get(family) ?? EMPTY_FONT_FACE_SYMBOLS
    },
    getLayerOrder(name: string): number {
      const layer = layersMap.get(name)
      return layer ? layer.order : -1
    },
  }
}

function declarationsForPropertiesImpl(
  index: ReadonlyMap<string, readonly DeclarationEntity[]>,
  ...properties: string[]
): readonly DeclarationEntity[] {
  if (properties.length === 1) {
    const prop = properties[0]
    if (!prop) return []
    return index.get(prop) ?? []
  }
  const out: DeclarationEntity[] = []
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    if (!prop) continue
    const list = index.get(prop)
    if (list) {
      for (let j = 0; j < list.length; j++) {
        const item = list[j]
        if (item) out.push(item)
      }
    }
  }
  return out
}
