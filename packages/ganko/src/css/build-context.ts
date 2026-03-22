/**
 * CSSBuildContext — mutable accumulator for CSS analysis phases.
 *
 * Replaces the CSSGraph class. Phases call add* methods to populate entities.
 * After all phases complete, buildDerivedIndexes() is called, then the context
 * is frozen into CSSSyntaxTree[] + CSSWorkspaceView.
 */
import type { Rule, AtRule } from "postcss"
import type { CSSInput, CSSOptions } from "./input"
import type { TailwindValidator } from "./tailwind"
import type { Logger } from "@drskillissue/ganko-shared"
import { noopLogger } from "@drskillissue/ganko-shared"
import { extractKeyframeNames } from "@drskillissue/ganko-shared"
import type { StringInterner } from "@drskillissue/ganko-shared"
import { createCSSInterner } from "./intern"
import {
  parseContainerNames,
  parseContainerNamesFromShorthand,
  parseContainerQueryName,
  normalizeAnimationName,
  splitComma,
  CSS_WIDE_KEYWORDS,
} from "./parser/value-util"
import { LAYOUT_ANIMATION_MUTATION_PROPERTIES, LAYOUT_CLASS_GEOMETRY_PROPERTIES } from "./layout-taxonomy"
import type {
  FileEntity, RuleEntity, SelectorEntity, DeclarationEntity,
  VariableEntity, VariableReferenceEntity, AtRuleEntity, ThemeTokenEntity,
  MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity,
  PlaceholderEntity, ExtendEntity, TokenCategory, CSSParseError, AtRuleKind,
} from "./entities"
import {
  hasFlag,
  DECL_IS_IMPORTANT, VAR_IS_GLOBAL, VAR_IS_SCSS, VAR_IS_USED,
  REF_IS_RESOLVED, INCLUDE_IS_RESOLVED, EXTEND_IS_RESOLVED,
  MIXIN_IS_USED, SCSSFN_IS_USED, PLACEHOLDER_IS_USED,
  SEL_HAS_ID, SEL_HAS_ATTRIBUTE, SEL_HAS_UNIVERSAL,
} from "./entities"
import type { UnresolvedAnimationRef, KeyframeLayoutMutation, FontFaceDescriptor } from "./impl"

// ── CSSBuildContext ───────────────────────────────────────────────────────

export interface CSSBuildContext {
  readonly options: CSSOptions
  readonly interner: StringInterner
  readonly logger: Logger
  readonly tailwind: TailwindValidator | null

  sourceOrder: number
  hasScssFiles: boolean

  // Entity arrays
  readonly files: FileEntity[]
  readonly rules: RuleEntity[]
  readonly selectors: SelectorEntity[]
  readonly declarations: DeclarationEntity[]
  readonly variables: VariableEntity[]
  readonly variableRefs: VariableReferenceEntity[]
  readonly atRules: AtRuleEntity[]
  readonly tokens: ThemeTokenEntity[]
  readonly mixins: MixinEntity[]
  readonly includes: MixinIncludeEntity[]
  readonly functions: SCSSFunctionEntity[]
  readonly functionCalls: FunctionCallEntity[]
  readonly placeholders: PlaceholderEntity[]
  readonly extends: ExtendEntity[]

  // Index maps
  readonly filesByPath: Map<string, FileEntity>
  readonly variablesByName: Map<string, VariableEntity[]>
  readonly rulesBySelector: Map<string, RuleEntity[]>
  readonly _selectorDedupIndex: Map<string, RuleEntity[]>
  readonly mixinsByName: Map<string, MixinEntity>
  readonly functionsByName: Map<string, SCSSFunctionEntity>
  readonly placeholdersByName: Map<string, PlaceholderEntity>
  readonly layerOrder: Map<string, number>
  readonly declarationsByProperty: Map<string, DeclarationEntity[]>
  readonly atRulesByName: Map<string, AtRuleEntity[]>
  readonly atRulesByKind: Map<AtRuleKind, AtRuleEntity[]>
  readonly atRulesByNode: Map<AtRule, AtRuleEntity>
  readonly rulesByNode: Map<Rule, RuleEntity>
  readonly duplicateSelectors: Map<string, { selector: string; rules: RuleEntity[] }>
  readonly tokensByCategory: Map<TokenCategory, ThemeTokenEntity[]>

