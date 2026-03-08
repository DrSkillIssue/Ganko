/**
 * CSS At-Rule Types
 */

import type { AtRule } from "postcss";
import type { FileEntity } from "./file";
import type { RuleEntity } from "./rule";
import type { DeclarationEntity } from "./declaration";

/**
 * Discriminator for common at-rule types.
 */
export type AtRuleKind =
  | "media"
  | "keyframes"
  | "font-face"
  | "supports"
  | "import"
  | "layer"
  | "container"
  | "page"
  | "charset"
  | "namespace"
  | "mixin"
  | "function"
  | "include"
  | "extend"
  | "use"
  | "forward"
  | "other";

/**
 * Media condition for @media rules.
 */
export interface MediaCondition {
  type: "all" | "screen" | "print" | "speech";
  features: MediaFeature[];
  isNot: boolean;
}

/**
 * Media feature within a media condition.
 */
export interface MediaFeature {
  name: string;
  value: string | null;
  operator: "min" | "max" | "exact" | null;
}

/**
 * Parsed at-rule parameters.
 */
export interface ParsedAtRuleParams {
  raw: string;
  mediaConditions?: MediaCondition[];
  animationName?: string;
  fontFamily?: string;
  layerName?: string;
  layerNames?: string[];
  containerName?: string;
  containerCondition?: string;
}

/**
 * Represents a CSS at-rule (@media, @keyframes, etc.).
 */
export interface AtRuleEntity {
  id: number;
  node: AtRule;
  file: FileEntity;
  name: string;
  kind: AtRuleKind;
  params: string;
  parsedParams: ParsedAtRuleParams;
  rules: RuleEntity[];
  declarations: DeclarationEntity[];
  nestedAtRules: AtRuleEntity[];
  parent: RuleEntity | AtRuleEntity | null;
  depth: number;
  startLine: number;
  endLine: number;
  sourceOrder: number;
}
