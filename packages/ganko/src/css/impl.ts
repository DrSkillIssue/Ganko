/**
 * CSS analysis entry point.
 */
import type { Rule, AtRule } from "postcss"
import type { CSSInput, CSSFile } from "./input"
import type { CSSBuildContext } from "./build-context"
import { createCSSBuildContext } from "./build-context"
import type { CSSWorkspaceView } from "./workspace-view"
import type { CSSSyntaxTree } from "../compilation/core/css-syntax-tree"
import { runPhases } from "./phases"
import { generateExternalPropertiesCSS } from "./library-analysis"
import type {
  FileEntity, RuleEntity, SelectorEntity, DeclarationEntity,
  VariableEntity, VariableReferenceEntity, AtRuleEntity, ThemeTokenEntity,
  MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity,
  PlaceholderEntity, ExtendEntity, CSSParseError, AtRuleKind, SelectorPart, RuleElementKind,
} from "./entities"
import { HEADING_ELEMENTS } from "@drskillissue/ganko-shared"

export type { CSSBuildContext } from "./build-context"
export type { CSSWorkspaceView } from "./workspace-view"

// ── Exported types ────────────────────────────────────────────────────────

export interface UnresolvedAnimationRef {
  readonly declaration: DeclarationEntity
  readonly name: string
}

export interface KeyframeLayoutMutation {
  readonly property: string
  readonly values: readonly string[]
  readonly declarations: readonly DeclarationEntity[]
}

export interface FontFaceDescriptor {
  readonly fontFace: AtRuleEntity
  readonly family: string
  readonly displayDeclaration: DeclarationEntity | null
  readonly srcDeclaration: DeclarationEntity | null
  readonly display: string | null
  readonly src: string | null
  readonly hasWebFontSource: boolean
  readonly hasEffectiveMetricOverrides: boolean
}

export interface CSSBuildResult {
  readonly trees: readonly CSSSyntaxTree[]
  readonly workspace: CSSWorkspaceView
}

// ── classifyPart ──────────────────────────────────────────────────────────

const BUTTON_ELEMENTS = new Set(["button", "input[type=\"submit\"]", "input[type=\"button\"]", "input[type=\"reset\"]"])
const INPUT_ELEMENTS = new Set(["input", "select", "textarea"])
const CAPTION_ELEMENTS = new Set(["caption", "figcaption", "small"])
const PARAGRAPH_ELEMENTS = new Set(["p", "article", "section", "blockquote", "li", "dd", "dt"])
const INLINE_FORMATTING_ELEMENTS = new Set([
  "sub", "sup", "abbr", "mark", "code", "kbd", "samp", "var", "dfn",
  "cite", "q", "ruby", "bdi", "bdo", "wbr", "span", "em", "strong",
  "i", "b", "u", "s", "del", "ins", "time",
])
const BUTTON_CLASSES = /\bbtn\b|\bbutton\b|\bcta\b/i
const INPUT_CLASSES = /\b(input|field|select|form-control|text-?field)\b/i
const CAPTION_CLASSES = /\b(caption|footnote|fine-?print|disclaimer|helper|hint|sub-?text|meta)\b/i
const PARAGRAPH_CLASSES = /\b(paragraph|text-?block|prose|body-?text|content)\b/i
const BUTTON_ROLE_ATTR = /role\s*=\s*["']?button/i

export function classifyPart(part: SelectorPart, kinds: Set<RuleElementKind>): void {
  if (part.type === "element") {
    const lower = part.value.toLowerCase()
    if (HEADING_ELEMENTS.has(lower)) { kinds.add("heading"); return }
    if (BUTTON_ELEMENTS.has(lower)) { kinds.add("button"); return }
    if (INPUT_ELEMENTS.has(lower)) { kinds.add("input"); return }
    if (CAPTION_ELEMENTS.has(lower)) { kinds.add("caption"); return }
    if (PARAGRAPH_ELEMENTS.has(lower)) { kinds.add("paragraph"); return }
    if (INLINE_FORMATTING_ELEMENTS.has(lower)) { kinds.add("inline-formatting"); return }
    return
  }
  if (part.type === "pseudo-element") { kinds.add("pseudo-element"); return }
  if (part.type === "class") {
    if (BUTTON_CLASSES.test(part.value)) { kinds.add("button"); return }
    if (INPUT_CLASSES.test(part.value)) { kinds.add("input"); return }
    if (CAPTION_CLASSES.test(part.value)) { kinds.add("caption"); return }
    if (PARAGRAPH_CLASSES.test(part.value)) { kinds.add("paragraph"); return }
    return
  }
  if (part.type === "attribute" && BUTTON_ROLE_ATTR.test(part.raw)) {
    kinds.add("button")
  }
}

// ── Build functions ───────────────────────────────────────────────────────

const EXTERNAL_PROPERTIES_PATH = "<external-library-properties>"

function injectExternalPropertiesFile(input: CSSInput): CSSInput {
  const externalProps = input.externalCustomProperties
  if (!externalProps || externalProps.size === 0) return input
  const syntheticCSS = generateExternalPropertiesCSS(externalProps)
  if (syntheticCSS === null) return input
  const syntheticFile: CSSFile = { path: EXTERNAL_PROPERTIES_PATH, content: syntheticCSS }
  return { ...input, files: [syntheticFile, ...input.files] }
}

export function buildCSSResult(input: CSSInput): CSSBuildResult {
  const effectiveInput = injectExternalPropertiesFile(input)
  const ctx = createCSSBuildContext(effectiveInput)
  runPhases(ctx, effectiveInput)
  ctx.buildDerivedIndexes()
  return {
    trees: freezeToSyntaxTrees(ctx),
    workspace: freezeToWorkspaceView(ctx),
  }
}

// ── Freeze to CSSSyntaxTree[] ─────────────────────────────────────────────

function freezeToSyntaxTrees(ctx: CSSBuildContext): readonly CSSSyntaxTree[] {
  const files = ctx.files
  const trees: CSSSyntaxTree[] = []
  for (let i = 0; i < files.length; i++) {
    trees.push(buildTree(files[i]!, i, ctx))
  }
  return trees
}

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key)
  if (arr !== undefined) arr.push(value)
  else map.set(key, [value])
}