  // Classified arrays
  readonly importantDeclarations: DeclarationEntity[]
  readonly globalVariables: VariableEntity[]
  readonly unusedVariables: VariableEntity[]
  readonly scssVariables: VariableEntity[]
  readonly cssCustomProperties: VariableEntity[]
  readonly unresolvedRefs: VariableReferenceEntity[]
  readonly mediaQueries: AtRuleEntity[]
  readonly keyframes: AtRuleEntity[]
  readonly layers: AtRuleEntity[]
  readonly fontFaces: AtRuleEntity[]
  readonly supportsRules: AtRuleEntity[]
  readonly unusedKeyframes: AtRuleEntity[]
  readonly unusedMixins: MixinEntity[]
  readonly unresolvedMixinIncludes: MixinIncludeEntity[]
  readonly unusedFunctions: SCSSFunctionEntity[]
  readonly unusedPlaceholders: PlaceholderEntity[]
  readonly unresolvedExtends: ExtendEntity[]
  readonly parseErrors: CSSParseError[]
  readonly failedFilePaths: string[]
  readonly tokenCategories: TokenCategory[]

  // Selector classification
  readonly selectorsByPseudoClass: Map<string, SelectorEntity[]>
  readonly idSelectors: SelectorEntity[]
  readonly attributeSelectors: SelectorEntity[]
  readonly universalSelectors: SelectorEntity[]
  readonly classNameIndex: Map<string, SelectorEntity[]>
  readonly selectorsBySubjectTag: Map<string, SelectorEntity[]>
  readonly selectorsWithoutSubjectTag: SelectorEntity[]
  readonly selectorsTargetingCheckbox: SelectorEntity[]
  readonly selectorsTargetingTableCell: SelectorEntity[]

  // Derived indexes (built by buildDerivedIndexes)
  readonly knownKeyframeNames: Set<string>
  readonly unresolvedAnimationRefs: UnresolvedAnimationRef[]
  readonly declaredContainerNames: Map<string, DeclarationEntity[]>
  readonly containerQueryNames: Map<string, AtRuleEntity[]>
  readonly unusedContainerNames: Map<string, DeclarationEntity[]>
  readonly unknownContainerQueries: AtRuleEntity[]
  readonly multiDeclarationProperties: Map<string, readonly DeclarationEntity[]>
  readonly keyframeDeclarations: DeclarationEntity[]
  readonly layoutPropertiesByClassToken: Map<string, readonly string[]>
  readonly keyframeLayoutMutationsByName: Map<string, readonly KeyframeLayoutMutation[]>
  readonly fontFaceDescriptorsByFamily: Map<string, readonly FontFaceDescriptor[]>
  readonly usedFontFamiliesByRule: Map<number, readonly string[]>
  readonly usedFontFamilies: Set<string>

  // ID generation
  nextFileId(): number
  nextRuleId(): number
  nextSelectorId(): number
  nextDeclarationId(): number
  nextVariableId(): number
  nextVariableRefId(): number
  nextAtRuleId(): number
  nextTokenId(): number
  nextMixinId(): number
  nextIncludeId(): number
  nextFunctionId(): number
  nextFunctionCallId(): number
  nextPlaceholderId(): number
  nextExtendId(): number
  nextSourceOrder(): number

  // Interning
  intern(s: string): string

  // Mutation methods
  addFile(file: FileEntity): void
  addRule(rule: RuleEntity): void
  addSelector(selector: SelectorEntity): void
  addDeclaration(decl: DeclarationEntity): void
  addVariable(variable: VariableEntity): void
  addVariableRef(ref: VariableReferenceEntity): void
  addAtRule(atRule: AtRuleEntity): void
  addToken(token: ThemeTokenEntity): void
  addMixin(mixin: MixinEntity): void
  addMixinInclude(include: MixinIncludeEntity): void
  addFunction(fn: SCSSFunctionEntity): void
  addFunctionCall(call: FunctionCallEntity): void
  addPlaceholder(placeholder: PlaceholderEntity): void
  addExtend(ext: ExtendEntity): void
  addParseError(error: CSSParseError): void
  addFailedFile(path: string): void
  registerRuleBySelector(selector: string, rule: RuleEntity): void
  registerLayerOrder(name: string, order: number): void

  // Query helpers
  declarationsForProperties(...properties: string[]): readonly DeclarationEntity[]

  // Post-phase index building
  buildDerivedIndexes(): void
  buildUnusedIndexes(): void

