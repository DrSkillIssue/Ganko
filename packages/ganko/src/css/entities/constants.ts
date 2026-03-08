/**
 * CSS Entity Constants
 */

import type { Specificity, SpecificityObject } from "./specificity";
import type { SelectorComplexity, CombinatorType, SelectorPart } from "./selector";
import type { ParsedValue, ValueNode, CascadePosition } from "./value";
import type { ParsedAtRuleParams, MediaCondition, MediaFeature } from "./at-rule";
import type { VariableScope } from "./variable";
import type { MixinParameter, MixinArgument, FunctionParameter, ReturnStatement } from "./scss";
import type { ThemeTokenVariant } from "./token";
import type { RuleEntity } from "./rule";
import type { SelectorEntity } from "./selector";
import type { DeclarationEntity } from "./declaration";
import type { VariableEntity, VariableReferenceEntity } from "./variable";
import type { AtRuleEntity } from "./at-rule";
import type { ThemeTokenEntity } from "./token";
import type { MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity, PlaceholderEntity, ExtendEntity } from "./scss";
import type { ImportInfo, FileEntity } from "./file";
import type { CSSParseError } from "./parse-error";
import type { VarReference, FunctionCallInfo } from "../parser/value";

export const EMPTY_RULES: RuleEntity[] = [];
export const EMPTY_SELECTORS: SelectorEntity[] = [];
export const EMPTY_DECLARATIONS: DeclarationEntity[] = [];
export const EMPTY_VARIABLES: VariableEntity[] = [];
export const EMPTY_VARIABLE_REFS: VariableReferenceEntity[] = [];
export const EMPTY_AT_RULES: AtRuleEntity[] = [];
export const EMPTY_TOKENS: ThemeTokenEntity[] = [];
export const EMPTY_MIXINS: MixinEntity[] = [];
export const EMPTY_INCLUDES: MixinIncludeEntity[] = [];
export const EMPTY_FUNCTIONS: SCSSFunctionEntity[] = [];
export const EMPTY_FUNCTION_CALLS: FunctionCallEntity[] = [];
export const EMPTY_PLACEHOLDERS: PlaceholderEntity[] = [];
export const EMPTY_EXTENDS: ExtendEntity[] = [];
export const EMPTY_IMPORTS: ImportInfo[] = [];
export const EMPTY_FILES: FileEntity[] = [];
export const EMPTY_SELECTOR_PARTS: SelectorPart[] = [];
export const EMPTY_VALUE_NODES: ValueNode[] = [];
export const EMPTY_FUNCTION_CALL_INFOS: FunctionCallInfo[] = [];
export const EMPTY_VAR_REFS: VarReference[] = [];
export const EMPTY_MEDIA_CONDITIONS: MediaCondition[] = [];
export const EMPTY_MEDIA_FEATURES: MediaFeature[] = [];
export const EMPTY_MIXIN_PARAMETERS: MixinParameter[] = [];
export const EMPTY_MIXIN_ARGUMENTS: MixinArgument[] = [];
export const EMPTY_FUNCTION_PARAMETERS: FunctionParameter[] = [];
export const EMPTY_RETURN_STATEMENTS: ReturnStatement[] = [];
export const EMPTY_THEME_TOKEN_VARIANTS: ThemeTokenVariant[] = [];
export const EMPTY_STRINGS: string[] = [];
export const EMPTY_COMBINATORS: CombinatorType[] = [];
export const EMPTY_PARSE_ERRORS: readonly CSSParseError[] = [];

export const ZERO_SPECIFICITY: Specificity = [0, 0, 0, 0];

export const ZERO_SPECIFICITY_OBJECT: SpecificityObject = {
  inline: 0,
  ids: 0,
  classes: 0,
  elements: 0,
};

export const MINIMAL_COMPLEXITY: SelectorComplexity = {
  depth: 0,
  breadth: 1,
  _flags: 0,
  pseudoClasses: EMPTY_STRINGS,
  pseudoElements: EMPTY_STRINGS,
  combinators: EMPTY_COMBINATORS,
};

export const EMPTY_PARSED_VALUE: ParsedValue = {
  nodes: EMPTY_VALUE_NODES,
  hasCalc: false,
  hasVar: false,
  hasUrl: false,
  hasFunction: false,
  colors: EMPTY_STRINGS,
  units: EMPTY_STRINGS,
};

export const GLOBAL_SCOPE: VariableScope = {
  type: "global",
  condition: null,
  specificity: null,
};

export const EMPTY_PARSED_AT_RULE_PARAMS: ParsedAtRuleParams = {
  raw: "",
};

export const DEFAULT_CASCADE_POSITION: CascadePosition = {
  layer: null,
  layerOrder: 0,
  sourceOrder: 0,
  specificity: ZERO_SPECIFICITY,
  specificityScore: 0,
  isImportant: false,
};