function collectSelectorsFromRules(rules: readonly RuleEntity[]): SelectorEntity[] {
  const out: SelectorEntity[] = []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    for (let j = 0; j < rule.selectors.length; j++) {
      const sel = rule.selectors[j]
      if (sel) out.push(sel)
    }
  }
  return out
}

function collectDeclarationsFromRules(rules: readonly RuleEntity[]): DeclarationEntity[] {
  const out: DeclarationEntity[] = []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    for (let j = 0; j < rule.declarations.length; j++) {
      const decl = rule.declarations[j]
      if (decl) out.push(decl)
    }
  }
  return out
}

function buildTree(file: FileEntity, fileIndex: number, ctx: CSSBuildContext): CSSSyntaxTree {
  const rules = file.rules
  const atRules = file.atRules
  const variables = file.variables
  const selectors = collectSelectorsFromRules(rules)

  const ruleDeclarations = collectDeclarationsFromRules(rules)
  const standaloneDeclarations: DeclarationEntity[] = []
  for (const d of ctx.declarations) { if (d.file === file && d.rule === null) standaloneDeclarations.push(d) }
  const declarations = standaloneDeclarations.length === 0 ? ruleDeclarations : ruleDeclarations.concat(standaloneDeclarations)

  const variableRefs: VariableReferenceEntity[] = []
  for (const vr of ctx.variableRefs) { if (vr.file === file) variableRefs.push(vr) }
  const tokens: ThemeTokenEntity[] = []
  for (const t of ctx.tokens) { if (t.file === file) tokens.push(t) }
  const mixins: MixinEntity[] = []
  for (const m of ctx.mixins) { if (m.file === file) mixins.push(m) }
  const includes: MixinIncludeEntity[] = []
  for (const inc of ctx.includes) { if (inc.file === file) includes.push(inc) }
  const functions: SCSSFunctionEntity[] = []
  for (const fn of ctx.functions) { if (fn.file === file) functions.push(fn) }
  const functionCalls: FunctionCallEntity[] = []
  for (const fc of ctx.functionCalls) { if (fc.file === file) functionCalls.push(fc) }
  const placeholders: PlaceholderEntity[] = []
  for (const ph of ctx.placeholders) { if (ph.file === file) placeholders.push(ph) }
  const extendsArr: ExtendEntity[] = []
  for (const ext of ctx.extends) { if (ext.file === file) extendsArr.push(ext) }
  const parseErrors: CSSParseError[] = []
  for (const pe of ctx.parseErrors) { if (pe.file === file.path) parseErrors.push(pe) }
  const unresolvedRefsArr: VariableReferenceEntity[] = []
  for (const ref of ctx.unresolvedRefs) { if (ref.file === file) unresolvedRefsArr.push(ref) }
  const unresolvedMixinIncludesArr: MixinIncludeEntity[] = []
  for (const inc of ctx.unresolvedMixinIncludes) { if (inc.file === file) unresolvedMixinIncludesArr.push(inc) }
  const unresolvedExtendsArr: ExtendEntity[] = []
  for (const ext of ctx.unresolvedExtends) { if (ext.file === file) unresolvedExtendsArr.push(ext) }

  const rulesBySelectorMap = new Map<string, RuleEntity[]>()
  const rulesByNodeMap = new Map<Rule, RuleEntity>()
  for (const r of rules) { pushToMapArray(rulesBySelectorMap, r.selectorText, r); rulesByNodeMap.set(r.node, r) }
  const variablesByNameMap = new Map<string, VariableEntity[]>()
  for (const v of variables) { pushToMapArray(variablesByNameMap, v.name, v) }
  const declarationsByPropertyMap = new Map<string, DeclarationEntity[]>()
  for (const d of declarations) { pushToMapArray(declarationsByPropertyMap, d.property, d) }
  const atRulesByNameMap = new Map<string, AtRuleEntity[]>()
  const atRulesByKindMap = new Map<AtRuleKind, AtRuleEntity[]>()
  const atRulesByNodeMap = new Map<AtRule, AtRuleEntity>()
  for (const ar of atRules) { pushToMapArray(atRulesByNameMap, ar.name, ar); pushToMapArray(atRulesByKindMap, ar.kind, ar); atRulesByNodeMap.set(ar.node, ar) }
  const classNameIndexMap = new Map<string, SelectorEntity[]>()
  const selectorsBySubjectTagMap = new Map<string, SelectorEntity[]>()
  const selectorsByPseudoClassMap = new Map<string, SelectorEntity[]>()
  const selectorsWithoutSubjectTagArr: SelectorEntity[] = []
  for (const sel of selectors) {
    for (const compound of sel.compounds) { for (const cls of compound.classes) { pushToMapArray(classNameIndexMap, cls, sel) } }
    if (sel.anchor.subjectTag !== null) pushToMapArray(selectorsBySubjectTagMap, sel.anchor.subjectTag, sel)
    else selectorsWithoutSubjectTagArr.push(sel)
    for (const pc of sel.complexity.pseudoClasses) { pushToMapArray(selectorsByPseudoClassMap, pc, sel) }
  }

  return {
    kind: "css", filePath: file.path, version: String(file.id),
    isScss: file.syntax === "scss" || file.syntax === "sass",
    file, rules, selectors, declarations, variables, variableRefs, atRules, tokens,
    mixins, includes, functions, functionCalls, placeholders, extends: extendsArr,
    parseErrors, unresolvedRefs: unresolvedRefsArr,
    unresolvedMixinIncludes: unresolvedMixinIncludesArr, unresolvedExtends: unresolvedExtendsArr,
    rulesBySelector: rulesBySelectorMap, rulesByNode: rulesByNodeMap,
    variablesByName: variablesByNameMap, declarationsByProperty: declarationsByPropertyMap,
    atRulesByName: atRulesByNameMap, atRulesByKind: atRulesByKindMap, atRulesByNode: atRulesByNodeMap,
    classNameIndex: classNameIndexMap, selectorsBySubjectTag: selectorsBySubjectTagMap,
    selectorsByPseudoClass: selectorsByPseudoClassMap, selectorsWithoutSubjectTag: selectorsWithoutSubjectTagArr,
    filesByPath: new Map([[file.path, file]]), sourceOrderBase: fileIndex * 10000,
  }
}