  // Lazy getters
  readonly filesWithLayers: ReadonlySet<string>
  readonly emptyRules: readonly RuleEntity[]
  readonly emptyKeyframes: readonly AtRuleEntity[]
  readonly overqualifiedSelectors: readonly SelectorEntity[]
  readonly deepNestedRules: readonly RuleEntity[]
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createCSSBuildContext(input: CSSInput): CSSBuildContext {
  const options = input.options ?? {}
  const tailwind = input.tailwind ?? null
  const interner = createCSSInterner()
  const logger = input.logger ?? noopLogger

  const files: FileEntity[] = []
  const rules: RuleEntity[] = []
  const selectors: SelectorEntity[] = []
  const declarations: DeclarationEntity[] = []
  const variables: VariableEntity[] = []
  const variableRefs: VariableReferenceEntity[] = []
  const atRules: AtRuleEntity[] = []
  const tokens: ThemeTokenEntity[] = []
  const mixins: MixinEntity[] = []
  const includes: MixinIncludeEntity[] = []
  const functions: SCSSFunctionEntity[] = []
  const functionCalls: FunctionCallEntity[] = []
  const placeholders: PlaceholderEntity[] = []
  const extendsArr: ExtendEntity[] = []

  const filesByPath = new Map<string, FileEntity>()
  const variablesByName = new Map<string, VariableEntity[]>()
  const rulesBySelector = new Map<string, RuleEntity[]>()
  const _selectorDedupIndex = new Map<string, RuleEntity[]>()
  const mixinsByName = new Map<string, MixinEntity>()
  const functionsByName = new Map<string, SCSSFunctionEntity>()
  const placeholdersByName = new Map<string, PlaceholderEntity>()
  const layerOrder = new Map<string, number>()
  const declarationsByProperty = new Map<string, DeclarationEntity[]>()
  const atRulesByName = new Map<string, AtRuleEntity[]>()
  const atRulesByKind = new Map<AtRuleKind, AtRuleEntity[]>()
  const atRulesByNode = new Map<AtRule, AtRuleEntity>()
  const rulesByNode = new Map<Rule, RuleEntity>()
  const duplicateSelectors = new Map<string, { selector: string; rules: RuleEntity[] }>()
  const tokensByCategory = new Map<TokenCategory, ThemeTokenEntity[]>()

  const importantDeclarations: DeclarationEntity[] = []
  const globalVariables: VariableEntity[] = []
  const unusedVariables: VariableEntity[] = []
  const scssVariables: VariableEntity[] = []
  const cssCustomProperties: VariableEntity[] = []
  const unresolvedRefs: VariableReferenceEntity[] = []
  const mediaQueries: AtRuleEntity[] = []
  const keyframesArr: AtRuleEntity[] = []
  const layersArr: AtRuleEntity[] = []
  const fontFaces: AtRuleEntity[] = []
  const supportsRules: AtRuleEntity[] = []
  const unusedKeyframes: AtRuleEntity[] = []
  const unusedMixins: MixinEntity[] = []
  const unresolvedMixinIncludes: MixinIncludeEntity[] = []
  const unusedFunctions: SCSSFunctionEntity[] = []
  const unusedPlaceholders: PlaceholderEntity[] = []
  const unresolvedExtends: ExtendEntity[] = []
  const parseErrors: CSSParseError[] = []
  const failedFilePaths: string[] = []
  const tokenCategories: TokenCategory[] = []

  const selectorsByPseudoClass = new Map<string, SelectorEntity[]>()
  const idSelectors: SelectorEntity[] = []
  const attributeSelectors: SelectorEntity[] = []
  const universalSelectors: SelectorEntity[] = []
  const classNameIndex = new Map<string, SelectorEntity[]>()
  const selectorsBySubjectTag = new Map<string, SelectorEntity[]>()
  const selectorsWithoutSubjectTag: SelectorEntity[] = []
  const selectorsTargetingCheckbox: SelectorEntity[] = []
  const selectorsTargetingTableCell: SelectorEntity[] = []

  const knownKeyframeNames = new Set<string>()
  const unresolvedAnimationRefs: UnresolvedAnimationRef[] = []
  const declaredContainerNames = new Map<string, DeclarationEntity[]>()
  const containerQueryNames = new Map<string, AtRuleEntity[]>()
  const unusedContainerNames = new Map<string, DeclarationEntity[]>()
  const unknownContainerQueries: AtRuleEntity[] = []
  const multiDeclarationProperties = new Map<string, readonly DeclarationEntity[]>()
  const keyframeDeclarations: DeclarationEntity[] = []
  const layoutPropertiesByClassToken = new Map<string, readonly string[]>()
  const keyframeLayoutMutationsByName = new Map<string, readonly KeyframeLayoutMutation[]>()
  const fontFaceDescriptorsByFamily = new Map<string, readonly FontFaceDescriptor[]>()
  const usedFontFamiliesByRule = new Map<number, readonly string[]>()
  const usedFontFamilies = new Set<string>()

  let _filesWithLayers: Set<string> | null = null
  let _emptyRules: RuleEntity[] | null = null
  let _emptyKeyframes: AtRuleEntity[] | null = null
  let _overqualifiedSelectors: SelectorEntity[] | null = null
  let _deepNestedRules: RuleEntity[] | null = null

  function declarationsForPropertiesImpl(...properties: string[]): readonly DeclarationEntity[] {
    if (properties.length === 1) {
      const prop = properties[0]
      if (!prop) return []
      return declarationsByProperty.get(prop) ?? []
    }
    const out: DeclarationEntity[] = []
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i]
      if (!prop) continue
      const list = declarationsByProperty.get(prop)
      if (list) for (let j = 0; j < list.length; j++) { const item = list[j]; if (item) out.push(item) }
    }
    return out
  }

  const ctx: CSSBuildContext = {
    options, interner, logger, tailwind,
    sourceOrder: 0,
    hasScssFiles: false,

    files, rules, selectors, declarations, variables, variableRefs,
    atRules, tokens, mixins, includes, functions, functionCalls,
    placeholders, extends: extendsArr,

    filesByPath, variablesByName, rulesBySelector, _selectorDedupIndex,
    mixinsByName, functionsByName, placeholdersByName, layerOrder,
    declarationsByProperty, atRulesByName, atRulesByKind, atRulesByNode,
    rulesByNode, duplicateSelectors, tokensByCategory,

    importantDeclarations, globalVariables, unusedVariables, scssVariables,
    cssCustomProperties, unresolvedRefs, mediaQueries, keyframes: keyframesArr,
    layers: layersArr, fontFaces, supportsRules, unusedKeyframes,
    unusedMixins, unresolvedMixinIncludes, unusedFunctions, unusedPlaceholders,
    unresolvedExtends, parseErrors, failedFilePaths, tokenCategories,

    selectorsByPseudoClass, idSelectors, attributeSelectors, universalSelectors,
    classNameIndex, selectorsBySubjectTag, selectorsWithoutSubjectTag,
    selectorsTargetingCheckbox, selectorsTargetingTableCell,

    knownKeyframeNames, unresolvedAnimationRefs, declaredContainerNames,
    containerQueryNames, unusedContainerNames, unknownContainerQueries,
    multiDeclarationProperties, keyframeDeclarations,
    layoutPropertiesByClassToken, keyframeLayoutMutationsByName,
    fontFaceDescriptorsByFamily, usedFontFamiliesByRule, usedFontFamilies,

    nextFileId() { return files.length },
    nextRuleId() { return rules.length },
    nextSelectorId() { return selectors.length },
    nextDeclarationId() { return declarations.length },
    nextVariableId() { return variables.length },
    nextVariableRefId() { return variableRefs.length },
    nextAtRuleId() { return atRules.length },
    nextTokenId() { return tokens.length },
    nextMixinId() { return mixins.length },
    nextIncludeId() { return includes.length },
    nextFunctionId() { return functions.length },
    nextFunctionCallId() { return functionCalls.length },
    nextPlaceholderId() { return placeholders.length },
    nextExtendId() { return extendsArr.length },
    nextSourceOrder() { return ctx.sourceOrder++ },

    intern(s: string) { return interner.intern(s) },

    addFile(file) { files.push(file); filesByPath.set(file.path, file) },

    addRule(rule) { rules.push(rule); rulesByNode.set(rule.node, rule) },

    addSelector(selector) {
      selectors.push(selector)
      const anchor = selector.anchor
      if (anchor.subjectTag === null) selectorsWithoutSubjectTag.push(selector)
      else { const ex = selectorsBySubjectTag.get(anchor.subjectTag); if (ex) ex.push(selector); else selectorsBySubjectTag.set(anchor.subjectTag, [selector]) }
      if (anchor.targetsCheckbox) selectorsTargetingCheckbox.push(selector)
      if (anchor.targetsTableCell) selectorsTargetingTableCell.push(selector)
      const compounds = selector.compounds
      for (let ci = 0; ci < compounds.length; ci++) {
        const compound = compounds[ci]; if (!compound) continue
        const cls = compound.classes
        for (let j = 0; j < cls.length; j++) { const cn = cls[j]; if (!cn) continue; const ex = classNameIndex.get(cn); if (ex) ex.push(selector); else classNameIndex.set(cn, [selector]) }
      }
      const flags = selector.complexity._flags
      if (hasFlag(flags, SEL_HAS_ID)) idSelectors.push(selector)
      if (hasFlag(flags, SEL_HAS_ATTRIBUTE)) attributeSelectors.push(selector)
      if (hasFlag(flags, SEL_HAS_UNIVERSAL)) universalSelectors.push(selector)
      const pseudoClasses = selector.complexity.pseudoClasses
      for (let j = 0; j < pseudoClasses.length; j++) { const pc = pseudoClasses[j]; if (!pc) continue; const ex = selectorsByPseudoClass.get(pc); if (ex) ex.push(selector); else selectorsByPseudoClass.set(pc, [selector]) }
    },

    addDeclaration(decl) {
      declarations.push(decl)
      const property = decl.property
      const ex = declarationsByProperty.get(property); if (ex) ex.push(decl); else declarationsByProperty.set(property, [decl])
      if (hasFlag(decl._flags, DECL_IS_IMPORTANT) || decl.node.important) importantDeclarations.push(decl)
      if (decl.rule !== null) {
        const p = property.toLowerCase()
        const ruleIndex = decl.rule.declarationIndex
        const rEx = ruleIndex.get(p); if (rEx) rEx.push(decl); else ruleIndex.set(p, [decl])
      }
    },

    addVariable(variable) {
      variables.push(variable)
      const ex = variablesByName.get(variable.name); if (ex) ex.push(variable); else variablesByName.set(variable.name, [variable])
      if (hasFlag(variable._flags, VAR_IS_GLOBAL)) globalVariables.push(variable)
      if (hasFlag(variable._flags, VAR_IS_SCSS)) scssVariables.push(variable)
      else cssCustomProperties.push(variable)
    },

    addVariableRef(ref) { variableRefs.push(ref); if (!hasFlag(ref._flags, REF_IS_RESOLVED)) unresolvedRefs.push(ref) },

    addAtRule(atRule) {
      atRules.push(atRule); atRulesByNode.set(atRule.node, atRule)
      const bn = atRulesByName.get(atRule.name); if (bn) bn.push(atRule); else atRulesByName.set(atRule.name, [atRule])
      const bk = atRulesByKind.get(atRule.kind); if (bk) bk.push(atRule); else atRulesByKind.set(atRule.kind, [atRule])
      switch (atRule.kind) {
        case "media": mediaQueries.push(atRule); break
        case "keyframes": keyframesArr.push(atRule); break
        case "layer": layersArr.push(atRule); break
        case "font-face": fontFaces.push(atRule); break
        case "supports": supportsRules.push(atRule); break
      }
    },

    addToken(token) {
      tokens.push(token)
      const ex = tokensByCategory.get(token.category)
      if (ex) ex.push(token)
      else { tokensByCategory.set(token.category, [token]); tokenCategories.push(token.category) }
    },

    addMixin(mixin) { mixins.push(mixin); mixinsByName.set(mixin.name, mixin) },
    addMixinInclude(include) { includes.push(include); if (!hasFlag(include._flags, INCLUDE_IS_RESOLVED)) unresolvedMixinIncludes.push(include) },
    addFunction(fn) { functions.push(fn); functionsByName.set(fn.name, fn) },
    addFunctionCall(call) { functionCalls.push(call) },
    addPlaceholder(placeholder) { placeholders.push(placeholder); placeholdersByName.set(placeholder.name, placeholder) },
    addExtend(ext) { extendsArr.push(ext); if (!hasFlag(ext._flags, EXTEND_IS_RESOLVED)) unresolvedExtends.push(ext) },
    addParseError(error) { parseErrors.push(error) },
    addFailedFile(path) { failedFilePaths.push(path) },

    registerRuleBySelector(selector, rule) {
      for (let p = rule.parent; p !== null; p = p.kind === "rule" ? p.parent : null) { if (p.kind === "keyframes") return }
      const ex = rulesBySelector.get(selector); if (ex) ex.push(rule); else rulesBySelector.set(selector, [rule])
      const dedupKey = buildDedupKey(rule, selector)
      const dex = _selectorDedupIndex.get(dedupKey)
      if (dex) {
        dex.push(rule)
        const dups = duplicateSelectors.get(selector)
        if (dups) dups.rules.push(rule)
        else { const first = dex[0]; if (first) duplicateSelectors.set(selector, { selector, rules: [first, rule] }) }
      } else { _selectorDedupIndex.set(dedupKey, [rule]) }
    },

    registerLayerOrder(name, order) { layerOrder.set(name, order) },
    declarationsForProperties: declarationsForPropertiesImpl,

    buildDerivedIndexes() {
      buildContainingMediaStacks(rules)
      buildKeyframeIndexes(keyframesArr, declarations, declarationsForPropertiesImpl, knownKeyframeNames, unresolvedAnimationRefs, keyframeDeclarations, keyframeLayoutMutationsByName)
      buildContainerNameIndexes(declarations, atRules, declaredContainerNames, containerQueryNames, unusedContainerNames, unknownContainerQueries)
      buildMultiDeclarationProperties(declarationsByProperty, multiDeclarationProperties)
      buildLayoutPropertiesByClassTokenFn(selectors, layoutPropertiesByClassToken)
      buildFontIndexes(declarationsForPropertiesImpl, fontFaces, usedFontFamilies, usedFontFamiliesByRule, fontFaceDescriptorsByFamily)
    },

    buildUnusedIndexes() {
      for (const v of variables) { if (!hasFlag(v._flags, VAR_IS_USED)) unusedVariables.push(v) }
      for (const m of mixins) { if (!hasFlag(m._flags, MIXIN_IS_USED)) unusedMixins.push(m) }
      for (const f of functions) { if (!hasFlag(f._flags, SCSSFN_IS_USED)) unusedFunctions.push(f) }
      for (const p of placeholders) { if (!hasFlag(p._flags, PLACEHOLDER_IS_USED)) unusedPlaceholders.push(p) }
    },

    get filesWithLayers(): ReadonlySet<string> {
      if (_filesWithLayers === null) {
        const result = new Set<string>()
        for (let i = 0; i < layersArr.length; i++) { const l = layersArr[i]; if (l) result.add(l.file.path) }
        _filesWithLayers = result
      }
      return _filesWithLayers
    },

    get emptyRules(): readonly RuleEntity[] {
      if (_emptyRules === null) _emptyRules = rules.filter(r => r.declarations.length === 0 && r.nestedRules.length === 0 && r.nestedAtRules.length === 0)
      return _emptyRules
    },

    get emptyKeyframes(): readonly AtRuleEntity[] {
      if (_emptyKeyframes === null) {
        const result: AtRuleEntity[] = []
        for (let i = 0; i < keyframesArr.length; i++) {
          const kf = keyframesArr[i]; if (!kf || !kf.parsedParams.animationName) continue
          if (kf.rules.length === 0) { result.push(kf); continue }
          let hasDecl = false
          for (let j = 0; j < kf.rules.length; j++) { const r = kf.rules[j]; if (r && r.declarations.length > 0) { hasDecl = true; break } }
          if (!hasDecl) result.push(kf)
        }
        _emptyKeyframes = result
      }
      return _emptyKeyframes
    },

    get overqualifiedSelectors(): readonly SelectorEntity[] {
      if (_overqualifiedSelectors === null) {
        const result: SelectorEntity[] = []
        for (let i = 0; i < idSelectors.length; i++) {
          const sel = idSelectors[i]; if (!sel) continue
          const compounds = sel.compounds; if (compounds.length === 0) continue
          const subject = compounds[compounds.length - 1]; if (!subject) continue
          if (subject.idValue !== null && (subject.tagName !== null || subject.classes.length > 0 || subject.attributes.length > 0)) result.push(sel)
        }
        _overqualifiedSelectors = result
      }
      return _overqualifiedSelectors
    },

    get deepNestedRules(): readonly RuleEntity[] {
      if (_deepNestedRules === null) _deepNestedRules = rules.filter(r => r.depth > 3)
      return _deepNestedRules
    },
  }

  return ctx
}


