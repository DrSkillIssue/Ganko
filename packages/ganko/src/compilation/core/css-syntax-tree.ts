import type { Rule, AtRule } from "postcss"
import type { FileEntity } from "../../css/entities/file"
import type { RuleEntity } from "../../css/entities/rule"
import type { SelectorEntity } from "../../css/entities/selector"
import type { DeclarationEntity } from "../../css/entities/declaration"
import type { VariableEntity, VariableReferenceEntity } from "../../css/entities/variable"
import type { AtRuleEntity, AtRuleKind } from "../../css/entities/at-rule"
import type { ThemeTokenEntity } from "../../css/entities/token"
import type { MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity, PlaceholderEntity, ExtendEntity } from "../../css/entities/scss"
import type { CSSParseError } from "../../css/entities/parse-error"

export interface CSSSyntaxTree {
  readonly kind: "css"
  readonly filePath: string
  readonly version: string
  readonly isScss: boolean

  readonly file: FileEntity
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
  readonly parseErrors: readonly CSSParseError[]

  readonly unresolvedRefs: readonly VariableReferenceEntity[]
  readonly unresolvedMixinIncludes: readonly MixinIncludeEntity[]
  readonly unresolvedExtends: readonly ExtendEntity[]

  readonly rulesBySelector: ReadonlyMap<string, readonly RuleEntity[]>
  readonly rulesByNode: ReadonlyMap<Rule, RuleEntity>
  readonly variablesByName: ReadonlyMap<string, readonly VariableEntity[]>
  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationEntity[]>
  readonly atRulesByName: ReadonlyMap<string, readonly AtRuleEntity[]>
  readonly atRulesByKind: ReadonlyMap<AtRuleKind, readonly AtRuleEntity[]>
  readonly atRulesByNode: ReadonlyMap<AtRule, AtRuleEntity>
  readonly classNameIndex: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly selectorsByPseudoClass: ReadonlyMap<string, readonly SelectorEntity[]>
  readonly selectorsWithoutSubjectTag: readonly SelectorEntity[]

  readonly filesByPath: ReadonlyMap<string, FileEntity>

  readonly sourceOrderBase: number
}
