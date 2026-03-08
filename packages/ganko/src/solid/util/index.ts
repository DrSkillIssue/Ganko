/**
 * Pure AST Utilities
 *
 * These utilities work with AST nodes directly and have no dependency on the graph.
 * They can be used independently for any AST analysis.
 */

// Function utilities
export type { FunctionNode } from "./function";
export {
  isFunctionNode,
  isFunctionExpression,
  getFunctionName,
  getParameterName,
  getFunctionVariableName,
  isIIFE,
  isCalleeRead,
  isComponentFunction,
} from "./function";

// Call expression utilities
export {
  getCallName,
  isMethodCall,
  getMethodObject,
  getMethodName,
  isMethodCallWithName,
} from "./call";

// JSX utilities
export type { JSXAttributeKind } from "./jsx";
export {
  getJSXTagName,
  getJSXMemberExpressionRootIdentifier,
  getAttributeNamespace,
  getAttributeName,
  classifyAttribute,
  getJSXAttributeName,
  getJSXAttributeValueExpression,
  isJSXElementOrFragment,
  findFunctionChildExpression,
} from "./jsx";

// Pattern detection utilities
export {
  getDeclaratorName,
  findContainingVariableDeclarator,
  isEarlyReturnPattern,
  getPropertyKeyName,
} from "./pattern-detection";

// Expression utilities
export {
  getExpressionName,
  getTypeName,
  isSimpleExpression,
  mayHaveSideEffects,
  isEmptyObjectLiteral,
  isComparisonExpression,
  isLogicalExpression,
  isNotExpression,
  isBooleanCall,
  isDoubleNegation,
  isGuardedTernary,
  isExplicitBooleanExpression,
  COMPARISON_OPERATORS,
  isInLoop,
  getEnclosingLoop,
  isInConditional,
  expressionReferencesAny,
  expressionReferencesAnyDeep,
  getContainingExpression,
  STRING_RETURNING_METHODS,
  isStringExpression,
} from "./expression";

// Static value utilities
export type { StaticValueResult } from "./static-value";
export {
  getStaticValue,
  getStringFromLiteral,
  getStaticStringValue,
  getPropsFromSpread,
  getStaticStringFromJSXValue,
} from "./static-value";

// Formatting utilities
export { truncateText, formatVariableNames } from "./format";

// String interning utilities
export { INTERNED, globalInterner } from "./string-intern";