// ── Helpers ───────────────────────────────────────────────────────────────

function buildDedupKey(rule: RuleEntity, selector: string): string {
  let ancestry = ""
  let current: RuleEntity["parent"] = rule.parent
  while (current !== null) {
    if (current.kind === "rule") { ancestry = current.selectorText + "\0" + ancestry; current = current.parent }
    else { ancestry = `@${current.name} ${current.params}\0` + ancestry; current = current.parent }
  }
  return `${rule.file.path}\0${ancestry}${selector}`
}

function buildContainingMediaStacks(rules: RuleEntity[]): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]; if (!rule) continue
    const medias: AtRuleEntity[] = []
    let current: RuleEntity["parent"] = rule.parent
    while (current) { if (current.kind === "media") medias.push(current); current = current.parent }
    rule.containingMediaStack = medias
  }
}

function buildKeyframeIndexes(
  keyframes: AtRuleEntity[], declarations: DeclarationEntity[],
  declarationsForProperties: (...p: string[]) => readonly DeclarationEntity[],
  knownKeyframeNames: Set<string>, unresolvedAnimationRefs: UnresolvedAnimationRef[],
  keyframeDeclarations: DeclarationEntity[], keyframeLayoutMutationsByName: Map<string, readonly KeyframeLayoutMutation[]>,
): void {
  const IGNORED = new Set([...CSS_WIDE_KEYWORDS, "none"])
  for (let i = 0; i < keyframes.length; i++) { const kf = keyframes[i]; if (!kf) continue; const name = kf.parsedParams.animationName; if (name) knownKeyframeNames.add(name) }
  const animDecls = declarationsForProperties("animation", "animation-name")
  for (let i = 0; i < animDecls.length; i++) {
    const d = animDecls[i]; if (!d) continue
    const names = extractKeyframeNames(d.value, d.property.toLowerCase())
    for (let j = 0; j < names.length; j++) { const name = names[j]; if (!name || IGNORED.has(name) || name.includes("(") || knownKeyframeNames.has(name)) continue; unresolvedAnimationRefs.push({ declaration: d, name }) }
  }
  const byAnimByProp = new Map<string, Map<string, { values: Set<string>; declarations: DeclarationEntity[] }>>()
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]; if (!d) continue; const rule = d.rule; if (!rule) continue; const parent = rule.parent; if (!parent || parent.kind === "rule" || parent.kind !== "keyframes") continue
    keyframeDeclarations.push(d)
    const property = d.property.toLowerCase(); if (!LAYOUT_ANIMATION_MUTATION_PROPERTIES.has(property)) continue
    const animationName = normalizeAnimationName(parent.params); if (!animationName) continue
    let byProp = byAnimByProp.get(animationName); if (!byProp) { byProp = new Map(); byAnimByProp.set(animationName, byProp) }
    let bucket = byProp.get(property); if (!bucket) { bucket = { values: new Set(), declarations: [] }; byProp.set(property, bucket) }
    bucket.values.add(d.value.trim().toLowerCase()); bucket.declarations.push(d)
  }
  for (const [animationName, byProp] of byAnimByProp) {
    const mutations: KeyframeLayoutMutation[] = []
    for (const [property, bucket] of byProp) { if (bucket.values.size <= 1) continue; mutations.push({ property, values: [...bucket.values], declarations: bucket.declarations }) }
    if (mutations.length > 0) keyframeLayoutMutationsByName.set(animationName, mutations)
  }
}