// ── Freeze to CSSWorkspaceView ────────────────────────────────────────────

function freezeToWorkspaceView(ctx: CSSBuildContext): CSSWorkspaceView {
  ctx.buildUnusedIndexes()
  return {
    options: ctx.options, interner: ctx.interner, logger: ctx.logger, tailwind: ctx.tailwind,
    hasScssFiles: ctx.hasScssFiles,
    files: ctx.files, rules: ctx.rules, selectors: ctx.selectors, declarations: ctx.declarations,
    variables: ctx.variables, variableRefs: ctx.variableRefs, atRules: ctx.atRules, tokens: ctx.tokens,
    mixins: ctx.mixins, includes: ctx.includes, functions: ctx.functions, functionCalls: ctx.functionCalls,
    placeholders: ctx.placeholders, extends: ctx.extends,
    filesByPath: ctx.filesByPath, variablesByName: ctx.variablesByName,
    rulesBySelector: ctx.rulesBySelector, mixinsByName: ctx.mixinsByName,
    functionsByName: ctx.functionsByName, placeholdersByName: ctx.placeholdersByName,
    layerOrder: ctx.layerOrder, declarationsByProperty: ctx.declarationsByProperty,
    atRulesByName: ctx.atRulesByName, atRulesByKind: ctx.atRulesByKind,
    atRulesByNode: ctx.atRulesByNode, rulesByNode: ctx.rulesByNode,
    duplicateSelectors: ctx.duplicateSelectors, tokensByCategory: ctx.tokensByCategory,
    importantDeclarations: ctx.importantDeclarations, globalVariables: ctx.globalVariables,
    unusedVariables: ctx.unusedVariables, scssVariables: ctx.scssVariables,
    cssCustomProperties: ctx.cssCustomProperties, unresolvedRefs: ctx.unresolvedRefs,
    mediaQueries: ctx.mediaQueries, keyframes: ctx.keyframes, layers: ctx.layers,
    fontFaces: ctx.fontFaces, supportsRules: ctx.supportsRules, unusedKeyframes: ctx.unusedKeyframes,
    unusedMixins: ctx.unusedMixins, unresolvedMixinIncludes: ctx.unresolvedMixinIncludes,
    unusedFunctions: ctx.unusedFunctions, unusedPlaceholders: ctx.unusedPlaceholders,
    unresolvedExtends: ctx.unresolvedExtends, parseErrors: ctx.parseErrors,
    failedFilePaths: ctx.failedFilePaths, tokenCategories: ctx.tokenCategories,
    selectorsByPseudoClass: ctx.selectorsByPseudoClass, idSelectors: ctx.idSelectors,
    attributeSelectors: ctx.attributeSelectors, universalSelectors: ctx.universalSelectors,
    classNameIndex: ctx.classNameIndex, selectorsBySubjectTag: ctx.selectorsBySubjectTag,
    selectorsWithoutSubjectTag: ctx.selectorsWithoutSubjectTag,
    selectorsTargetingCheckbox: ctx.selectorsTargetingCheckbox,
    selectorsTargetingTableCell: ctx.selectorsTargetingTableCell,
    knownKeyframeNames: ctx.knownKeyframeNames, unresolvedAnimationRefs: ctx.unresolvedAnimationRefs,
    declaredContainerNames: ctx.declaredContainerNames, containerQueryNames: ctx.containerQueryNames,
    unusedContainerNames: ctx.unusedContainerNames, unknownContainerQueries: ctx.unknownContainerQueries,
    multiDeclarationProperties: ctx.multiDeclarationProperties, keyframeDeclarations: ctx.keyframeDeclarations,
    layoutPropertiesByClassToken: ctx.layoutPropertiesByClassToken,
    keyframeLayoutMutationsByName: ctx.keyframeLayoutMutationsByName,
    fontFaceDescriptorsByFamily: ctx.fontFaceDescriptorsByFamily,
    usedFontFamiliesByRule: ctx.usedFontFamiliesByRule, usedFontFamilies: ctx.usedFontFamilies,
    filesWithLayers: ctx.filesWithLayers, emptyRules: ctx.emptyRules,
    emptyKeyframes: ctx.emptyKeyframes, overqualifiedSelectors: ctx.overqualifiedSelectors,
    deepNestedRules: ctx.deepNestedRules,
    declarationsForProperties: ctx.declarationsForProperties,
  }
}
