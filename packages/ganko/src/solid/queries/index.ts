/**
 * Query functions for SolidGraph
 *
 * Flat re-exports of all query modules.
 * Usage: import { getScopeFor, isInReactiveContext } from 'ganko/queries'
 */

// scope
export {
  getScopeFor,
  getVariableByNameInScope,
  getEffectiveTrackingContext,
  getEnclosingComponentScope,
  isInTrackedContext,
  isInUntrackedContext,
  isInDeferredContext,
  isInReactiveContext,
  isInComponentBody,
  getAncestorScopes,
  getDescendantScopes,
  isNameVisible,
} from "./scope";

// jsx
export {
  getJSXContext,
  findJSXContext,
  getJSXAttributesByKind,
  findAncestorElement,
  findEnclosingDOMElement,
  getJSXAttributeEntity,
  getJSXAttributeValue,
  hasJSXAttribute,
  getStaticStringJSXAttributeValue,
  getStaticNumericJSXAttributeValue,
  getChildElementsByTag,
  getFirstChildElementByTag,
} from "./jsx";

// jsx-derived
export {
  classListObject,
  styleObject,
  objectKeyName,
  forEachClassAttribute,
  hasOnlyStaticClassLiterals,
  forEachClassListProperty,
  forEachStyleProperty,
  getStaticClassTokensForElement,
  getStaticClassListKeysForElement,
  getStaticStyleKeysForElement,
  type JSXAttributeEntry,
} from "./jsx-derived";

// type
export {
  hasTypeInfo,
  getTypeInfo,
  isAccessorType,
  isSignalType,
  isStoreType,
  getObjectProperties,
  typeHasFlag,
  typeIncludesNumber,
  typeIncludesString,
  isPossiblyFalsy,
  typeIncludesUndefined,
  typeIncludesNull,
  typeIsObject,
  typeIsPrimitive,
  typeIsArray,
  typeIsStrictArray,
  typeIsCallable,
  getArrayElementKind,
} from "./type";

// trace
export {
  isInOnDepsPosition,
  isPassthroughPosition,
  isReachableFromTrackedContext,
  isPassthroughCallArgument,
  isCustomHookArgument,
  isInSyncCallbackAtTopLevel,
  isInsideValueSemanticArg,
  isJSXAccessorPassthrough,
  traceToValue,
  resolveToStaticString,
  type ReachabilityOptions,
} from "./trace";

// get
export {
  getSourceCode,
  getAST,
  getFunctions,
  getCalls,
  getVariables,
  getScopes,
  getJSXElements,
  getFillImageElements,
  getImports,
  getExports,
  getReactiveVariables,
  getComponentFunctions,
  getFunctionsWithReactiveCaptures,
  getPropsVariables,
  getStoreVariables,
  getResourceVariables,
  getVariablesWithPropertyAssignment,
  getInlineImports,
  getObjectSpreads,
  getNonNullAssertions,
  getTypeAssertions,
  getTypePredicates,
  getUnsafeGenericAssertions,
  getPropertyAssignments,
  getConditionalSpreads,
  getFiles,
  getSpreadElements,
  getCallsByPrimitive,
  getCallsByMethodName,
  getFunctionByNode,
  getFunctionsByName,
  getVariablesByName,
  getJSXElementByNode,
  getJSXElementsByTag,
  hasImportFrom,
  getImportsBySource,
  hasImportSpecifier,
  getArgumentByNode,
  getCallForArgument,
  getCallByNode,
  getFunctionByDeclarationNode,
  getComponentScopes,
  getExportByName,
  getExportByEntityId,
  getFileByPath,
  getFunctionById,
  getCallById,
  getVariableById,
  getScopeById,
  getUnsafeTypeAnnotations,
  getUnaryExpressionsByOperator,
  getNewExpressionsByCallee,
  getIdentifierReferences,
  getNodeAtPosition,
  getNodeAtPositionInFile,
  getMethodChain,
  type MethodChain,
  type NodeAtPositionInfo,
} from "./get";

// entity
export {
  getArgumentKind,
  getVariableReads,
  getVariableCallExpressions,
  getVariableAssignments,
  getCapturedVariables,
  getCalledFunction,
  getCallsTo,
  isReactiveVariable,
  isFunctionExported,
  getReturnStatements,
  getEarlyReturns,
  getCapturedReactiveVariables,
  isComponentFunction,
  isSplitPropsVariable,
  isMergePropsVariable,
  getVariableSourceKind,
  getFunctionVariable,
  getContainingFunction,
  getConditionalPropertyAssignments,
  getHiddenClassTransitions,
  getMemberAccessesOnIdentifier,
  buildDerivedFunctionMap,
  type DerivedFunctionInfo,
} from "./entity";

// iterate
export {
  iterateFunctions,
  iterateCalls,
  iterateVariables,
  iterateScopes,
  iterateJSXElements,
  iterateImports,
  iterateClasses,
  iterateProperties,
  iterateReactiveReads,
  iterateSignalLikeReads,
  getAsyncFunctions,
  getGeneratorFunctions,
  getDOMElements,
  getComponentElements,
} from "./iterate";

// find
export {
  countFunctionsWithReactiveCaptures,
  countReactiveVariables,
  countComponentFunctions,
  countFunctionsWhere,
  countCallsWhere,
  countVariablesWhere,
  countJSXElementsWhere,
  findFunction,
  findCall,
  findVariable,
  findJSXElement,
  someFunction,
  someCall,
  someVariable,
  someJSXElement,
  everyFunction,
  everyCall,
  everyVariable,
  filterFunctions,
  filterCalls,
  filterVariables,
  filterJSXElements,
} from "./find";

// spread
export {
  getSpreadSourceReactivity,
  isPropsPassThrough,
} from "./spread";

// reactive graph
export {
  getComputations,
  getComputationsByKind,
  getComputationByCallId,
  getDependenciesOf,
  getConsumersOf,
  getOwnedChildren,
  getOwnerOf,
  getTrackedDependencies,
  getSourceComputations,
} from "./reactive-graph";

// parent chain analysis
export type { ParentChainInfo } from "./parent-chain";
export {
  analyzeParentChain,
  isInsideJSXExpression,
  findEnclosingFunction,
  getEnclosingFunctionName,
  getEnclosingSyncCallbackMethod,
  getEnclosingComponentName,
} from "./parent-chain";