function buildContainerNameIndexes(
  declarations: DeclarationEntity[], atRules: AtRuleEntity[],
  declaredContainerNames: Map<string, DeclarationEntity[]>, containerQueryNames: Map<string, AtRuleEntity[]>,
  unusedContainerNames: Map<string, DeclarationEntity[]>, unknownContainerQueries: AtRuleEntity[],
): void {
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]; if (!d) continue; const p = d.property.toLowerCase()
    let names: readonly string[] | null = null
    if (p === "container-name") names = parseContainerNames(d.value)
    else if (p === "container") names = parseContainerNamesFromShorthand(d.value)
    if (!names) continue
    for (let j = 0; j < names.length; j++) { const name = names[j]; if (!name) continue; const ex = declaredContainerNames.get(name); if (ex) ex.push(d); else declaredContainerNames.set(name, [d]) }
  }
  for (let i = 0; i < atRules.length; i++) {
    const at = atRules[i]; if (!at || at.kind !== "container") continue
    const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params); if (!name) continue
    const ex = containerQueryNames.get(name); if (ex) ex.push(at); else containerQueryNames.set(name, [at])
  }
  for (const [name, decls] of declaredContainerNames) { if (!containerQueryNames.has(name)) unusedContainerNames.set(name, decls) }
  for (const [name, ats] of containerQueryNames) { if (!declaredContainerNames.has(name)) for (let i = 0; i < ats.length; i++) { const at = ats[i]; if (at) unknownContainerQueries.push(at) } }
}

