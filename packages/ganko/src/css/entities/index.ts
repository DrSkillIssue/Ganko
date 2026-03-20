/**
 * Graph Entities
 *
 * All entity type definitions for the CSS graph.
 * Re-exports from individual entity modules.
 */

// Specificity
export type { Specificity, SpecificityObject, SelectorInfo } from "./specificity";

// Selector
export type {
  CombinatorType,
  SelectorAttributeConstraint,
  NthPattern,
  ParsedPseudoConstraint,
  SelectorCompound,
  SelectorAnchor,
  SelectorPart,
  SelectorComplexity,
  SelectorEntity,
} from "./selector";
export { PseudoConstraintKind } from "./selector";

// At-Rule
export type {
  AtRuleKind,
  MediaCondition,
  MediaFeature,
  ParsedAtRuleParams,
  AtRuleEntity,
} from "./at-rule";

// Value
export type { ValueNode, ParsedValue, CascadePosition, FunctionCallInfo } from "./value";

// Variable
export type { VariableScope, VariableEntity, VariableReferenceEntity } from "./variable";

// Token
export type { TokenCategory, ThemeTokenVariant, ThemeTokenEntity } from "./token";

// SCSS
export type {
  MixinParameter,
  MixinArgument,
  FunctionParameter,
  ReturnStatement,
  MixinEntity,
  MixinIncludeEntity,
  SCSSFunctionEntity,
  FunctionCallEntity,
  PlaceholderEntity,
  ExtendEntity,
} from "./scss";

// File
export type { ImportInfo, FileEntity } from "./file";

// Rule
export type { RuleEntity, RuleElementKind } from "./rule";

// Declaration
export type { DeclarationEntity } from "./declaration";

// Parse Error
export type { CSSParseError } from "./parse-error";

// Flags
export {
  SEL_HAS_UNIVERSAL,
  SEL_HAS_ID,
  SEL_HAS_ATTRIBUTE,
  SEL_HAS_PSEUDO_CLASS,
  SEL_HAS_PSEUDO_ELEMENT,
  SEL_HAS_NESTING,
  VAR_IS_GLOBAL,
  VAR_IS_USED,
  VAR_HAS_FALLBACK,
  VAR_IS_SCSS,
  FILE_HAS_IMPORTS,
  FILE_HAS_VARIABLES,
  FILE_HAS_MIXINS,
  DECL_IS_IMPORTANT,
  REF_IS_RESOLVED,
  MIXIN_HAS_REST_PARAM,
  MIXIN_HAS_CONTENT_BLOCK,
  MIXIN_IS_USED,
  INCLUDE_HAS_CONTENT_BLOCK,
  INCLUDE_IS_RESOLVED,
  FCALL_IS_BUILTIN,
  FCALL_IS_RESOLVED,
  SCSSFN_IS_USED,
  PLACEHOLDER_IS_USED,
  EXTEND_IS_OPTIONAL,
  EXTEND_IS_RESOLVED,
  hasFlag,
  setFlag,
  clearFlag,
} from "./flags";

// Constants
export {
  EMPTY_RULES,
  EMPTY_SELECTORS,
  EMPTY_DECLARATIONS,
  EMPTY_VARIABLES,
  EMPTY_VARIABLE_REFS,
  EMPTY_AT_RULES,
  EMPTY_TOKENS,
  EMPTY_MIXINS,
  EMPTY_INCLUDES,
  EMPTY_FUNCTIONS,
  EMPTY_FUNCTION_CALLS,
  EMPTY_PLACEHOLDERS,
  EMPTY_EXTENDS,
  EMPTY_IMPORTS,
  EMPTY_FILES,
  EMPTY_SELECTOR_PARTS,
  EMPTY_VALUE_NODES,
  EMPTY_FUNCTION_CALL_INFOS,
  EMPTY_VAR_REFS,
  EMPTY_MEDIA_CONDITIONS,
  EMPTY_MEDIA_FEATURES,
  EMPTY_MIXIN_PARAMETERS,
  EMPTY_MIXIN_ARGUMENTS,
  EMPTY_FUNCTION_PARAMETERS,
  EMPTY_RETURN_STATEMENTS,
  EMPTY_THEME_TOKEN_VARIANTS,
  EMPTY_STRINGS,
  EMPTY_COMBINATORS,
  EMPTY_PARSE_ERRORS,
  ZERO_SPECIFICITY,
  ZERO_SPECIFICITY_OBJECT,
  MINIMAL_COMPLEXITY,
  EMPTY_PARSED_VALUE,
  GLOBAL_SCOPE,
  EMPTY_PARSED_AT_RULE_PARAMS,
  DEFAULT_CASCADE_POSITION,
} from "./constants";
