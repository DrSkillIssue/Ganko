/**
 * CSSWorkspaceView — readonly interface for CSS rules and queries.
 *
 * Replaces CSSGraph as the type received by CSS rules and query functions.
 * Contains every read-only field and query method that rules/queries access.
 */
import type { Rule, AtRule } from "postcss"
import type { CSSOptions } from "./input"
import type { TailwindValidator } from "./tailwind"
import type { Logger, StringInterner } from "@drskillissue/ganko-shared"
import type {
  FileEntity, RuleEntity, SelectorEntity, DeclarationEntity,
  VariableEntity, VariableReferenceEntity, AtRuleEntity, ThemeTokenEntity,
  MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity,
  PlaceholderEntity, ExtendEntity, TokenCategory, CSSParseError, AtRuleKind,
} from "./entities"
import type { UnresolvedAnimationRef, KeyframeLayoutMutation, FontFaceDescriptor } from "./impl"

export interface CSSWorkspaceView {
  readonly options: CSSOptions
  readonly interner: StringInterner
  readonly logger: Logger
  readonly tailwind: TailwindValidator | null

  readonly hasScssFiles: boolean

  readonly files: readonly FileEntity[]
  readonly rules: readonly RuleEntity[]
  readonly selectors: readonly SelectorEntity[]
  readonly declarations: readonly DeclarationEntity[]
  readonly variables: readonly VariableEntity[]
  readonly variableRefs: readonly VariableReferenceEntity[]
  readonly atRules: readonly AtRuleEntity[]
  readonly tokens: readonly ThemeTokenEntity[]
  readonly mixins: readonly MixinEntity[]
  readonly includes: readonly MixinIncludeEntity[]
  readonly functions: readonly SCSSFunctionEntity[]
  readonly functionCalls: readonly FunctionCallEntity[]
  readonly placeholders: readonly PlaceholderEntity[]
  readonly extends: readonly ExtendEntity[]

  readonly filesByPath: ReadonlyMap<string, FileEntity>
  readonly variablesByName: ReadonlyMap<string, readonly VariableEntity[]>
  readonly rulesBySelector: ReadonlyMap<string, readonly RuleEntity[]>
  readonly mixinsByName: ReadonlyMap<string, MixinEntity>
  readonly functionsByName: ReadonlyMap<string, SCSSFunctionEntity>
  readonly placeholdersByName: ReadonlyMap<string, PlaceholderEntity>
  readonly layerOrder: ReadonlyMap<string, number>
  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly atRulesByName: ReadonlyMap<string, readonly AtRuleEntity[]>
  readonly atRulesByKind: ReadonlyMap<AtRuleKind, readonly AtRuleEntity[]>
  readonly atRulesByNode: ReadonlyMap<AtRule, AtRuleEntity>
  readonly rulesByNode: ReadonlyMap<Rule, RuleEntity>
  readonly duplicateSelectors: ReadonlyMap<string, { readonly selector: string; readonly rules: readonly RuleEntity[] }>
  readonly tokensByCategory: ReadonlyMap<TokenCategory, readonly ThemeTokenEntity[]>

  readonly importantDeclarations: readonly DeclarationEntity[]
  readonly globalVariables: readonly VariableEntity[]
  readonly unusedVariables: readonly VariableEntity[]
  readonly scssVariables: readonly VariableEntity[]
  readonly cssCustomProperties: readonly VariableEntity[]
  readonly unresolvedRefs: readonly VariableReferenceEntity[]
  readonly mediaQueries: readonly AtRuleEntity[]
  readonly keyframes: readonly AtRuleEntity[]
  readonly layers: readonly AtRuleEntity[]
  readonly fontFaces: readonly AtRuleEntity[]
  readonly supportsRules: readonly AtRuleEntity[]
  readonly unusedKeyframes: readonly AtRuleEntity[]
  readonly unusedMixins: readonly MixinEntity[]
  readonly unresolvedMixinIncludes: readonly MixinIncludeEntity[]
  readonly unusedFunctions: readonly SCSSFunctionEntity[]
  readonly unusedPlaceholders: readonly PlaceholderEntity[]
  readonly unresolvedExtends: readonly ExtendEntity[]
  readonly parseErrors: readonly CSSParseError[]
  readonly failedFilePaths: readonly string[]
  readonly tokenCategories: readonly TokenCategory[]

  readonly selectorsByPseudoClass: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly idSelectors: readonly SelectorEntity[]
  readonly attributeSelectors: readonly SelectorEntity[]
  readonly universalSelectors: readonly SelectorEntity[]
  readonly classNameIndex: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly selectorsWithoutSubjectTag: readonly SelectorEntity[]
  readonly selectorsTargetingCheckbox: readonly SelectorEntity[]
  readonly selectorsTargetingTableCell: readonly SelectorEntity[]

  readonly knownKeyframeNames: ReadonlySet<string>
  readonly unresolvedAnimationRefs: readonly UnresolvedAnimationRef[]
  readonly declaredContainerNames: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly containerQueryNames: ReadonlyMap<string, readonly AtRuleEntity[]>
  readonly unusedContainerNames: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly unknownContainerQueries: readonly AtRuleEntity[]
  readonly multiDeclarationProperties: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly keyframeDeclarations: readonly DeclarationEntity[]
  readonly layoutPropertiesByClassToken: ReadonlyMap<string, readonly string[]>
  readonly keyframeLayoutMutationsByName: ReadonlyMap<string, readonly KeyframeLayoutMutation[]>
  readonly fontFaceDescriptorsByFamily: ReadonlyMap<string, readonly FontFaceDescriptor[]>
  readonly usedFontFamiliesByRule: ReadonlyMap<number, readonly string[]>
  readonly usedFontFamilies: ReadonlySet<string>

  readonly filesWithLayers: ReadonlySet<string>
  readonly emptyRules: readonly RuleEntity[]
  readonly emptyKeyframes: readonly AtRuleEntity[]
  readonly overqualifiedSelectors: readonly SelectorEntity[]
  readonly deepNestedRules: readonly RuleEntity[]

  declarationsForProperties(...properties: string[]): readonly DeclarationEntity[]
}