function buildMultiDeclarationProperties(
  declarationsByProperty: Map<string, DeclarationEntity[]>,
  multiDeclarationProperties: Map<string, readonly DeclarationEntity[]>,
): void {
  for (const [property, decls] of declarationsByProperty) {
    decls.sort((a, b) => a.sourceOrder - b.sourceOrder)
    if (decls.length >= 2) multiDeclarationProperties.set(property, decls)
  }
}

function buildLayoutPropertiesByClassTokenFn(selectors: SelectorEntity[], layoutPropertiesByClassToken: Map<string, readonly string[]>): void {
  const byClass = new Map<string, Set<string>>()
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]; if (!selector || selector.anchor.classes.length === 0) continue
    const properties = new Set<string>()
    for (let j = 0; j < selector.rule.declarations.length; j++) { const decl = selector.rule.declarations[j]; if (!decl) continue; const p = decl.property.toLowerCase(); if (LAYOUT_CLASS_GEOMETRY_PROPERTIES.has(p)) properties.add(p) }
    if (properties.size === 0) continue
    for (let j = 0; j < selector.anchor.classes.length; j++) {
      const cn = selector.anchor.classes[j]; if (!cn) continue
      let ex = byClass.get(cn); if (!ex) { ex = new Set(); byClass.set(cn, ex) }
      for (const p of properties) ex.add(p)
    }
  }
  for (const [cn, props] of byClass) layoutPropertiesByClassToken.set(cn, [...props])
}

