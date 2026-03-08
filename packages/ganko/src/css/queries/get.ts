/**
 * Collection getters and map/ID-based lookups for CSSGraph
 */
import type { Rule, AtRule } from "postcss";
import type { CSSGraph, KeyframeLayoutMutation, FontFaceDescriptor } from "../impl";
import type {
  FileEntity,
  RuleEntity,
  SelectorEntity,
  DeclarationEntity,
  VariableEntity,
  VariableReferenceEntity,
  AtRuleEntity,
  ThemeTokenEntity,
  MixinEntity,
  MixinIncludeEntity,
  SCSSFunctionEntity,
  FunctionCallEntity,
  PlaceholderEntity,
  ExtendEntity,
  TokenCategory,
  CSSParseError,
  AtRuleKind,
} from "../entities";

export function getFiles(graph: CSSGraph): readonly FileEntity[] {
  return graph.files;
}

export function getFileByPath(graph: CSSGraph, path: string): FileEntity | null {
  return graph.filesByPath.get(path) ?? null;
}

export function getRules(graph: CSSGraph): readonly RuleEntity[] {
  return graph.rules;
}

export function getSelectors(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.selectors;
}

export function getDeclarations(graph: CSSGraph): readonly DeclarationEntity[] {
  return graph.declarations;
}

export function getVariables(graph: CSSGraph): readonly VariableEntity[] {
  return graph.variables;
}

export function getVariablesByName(graph: CSSGraph, name: string): readonly VariableEntity[] {
  return graph.variablesByName.get(name) ?? [];
}

export function getAtRules(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.atRules;
}

export function getTokens(graph: CSSGraph): readonly ThemeTokenEntity[] {
  return graph.tokens;
}

export function getMixins(graph: CSSGraph): readonly MixinEntity[] {
  return graph.mixins;
}

export function getFunctions(graph: CSSGraph): readonly SCSSFunctionEntity[] {
  return graph.functions;
}

export function getPlaceholders(graph: CSSGraph): readonly PlaceholderEntity[] {
  return graph.placeholders;
}

export function getParseErrors(graph: CSSGraph): readonly CSSParseError[] {
  return graph.parseErrors;
}

export function hasParseErrors(graph: CSSGraph): boolean {
  return graph.parseErrors.length > 0;
}

export function getMediaQueries(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.mediaQueries;
}

export function getKeyframes(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.keyframes;
}

export function getLayers(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.layers;
}

export function getImportantDeclarations(graph: CSSGraph): readonly DeclarationEntity[] {
  return graph.importantDeclarations;
}

export function getGlobalVariables(graph: CSSGraph): readonly VariableEntity[] {
  return graph.globalVariables;
}

export function getUnusedVariables(graph: CSSGraph): readonly VariableEntity[] {
  return graph.unusedVariables;
}

export function getUnresolvedRefs(graph: CSSGraph): readonly VariableReferenceEntity[] {
  return graph.unresolvedRefs;
}

export function hasScss(graph: CSSGraph): boolean {
  return graph.hasScssFiles;
}

export function getRuleByNode(graph: CSSGraph, node: Rule): RuleEntity | null {
  return graph.rulesByNode.get(node) ?? null;
}

export function getAtRuleByNode(graph: CSSGraph, node: AtRule): AtRuleEntity | null {
  return graph.atRulesByNode.get(node) ?? null;
}

export function getRulesBySelector(graph: CSSGraph, selector: string): readonly RuleEntity[] {
  return graph.rulesBySelector.get(selector) ?? [];
}

export function getDeclarationsByProperty(graph: CSSGraph, property: string): readonly DeclarationEntity[] {
  return graph.declarationsByProperty.get(property) ?? [];
}

export function getAtRulesByName(graph: CSSGraph, name: string): readonly AtRuleEntity[] {
  return graph.atRulesByName.get(name) ?? [];
}

export function getAtRulesByKind(graph: CSSGraph, kind: AtRuleKind): readonly AtRuleEntity[] {
  return graph.atRulesByKind.get(kind) ?? [];
}

export function getTokensByCategory(graph: CSSGraph, category: TokenCategory): readonly ThemeTokenEntity[] {
  return graph.tokensByCategory.get(category) ?? [];
}

export function getDuplicateSelectors(graph: CSSGraph): ReadonlyMap<string, { selector: string; rules: readonly RuleEntity[] }> {
  return graph.duplicateSelectors;
}

export function getLayerOrder(graph: CSSGraph): ReadonlyMap<string, number> {
  return graph.layerOrder;
}

export function getLayerOrderFor(graph: CSSGraph, layerName: string): number | null {
  return graph.layerOrder.get(layerName) ?? null;
}

export function getVariableRefs(graph: CSSGraph): readonly VariableReferenceEntity[] {
  return graph.variableRefs;
}

export function getMixinIncludes(graph: CSSGraph): readonly MixinIncludeEntity[] {
  return graph.includes;
}

export function getFunctionCalls(graph: CSSGraph): readonly FunctionCallEntity[] {
  return graph.functionCalls;
}

export function getExtends(graph: CSSGraph): readonly ExtendEntity[] {
  return graph.extends;
}

export function getFontFaces(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.fontFaces;
}

export function getSupportsRules(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.supportsRules;
}

export function getScssVariables(graph: CSSGraph): readonly VariableEntity[] {
  return graph.scssVariables;
}

export function getCssCustomProperties(graph: CSSGraph): readonly VariableEntity[] {
  return graph.cssCustomProperties;
}

export function getFailedFilePaths(graph: CSSGraph): readonly string[] {
  return graph.failedFilePaths;
}

export function getTokenCategories(graph: CSSGraph): readonly TokenCategory[] {
  return graph.tokenCategories;
}

export function getLayoutPropertiesByClassToken(graph: CSSGraph): ReadonlyMap<string, readonly string[]> {
  return graph.layoutPropertiesByClassToken;
}

export function getKeyframeLayoutMutationsByName(graph: CSSGraph): ReadonlyMap<string, readonly KeyframeLayoutMutation[]> {
  return graph.keyframeLayoutMutationsByName;
}

export function getFontFaceDescriptorsByFamily(graph: CSSGraph): ReadonlyMap<string, readonly FontFaceDescriptor[]> {
  return graph.fontFaceDescriptorsByFamily;
}

export function getUsedFontFamiliesByRule(graph: CSSGraph): ReadonlyMap<number, readonly string[]> {
  return graph.usedFontFamiliesByRule;
}
