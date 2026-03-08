/**
 * Parser Utilities
 *
 * Export all parser utilities for CSS/SCSS analysis.
 */

// Specificity calculation
export {
  calculateSpecificity,
  compareSpecificity,
  formatSpecificity,
  type Specificity,
} from "./specificity";

// Selector parsing
export {
  parseSelector,
  parseSelectorList,
  parseSelectorComplete,
  normalizeSelector,
  getSelectorCombinators,
  hasPseudoClass,
  hasPseudoElement,
  hasIdSelector,
  hasUniversalSelector,
  hasAttributeSelector,
  hasNestingSelector,
  extractPseudoClasses,
  extractPseudoElements,
  type SelectorPart,
  type ParseSelectorCompleteResult,
} from "./selector";

// Value parsing
export {
  parseValueWithFunctions,
  extractVarReferences,
  type ParsedValue,
  type ParsedValueNode,
  type ParsedValueWithFunctions,
  type VarReference,
  type FunctionCallInfo,
} from "./value";

// Variable name analysis
export {
  inferTokenCategory,
  extractTokenName,
  extractTokenVariant,
  type TokenCategory,
} from "./variable-name";