function buildFontIndexes(
  declarationsForProperties: (...p: string[]) => readonly DeclarationEntity[],
  fontFaces: AtRuleEntity[],
  usedFontFamilies: Set<string>, usedFontFamiliesByRule: Map<number, readonly string[]>,
  fontFaceDescriptorsByFamily: Map<string, readonly FontFaceDescriptor[]>,
): void {
  const decls = declarationsForProperties("font-family")
  for (let i = 0; i < decls.length; i++) {
    const d = decls[i]; if (!d) continue; const rule = d.rule; if (!rule) continue
    const families = parseFontFamilyList(d.value); if (families.length === 0) continue
    for (let j = 0; j < families.length; j++) { const f = families[j]; if (f) usedFontFamilies.add(f) }
    const ex = usedFontFamiliesByRule.get(rule.id)
    if (!ex) { usedFontFamiliesByRule.set(rule.id, families); continue }
    const merged = new Set(ex); for (let j = 0; j < families.length; j++) { const f = families[j]; if (f) merged.add(f) }
    usedFontFamiliesByRule.set(rule.id, [...merged])
  }
  const byFamily = new Map<string, FontFaceDescriptor[]>()
  for (let i = 0; i < fontFaces.length; i++) {
    const ff = fontFaces[i]; if (!ff) continue
    const familyDecl = firstDeclaration(ff.declarations, "font-family"); if (!familyDecl) continue
    const family = normalizeFontFamily(familyDecl.value); if (!family) continue
    const displayDecl = firstDeclaration(ff.declarations, "font-display")
    const srcDecl = firstDeclaration(ff.declarations, "src")
    const descriptor: FontFaceDescriptor = {
      fontFace: ff, family, displayDeclaration: displayDecl, srcDeclaration: srcDecl,
      display: displayDecl ? firstToken(displayDecl.value) : null,
      src: srcDecl ? srcDecl.value : null,
      hasWebFontSource: srcDecl ? srcDecl.value.toLowerCase().includes("url(") : false,
      hasEffectiveMetricOverrides: hasEffectiveMetricOverrides(ff.declarations),
    }
    const ex = byFamily.get(family); if (ex) ex.push(descriptor); else byFamily.set(family, [descriptor])
  }
  for (const [family, descs] of byFamily) fontFaceDescriptorsByFamily.set(family, descs)
}

