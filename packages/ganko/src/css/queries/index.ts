/**
 * Query functions for CSSGraph
 *
 * Flat re-exports of all query modules.
 * Usage: import { getFiles, getVariablesByName } from 'ganko/css/queries'
 */

export {
  getFiles,
  getFileByPath,
  getRules,
  getSelectors,
  getDeclarations,
  getVariables,
  getVariablesByName,
  getAtRules,
  getTokens,
  getMixins,
  getFunctions,
  getPlaceholders,
  getParseErrors,
  hasParseErrors,
  getMediaQueries,
  getKeyframes,
  getLayers,
  getImportantDeclarations,
  getGlobalVariables,
  getUnusedVariables,
  getUnresolvedRefs,
  hasScss,
  getRuleByNode,
  getAtRuleByNode,
  getRulesBySelector,
  getDeclarationsByProperty,
  getAtRulesByName,
  getAtRulesByKind,
  getTokensByCategory,
  getDuplicateSelectors,
  getLayerOrder,
  getLayerOrderFor,
  getVariableRefs,
  getMixinIncludes,
  getFunctionCalls,
  getExtends,
  getFontFaces,
  getSupportsRules,
  getScssVariables,
  getCssCustomProperties,
  getFailedFilePaths,
  getTokenCategories,
  getLayoutPropertiesByClassToken,
  getKeyframeLayoutMutationsByName,
  getFontFaceDescriptorsByFamily,
  getUsedFontFamiliesByRule,
} from "./get";

export {
  countRules,
  countSelectors,
  countDeclarations,
  countVariables,
  countUnusedVariables,
  countRulesWhere,
  countSelectorsWhere,
  countDeclarationsWhere,
  countVariablesWhere,
  findRule,
  findSelector,
  findDeclaration,
  findVariable,
  findAtRule,
  someRule,
  someSelector,
  someDeclaration,
  someVariable,
  everyRule,
  everySelector,
  everyDeclaration,
  everyVariable,
  filterRules,
  filterSelectors,
  filterDeclarations,
  filterVariables,
  filterAtRules,
} from "./find";

export {
  getSelectorsBySpecificityRange,
  getHighSpecificitySelectors,
  getSelectorsWithIds,
  getSelectorsWithUniversal,
  getComplexSelectors,
  getDuplicateSelectorRules,
  getSelectorOverrides,
  getSelectorOverriddenBy,
} from "./selector";

export {
  getSelectorsTargetingCheckbox,
  getSelectorsTargetingTableCell,
  getSelectorsBySubjectTag,
  getSelectorsWithoutSubjectTag,
} from "./layout";

export {
  getVariableReferences,
  isVariableUsed,
  getVariableShadows,
  getVariableShadowedBy,
  resolveVariableReference,
  getVariablesInScope,
  getVariablesWithFallback,
  getReferencesWithFallback,
  getDeepFallbackChains,
} from "./variable";

export {
  getKeyframeByName,
  getMediaQueriesForCondition,
  getLayerByName,
  getRulesInAtRule,
  getDeclarationsInAtRule,
  getNestedAtRules,
  getAtRuleDepth,
  isAtRuleKind,
} from "./atrule";

export {
  getMixinByName,
  getMixinIncludesFor,
  isMixinUsed,
  getUnusedMixins,
  getUnresolvedMixinIncludes,
  getFunctionByName,
  getFunctionCallsFor,
  isFunctionUsed,
  getUnusedFunctions,
  getPlaceholderByName,
  getPlaceholderExtends,
  isPlaceholderUsed,
  getUnusedPlaceholders,
  getUnresolvedExtends,
} from "./scss";

export {
  getContainingAtRule,
  getAtRuleAncestry,
} from "./context";

export {
  isScopedSelector,
  isBEMBlock,
  isBEMElement,
  isBEMModifier,
  isUtilityClass,
  isDesignToken,
  isPrivateVariable,
} from "./pattern";

export {
  getImportantDeclarationsNotInUtilities,
} from "./semantic";
