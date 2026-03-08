/**
 * SCSS-Specific Types
 */

import type { AtRule, Rule } from "postcss";
import type { FileEntity } from "./file";
import type { RuleEntity } from "./rule";
import type { DeclarationEntity } from "./declaration";
import type { AtRuleEntity } from "./at-rule";

/**
 * Mixin parameter definition.
 */
export interface MixinParameter {
  name: string;
  defaultValue: string | null;
  isRest: boolean;
}

/**
 * Mixin argument in @include.
 */
export interface MixinArgument {
  name: string | null;
  value: string;
  isNamed: boolean;
}

/**
 * Function parameter definition.
 */
export interface FunctionParameter {
  name: string;
  defaultValue: string | null;
}

/**
 * @return statement in SCSS function.
 */
export interface ReturnStatement {
  node: AtRule;
  value: string;
}

/**
 * Represents an SCSS mixin definition.
 */
export interface MixinEntity {
  id: number;
  name: string;
  node: AtRule;
  file: FileEntity;
  parameters: MixinParameter[];
  _flags: number;
  declarations: DeclarationEntity[];
  rules: RuleEntity[];
  includes: MixinIncludeEntity[];
  startLine: number;
  endLine: number;
}

/**
 * Represents an SCSS @include directive.
 */
export interface MixinIncludeEntity {
  id: number;
  name: string;
  node: AtRule;
  file: FileEntity;
  arguments: MixinArgument[];
  _flags: number;
  resolvedMixin: MixinEntity | null;
  rule: RuleEntity | null;
  atRule: AtRuleEntity | null;
}

/**
 * Represents an SCSS function definition.
 */
export interface SCSSFunctionEntity {
  id: number;
  name: string;
  node: AtRule;
  file: FileEntity;
  parameters: FunctionParameter[];
  returnStatements: ReturnStatement[];
  calls: FunctionCallEntity[];
  _flags: number;
  startLine: number;
  endLine: number;
}

/**
 * Represents an SCSS function call within a value.
 */
export interface FunctionCallEntity {
  id: number;
  name: string;
  declaration: DeclarationEntity;
  file: FileEntity;
  arguments: string[];
  resolvedFunction: SCSSFunctionEntity | null;
  _flags: number;
  sourceIndex: number;
}

/**
 * Represents an SCSS placeholder selector (%placeholder).
 */
export interface PlaceholderEntity {
  id: number;
  name: string;
  node: Rule;
  file: FileEntity;
  declarations: DeclarationEntity[];
  extends: ExtendEntity[];
  _flags: number;
  startLine: number;
  endLine: number;
}

/**
 * Represents an SCSS @extend directive.
 */
export interface ExtendEntity {
  id: number;
  selector: string;
  node: AtRule;
  file: FileEntity;
  rule: RuleEntity;
  resolvedPlaceholder: PlaceholderEntity | null;
  resolvedRule: RuleEntity | null;
  _flags: number;
}