function firstDeclaration<T extends { readonly property: string }>(declarations: readonly T[], property: string): T | null {
  const needle = property.toLowerCase()
  for (let i = 0; i < declarations.length; i++) { const d = declarations[i]; if (d && d.property.toLowerCase() === needle) return d }
  return null
}

function parseFontFamilyList(value: string): readonly string[] {
  const out: string[] = []
  const tokens = splitComma(value)
  for (let i = 0; i < tokens.length; i++) { const t = tokens[i]; if (!t) continue; const f = normalizeFontFamily(t); if (f) out.push(f) }
  return out
}

const FONT_GENERIC_FAMILY_SET = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"])

function normalizeFontFamily(raw: string): string | null {
  const trimmed = raw.trim(); if (trimmed.length === 0) return null
  const unquoted = stripQuotes(trimmed); if (unquoted.length === 0) return null
  const normalized = unquoted.toLowerCase().replace(/\s+/g, " ").trim(); if (normalized.length === 0) return null
  if (FONT_GENERIC_FAMILY_SET.has(normalized)) return null
  return normalized
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]; const last = value[value.length - 1]
  if (first !== last) return value
  if (first !== "\"" && first !== "'") return value
  return value.slice(1, -1).trim()
}

function firstToken(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return ""
  return normalized.split(/\s+/)[0] ?? ""
}

function hasEffectiveMetricOverrides(declarations: readonly { readonly property: string; readonly value: string }[]): boolean {
  const sizeAdjust = firstDeclaration(declarations, "size-adjust")
  if (sizeAdjust && isEffectiveFontMetricValue(sizeAdjust.value)) return true
  const a = firstDeclaration(declarations, "ascent-override")
  const d = firstDeclaration(declarations, "descent-override")
  const l = firstDeclaration(declarations, "line-gap-override")
  if (!a || !d || !l) return false
  return isEffectiveFontMetricValue(a.value) && isEffectiveFontMetricValue(d.value) && isEffectiveFontMetricValue(l.value)
}

function isEffectiveFontMetricValue(value: string): boolean {
  const n = value.trim().toLowerCase()
  if (n.length === 0) return false
  if (n === "normal") return false
  if (CSS_WIDE_KEYWORDS.has(n)) return false
  return true
}
