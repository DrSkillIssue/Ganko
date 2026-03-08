/**
 * CSS Declaration Entity
 */

import type { Declaration } from "postcss";
import type { VarReference, FunctionCallInfo } from "../parser/value";
import type { FileEntity } from "./file";
import type { RuleEntity } from "./rule";
import type { VariableReferenceEntity } from "./variable";
import type { ParsedValue, CascadePosition } from "./value";

/**
 * Represents a CSS declaration (property: value).
 */
export interface DeclarationEntity {
  id: number;
  node: Declaration;
  rule: RuleEntity | null;
  file: FileEntity;
  property: string;
  value: string;
  rawValue: string;
  _flags: number;
  parsedValue: ParsedValue;
  variableRefs: VariableReferenceEntity[];
  functionCalls: FunctionCallInfo[];
  parsedVarRefs: VarReference[];
  startLine: number;
  startColumn: number;
  startOffset: number;
  endOffset: number;
  sourceOrder: number;
  cascadePosition: CascadePosition;
  overrides: DeclarationEntity[];
  overriddenBy: DeclarationEntity[];
}
