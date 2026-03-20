/**
 * Phase 2: AST Processing
 *
 * Processes at-rules, rules, declarations, and variables together.
 */

import type { AtRule, Rule, Declaration, Container } from "postcss";
import { classifyPart, type CSSGraph } from "../impl";
import type { CSSInput } from "../input";
import type {
  FileEntity,
  RuleEntity,
  SelectorEntity,
  DeclarationEntity,
  VariableEntity,
  AtRuleEntity,
  AtRuleKind,
  ParsedAtRuleParams,
  MediaCondition,
  MediaFeature,
  Specificity,
  SelectorAnchor,
  VariableScope,
  CascadePosition,
  FunctionCallInfo,
} from "../entities";
import {
  EMPTY_MEDIA_CONDITIONS,
  EMPTY_PARSED_VALUE,
  ZERO_SPECIFICITY,
  GLOBAL_SCOPE,
  DECL_IS_IMPORTANT,
  VAR_IS_GLOBAL,
  VAR_IS_SCSS,
  FILE_HAS_VARIABLES,
  FILE_HAS_MIXINS,
  setFlag,
} from "../entities";
import {
  parseSelectorList,
  parseSelectorComplete,
} from "../parser/selector";
import { specificityToScore } from "../parser/specificity";
import type { VarReference } from "../parser/value";
import { parseValueWithFunctions } from "../parser/value";
import {
  CHAR_HYPHEN,
  CHAR_DOLLAR,
  CHAR_EXCLAIM,
  CHAR_I,
  CHAR_M,
  CHAR_P,
  CHAR_O,
  CHAR_R,
  CHAR_T,
  CHAR_A,
  CHAR_N,
  isRootSelector,
  isWhitespace,
  splitByComma,
  splitMediaQueries,
  startsWithCaseInsensitive,
  MEDIA_TYPE_RE,
  MEDIA_FEATURE_RE,
  MEDIA_RANGE_RE,
  MEDIA_COLON_RE,
} from "@drskillissue/ganko-shared";

const CSS_IDENT = /^[-_a-zA-Z][-_a-zA-Z0-9]*$/

interface NestingContext {
  readonly parentRule: RuleEntity | null;
  readonly parentAtRule: AtRuleEntity | null;
  readonly containingMedia: AtRuleEntity | null;
  readonly containingLayer: AtRuleEntity | null;
  readonly depth: number;
}

interface FileCollector {
  readonly atRules: AtRuleEntity[];
  readonly rules: RuleEntity[];
  readonly variables: VariableEntity[];
}

const ROOT_CONTEXT: NestingContext = {
  parentRule: null,
  parentAtRule: null,
  containingMedia: null,
  containingLayer: null,
  depth: 0,
};

/**
 * Parse stylesheet ASTs into graph entities.
 * @param graph CSS graph
 * @param _input CSS input
 */
export function runAstPhase(graph: CSSGraph, _input: CSSInput): void {
  const files = graph.files;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    processFileAST(graph, file);
  }

  processLayerOrdering(graph);
};

/**
 * Processes the AST for a single CSS file, extracting rules, at-rules, and variables.
 * @param graph - The CSS graph to populate
 * @param file - The file entity containing the AST
 */
function processFileAST(graph: CSSGraph, file: FileEntity): void {
  const root = file.node;
  if (!root.nodes || root.nodes.length === 0) {
    file.atRules = [];
    file.rules = [];
    file.variables = [];
    return;
  }

  const collector: FileCollector = {
    atRules: [],
    rules: [],
    variables: [],
  };

  walkAndProcess(graph, file, root, ROOT_CONTEXT, collector);

  file.atRules = collector.atRules;
  file.rules = collector.rules;
  file.variables = collector.variables;
}

/**
 * Walks the PostCSS AST and creates entities for each node.
 * @param graph - The CSS graph to populate
 * @param file - The file entity
 * @param container - The PostCSS container to traverse
 * @param context - The nesting context (parent rules, at-rules, media queries)
 * @param collector - Collects extracted entities
 */
function walkAndProcess(
  graph: CSSGraph,
  file: FileEntity,
  container: Container,
  context: NestingContext,
  collector: FileCollector,
): void {
  const nodes = container.nodes;
  if (!nodes) return;

  const { parentRule, parentAtRule, containingMedia, containingLayer, depth } = context;
  const isRoot = !parentRule && !parentAtRule;
  if (nodes.length === 0) return;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;

    if (node.type === "decl") {
      if (isRoot) {
        processRootLevelDeclaration(graph, node, file, collector);
      }
    } else if (node.type === "atrule") {
      const atRuleNode = node;
      const atRule = createAtRuleEntity(graph, atRuleNode, file, parentRule ?? parentAtRule);
      graph.addAtRule(atRule);
      collector.atRules.push(atRule);

      if (atRule.kind === "mixin" || atRule.kind === "include") {
        file._flags = setFlag(file._flags, FILE_HAS_MIXINS);
      }

      const newContainingMedia = atRule.name === "media" ? atRule : containingMedia;
      const newContainingLayer = atRule.name === "layer" ? atRule : containingLayer;

      const atRuleChildren = atRuleNode.nodes;
      if (atRuleChildren && atRuleChildren.length > 0) {
        const processDecls = AT_RULE_KINDS_WITH_DECLARATIONS.has(atRule.kind);
        let hasNestedStructures = false;

        for (let k = 0; k < atRuleChildren.length; k++) {
          const childNode = atRuleChildren[k];
          if (!childNode) continue;
          if (childNode.type === "decl") {
            if (processDecls) {
              processDeclaration(graph, childNode, atRule, file, collector);
            }
          } else if (childNode.type === "rule" || childNode.type === "atrule") {
            hasNestedStructures = true;
          }
        }

        if (hasNestedStructures) {
          const nestedContext: NestingContext = {
            parentRule: null,
            parentAtRule: atRule,
            containingMedia: newContainingMedia,
            containingLayer: newContainingLayer,
            depth,
          };
          walkAndProcess(graph, file, atRuleNode, nestedContext, collector);
        }
      }

    } else if (node.type === "rule") {
      const ruleNode = node;
      const rule = createRuleEntity(graph, ruleNode, file, context);
      graph.addRule(rule);
      collector.rules.push(rule);

      if (parentRule) {
        parentRule.nestedRules.push(rule);
      }
      if (parentAtRule) {
        parentAtRule.rules.push(rule);
      }

      const selectorStrings = parseSelectorList(rule.selectorText);
      for (let j = 0; j < selectorStrings.length; j++) {
        const selectorText = selectorStrings[j];
        if (!selectorText) continue;
        const selector = createSelectorEntity(graph, selectorText, rule);
        graph.addSelector(selector);
        rule.selectors.push(selector);
        graph.registerRuleBySelector(selectorText, rule);
      }

      const ruleChildren = ruleNode.nodes;
      if (ruleChildren && ruleChildren.length > 0) {
        let hasNestedStructures = false;

        for (let k = 0; k < ruleChildren.length; k++) {
          const childNode = ruleChildren[k];
          if (!childNode) continue;
          if (childNode.type === "decl") {
            processDeclaration(graph, childNode, rule, file, collector);
          } else if (childNode.type === "rule" || childNode.type === "atrule") {
            hasNestedStructures = true;
          }
        }

        if (hasNestedStructures) {
          const nestedContext: NestingContext = {
            parentRule: rule,
            parentAtRule: null,
            containingMedia,
            containingLayer,
            depth: depth + 1,
          };
          walkAndProcess(graph, file, ruleNode, nestedContext, collector);
        }
      }
    }
  }
}

/**
 * Handles CSS/SCSS variable declarations at the root level of a file.
 * @param graph - The CSS graph to populate
 * @param decl - The declaration node
 * @param file - The file entity
 * @param collector - Collects extracted entities
 */
function processRootLevelDeclaration(
  graph: CSSGraph,
  decl: Declaration,
  file: FileEntity,
  collector: FileCollector,
): void {
  const prop = decl.prop;
  const firstChar = prop.charCodeAt(0);

  if (firstChar === CHAR_HYPHEN && prop.charCodeAt(1) === CHAR_HYPHEN) {
    const variable = createRootLevelCSSVariable(graph, decl, file);
    graph.addVariable(variable);
    collector.variables.push(variable);
    file._flags = setFlag(file._flags, FILE_HAS_VARIABLES);
  } else if (firstChar === CHAR_DOLLAR) {
    const variable = createRootLevelSCSSVariable(graph, decl, file);
    graph.addVariable(variable);
    collector.variables.push(variable);
    file._flags = setFlag(file._flags, FILE_HAS_VARIABLES);
  }
}

/**
 * Creates a VariableEntity for a root-level CSS custom property (--var).
 * @param graph - The CSS graph
 * @param decl - The declaration node
 * @param file - The file entity
 * @returns The created VariableEntity
 */
function createRootLevelCSSVariable(
  graph: CSSGraph,
  decl: Declaration,
  file: FileEntity,
): VariableEntity {
  const placeholderDecl = createRootLevelPlaceholderDeclaration(graph, decl, file);

  return {
    id: graph.nextVariableId(),
    name: graph.intern(decl.prop),
    declaration: placeholderDecl,
    file,
    scope: GLOBAL_SCOPE,
    scopeSelector: null,
    _flags: VAR_IS_GLOBAL,
    value: decl.value,
    parsedValue: EMPTY_PARSED_VALUE,
    computedValue: null,
    references: [],
    shadows: [],
    shadowedBy: [],
    themeToken: null,
    scssName: null,
  };
}

/**
 * Creates a VariableEntity for a root-level SCSS variable ($var).
 * @param graph - The CSS graph
 * @param decl - The declaration node
 * @param file - The file entity
 * @returns The created VariableEntity
 */
function createRootLevelSCSSVariable(
  graph: CSSGraph,
  decl: Declaration,
  file: FileEntity,
): VariableEntity {
  const placeholderDecl = createRootLevelPlaceholderDeclaration(graph, decl, file);
  const prop = decl.prop;

  return {
    id: graph.nextVariableId(),
    name: graph.intern("--" + prop.slice(1)),
    declaration: placeholderDecl,
    file,
    scope: GLOBAL_SCOPE,
    scopeSelector: null,
    _flags: VAR_IS_GLOBAL | VAR_IS_SCSS,
    value: decl.value,
    parsedValue: EMPTY_PARSED_VALUE,
    computedValue: null,
    references: [],
    shadows: [],
    shadowedBy: [],
    themeToken: null,
    scssName: prop,
  };
}

/**
 * Creates a placeholder DeclarationEntity for root-level variable declarations.
 * @param graph - The CSS graph
 * @param decl - The declaration node
 * @param file - The file entity
 * @returns The created DeclarationEntity
 */
function createRootLevelPlaceholderDeclaration(
  graph: CSSGraph,
  decl: Declaration,
  file: FileEntity,
): DeclarationEntity {
  const isImportant = decl.important || false;
  const source = decl.source;
  const startLine = source?.start?.line ?? 1;
  const startColumn = source?.start?.column ?? 1;
  const endLine = source?.end?.line ?? startLine;
  const endColumn = source?.end?.column ?? startColumn;
  const startOffset = toOffset(file, startLine, startColumn);
  let endOffset = toOffset(file, endLine, endColumn);
  if (endOffset <= startOffset) {
    const fallbackLength = decl.toString().length;
    endOffset = startOffset + (fallbackLength > 0 ? fallbackLength : 1);
  }

  return {
    id: graph.nextDeclarationId(),
    node: decl,
    rule: null,
    file,
    property: graph.intern(decl.prop),
    value: decl.value,
    rawValue: decl.value,
    _flags: isImportant ? DECL_IS_IMPORTANT : 0,
    parsedValue: EMPTY_PARSED_VALUE,
    variableRefs: [],
    functionCalls: [],
    parsedVarRefs: [],
    startLine,
    startColumn,
    startOffset,
    endOffset,
    sourceOrder: graph.nextSourceOrder(),
    cascadePosition: {
      layer: null,
      layerOrder: 0,
      sourceOrder: 0,
      specificity: ZERO_SPECIFICITY,
      specificityScore: 0,
      isImportant,
    },
    overrides: [],
    overriddenBy: [],
  };
}

/**
 * Processes a CSS declaration, creating entities for properties and variables.
 * @param graph - The CSS graph to populate
 * @param decl - The declaration node
 * @param parent - The parent rule or at-rule
 * @param file - The file entity
 * @param collector - Collects extracted entities
 */
function processDeclaration(
  graph: CSSGraph,
  decl: Declaration,
  parent: RuleEntity | AtRuleEntity,
  file: FileEntity,
  collector: FileCollector,
): void {
  const prop = decl.prop;
  const firstChar = prop.charCodeAt(0);

  const declaration = createDeclarationEntity(graph, decl, parent, file);
  graph.addDeclaration(declaration);
  parent.declarations.push(declaration);

  if (firstChar === CHAR_HYPHEN && prop.charCodeAt(1) === CHAR_HYPHEN) {
    const variable = createCSSVariableEntity(graph, decl, declaration, file, parent);
    graph.addVariable(variable);
    collector.variables.push(variable);
    file._flags = setFlag(file._flags, FILE_HAS_VARIABLES);
  } else if (firstChar === CHAR_DOLLAR) {
    const variable = createSCSSVariableEntity(graph, decl, declaration, file, parent);
    graph.addVariable(variable);
    collector.variables.push(variable);
    file._flags = setFlag(file._flags, FILE_HAS_VARIABLES);
  }
}

/**
 * Creates an AtRuleEntity for @media, @keyframes, @layer, etc.
 * @param graph - The CSS graph
 * @param node - The at-rule node
 * @param file - The file entity
 * @param parent - The parent at-rule if nested
 * @returns The created AtRuleEntity
 */
function createAtRuleEntity(
  graph: CSSGraph,
  node: AtRule,
  file: FileEntity,
  parent: RuleEntity | AtRuleEntity | null,
): AtRuleEntity {
  const name = graph.intern(node.name.toLowerCase());
  const kind = getAtRuleKind(name);
  const parsedParams = parseAtRuleParams(name, node.params);
  const depth = parent ? parent.depth + 1 : 0;

  const entity: AtRuleEntity = {
    id: graph.nextAtRuleId(),
    node,
    file: file,
    name,
    kind,
    params: node.params,
    parsedParams,
    rules: [],
    declarations: [],
    nestedAtRules: [],
    parent: parent,
    depth,
    startLine: node.source?.start?.line ?? 0,
    endLine: node.source?.end?.line ?? 0,
    sourceOrder: graph.nextSourceOrder(),
  };

  if (parent) {
    parent.nestedAtRules.push(entity);
  }

  return entity;
}

const AT_RULE_KIND_MAP = new Map<string, AtRuleKind>([
  ["media", "media"],
  ["keyframes", "keyframes"],
  ["-webkit-keyframes", "keyframes"],
  ["-moz-keyframes", "keyframes"],
  ["-o-keyframes", "keyframes"],
  ["font-face", "font-face"],
  ["supports", "supports"],
  ["import", "import"],
  ["layer", "layer"],
  ["container", "container"],
  ["page", "page"],
  ["charset", "charset"],
  ["namespace", "namespace"],
  ["mixin", "mixin"],
  ["function", "function"],
  ["include", "include"],
  ["extend", "extend"],
  ["use", "use"],
  ["forward", "forward"],
]);

/**
 * At-rule kinds whose direct child declarations are standard CSS declarations
 * and should be indexed in the CSS graph. Other at-rules either:
 * - contain nested rules (media, supports, layer, container)
 * - use framework-specific syntax (mixin, function, include, extend)
 * - define tokens with self-referencing vars (Tailwind @theme — kind "other")
 *
 * "font-face" and "page" are the CSS spec at-rules with declarations.
 * "other" is intentionally excluded because unknown at-rules like @theme, @utility
 * may use non-standard semantics where self-referencing vars are valid token definitions.
 */
const AT_RULE_KINDS_WITH_DECLARATIONS = new Set<AtRuleKind>([
  "font-face",
  "page",
])

/**
 * Maps an at-rule name to its kind category.
 * @param name - The at-rule name (e.g., "media", "keyframes")
 * @returns The kind category
 */
function getAtRuleKind(name: string): AtRuleKind {
  return AT_RULE_KIND_MAP.get(name) ?? "other";
}

/**
 * Parses at-rule parameters based on the rule type.
 * @param name - The at-rule name
 * @param params - The parameter string
 * @returns Parsed parameters
 */
function parseAtRuleParams(name: string, params: string): ParsedAtRuleParams {
  const trimmed = params.trim();
  if (!trimmed) return { raw: "" };

  switch (name) {
    case "media":
      return { raw: trimmed, mediaConditions: parseMediaQuery(trimmed) };
    case "keyframes":
    case "-webkit-keyframes":
    case "-moz-keyframes":
    case "-o-keyframes":
      return { raw: trimmed, animationName: trimmed };
    case "layer": {
      const layerNames = splitByComma(trimmed);
      const firstLayer = layerNames[0] || undefined;
      const result: ParsedAtRuleParams = { raw: trimmed };
      if (firstLayer !== undefined) result.layerName = firstLayer;
      if (layerNames.length > 0) result.layerNames = [...layerNames];
      return result;
    }
    case "container": {
      return parseContainerParams(trimmed);
    }
    default:
      return { raw: trimmed };
  }
}

/**
 * Parse @container params into optional name and condition.
 * @param params Raw container parameters
 * @returns Parsed container rule params
 */
function parseContainerParams(params: string): ParsedAtRuleParams {
  const open = params.indexOf("(");
  if (open === -1) return { raw: params, containerCondition: params };

  const prefix = params.slice(0, open).trim();
  const lowerPrefix = prefix.toLowerCase();
  const condition = params.slice(open).trim();
  if (prefix.length === 0) return { raw: params, containerCondition: condition };
  if (lowerPrefix === "style" || lowerPrefix === "scroll-state") {
    return { raw: params, containerCondition: params };
  }

  if (!CSS_IDENT.test(prefix)) {
    return { raw: params, containerCondition: params };
  }

  return {
    raw: params,
    containerName: prefix,
    containerCondition: condition,
  };
}

/**
 * Parses a media query string into structured conditions.
 * @param params - The media query parameter string
 * @returns Array of parsed conditions
 */
function parseMediaQuery(params: string): MediaCondition[] {
  const trimmed = params.trim();
  if (!trimmed) return EMPTY_MEDIA_CONDITIONS;

  const conditions: MediaCondition[] = [];
  const queries = splitMediaQueries(trimmed);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    if (!query) continue;
    const condition = parseMediaCondition(query.trim());
    if (condition) conditions.push(condition);
  }

  return conditions.length > 0 ? conditions : EMPTY_MEDIA_CONDITIONS;
}

/**
 * Parses a single media condition (e.g., "screen and (min-width: 768px)").
 * @param query - The media query condition string
 * @returns The parsed condition or null if invalid
 */
function parseMediaCondition(query: string): MediaCondition | null {
  if (!query) return null;

  let remaining = query;
  let remainingLower = query.toLowerCase();
  let isNot = false;
  let type: MediaCondition["type"] = "all";

  if (startsWithCaseInsensitive(remainingLower, "not ")) {
    isNot = true;
    remaining = remaining.slice(4).trim();
    remainingLower = remaining.toLowerCase();
  }

  if (startsWithCaseInsensitive(remainingLower, "only ")) {
    remaining = remaining.slice(5).trim();
  }

  const typeMatch = remaining.match(MEDIA_TYPE_RE);
  if (typeMatch) {
    const matchedGroup = typeMatch[1];
    if (!matchedGroup) return { type, features: parseMediaFeatures(remaining), isNot };
    const matchedType = matchedGroup.toLowerCase();
    if (matchedType === "all" || matchedType === "screen" || matchedType === "print" || matchedType === "speech") {
      type = matchedType;
    }
    remaining = remaining.slice(typeMatch[0].length).trim();
    const remainingAfterType = remaining.toLowerCase();
    if (startsWithCaseInsensitive(remainingAfterType, "and ")) {
      remaining = remaining.slice(4).trim();
    }
  }

  return { type, features: parseMediaFeatures(remaining), isNot };
}

/**
 * Extracts media features from a query string.
 * @param query - The query string containing features
 * @returns Array of parsed media features
 */
function parseMediaFeatures(query: string): MediaFeature[] {
  if (!query) return [];

  const features: MediaFeature[] = [];
  MEDIA_FEATURE_RE.lastIndex = 0;
  let match;

  while ((match = MEDIA_FEATURE_RE.exec(query)) !== null) {
    const featureStr = match[1];
    if (!featureStr) continue;
    const feature = parseMediaFeature(featureStr.trim());
    if (feature) features.push(feature);
  }

  return features;
}

/**
 * Parses a single media feature (e.g., "min-width: 768px").
 * @param feature - The feature string
 * @returns The parsed feature or null if invalid
 */
function parseMediaFeature(feature: string): MediaFeature | null {
  if (!feature) return null;

  const rangeMatch = feature.match(MEDIA_RANGE_RE);
  if (rangeMatch) {
    const rangeName = rangeMatch[1];
    const op = rangeMatch[2];
    const rangeValue = rangeMatch[3];
    if (!rangeName || !rangeValue) return null;
    let operator: MediaFeature["operator"] = null;
    if (op === ">=" || op === ">") operator = "min";
    else if (op === "<=" || op === "<") operator = "max";
    return { name: rangeName.toLowerCase(), value: rangeValue.trim(), operator };
  }

  const colonMatch = feature.match(MEDIA_COLON_RE);
  if (colonMatch) {
    const colonName = colonMatch[1];
    const colonValue = colonMatch[2];
    if (!colonName || !colonValue) return null;
    let operator: MediaFeature["operator"];
    let featureName = colonName.toLowerCase();
    if (startsWithCaseInsensitive(featureName, "min-")) {
      operator = "min";
      featureName = featureName.slice(4);
    } else if (startsWithCaseInsensitive(featureName, "max-")) {
      operator = "max";
      featureName = featureName.slice(4);
    } else {
      operator = "exact";
    }
    return { name: featureName, value: colonValue.trim(), operator };
  }

  return { name: feature.toLowerCase(), value: null, operator: null };
}

function toOffset(file: FileEntity, line: number, column: number): number {
  const lineIndex = line > 0 ? line - 1 : 0
  const lineStart = file.lineStartOffsets[lineIndex] ?? file.content.length
  const columnOffset = column > 0 ? column - 1 : 0
  const offset = lineStart + columnOffset

  if (offset < 0) return 0
  if (offset > file.content.length) return file.content.length
  return offset
}

function getRuleBlockOffsets(file: FileEntity, startOffset: number, endOffset: number): {
  blockStartOffset: number
  blockEndOffset: number
} {
  const boundedStart = startOffset < 0 ? 0 : startOffset
  const boundedEnd = endOffset > file.content.length ? file.content.length : endOffset
  const open = file.content.indexOf("{", boundedStart)

  if (open === -1 || open >= boundedEnd) {
    return {
      blockStartOffset: boundedStart,
      blockEndOffset: boundedEnd,
    }
  }

  const close = file.content.lastIndexOf("}", boundedEnd)
  if (close === -1 || close < open) {
    return {
      blockStartOffset: open + 1,
      blockEndOffset: boundedEnd,
    }
  }

  return {
    blockStartOffset: open + 1,
    blockEndOffset: close,
  }
}


/**
 * Creates a RuleEntity for a CSS rule block.
 * @param graph - The CSS graph
 * @param node - The rule node
 * @param file - The file entity
 * @param context - The nesting context
 * @returns The created RuleEntity
 */
function createRuleEntity(
  graph: CSSGraph,
  node: Rule,
  file: FileEntity,
  context: NestingContext,
): RuleEntity {
  const { parentRule, parentAtRule, containingMedia, containingLayer, depth } = context;
  const id = graph.nextRuleId();
  const sourceOrder = graph.nextSourceOrder();
  const parent = parentRule || parentAtRule;
  const startLine = node.source?.start?.line ?? 1;
  const startColumn = node.source?.start?.column ?? 1;
  const endLine = node.source?.end?.line ?? startLine;
  const endColumn = node.source?.end?.column ?? startColumn;
  const startOffset = toOffset(file, startLine, startColumn);
  let endOffset = toOffset(file, endLine, endColumn);
  if (endOffset <= startOffset) {
    const fallbackLength = node.toString().length;
    endOffset = startOffset + (fallbackLength > 0 ? fallbackLength : 1);
  }
  const { blockStartOffset, blockEndOffset } = getRuleBlockOffsets(file, startOffset, endOffset);

  return {
    kind: "rule",
    id,
    node,
    file,
    selectorText: node.selector,
    selectors: [],
    declarations: [],
    nestedRules: [],
    nestedAtRules: [],
    parent,
    depth,
    startLine,
    startColumn,
    endLine,
    endColumn,
    startOffset,
    endOffset,
    blockStartOffset,
    blockEndOffset,
    sourceOrder,
    containingMedia,
    containingLayer,
    containingMediaStack: [],
    declarationIndex: new Map(),
    elementKinds: new Set(),
  };
}

/**
 * Creates a SelectorEntity with parsed specificity and parts.
 * @param graph - The CSS graph
 * @param raw - The selector string
 * @param rule - The parent rule
 * @returns The created SelectorEntity
 */
function createSelectorEntity(
  graph: CSSGraph,
  raw: string,
  rule: RuleEntity,
): SelectorEntity {
  const id = graph.nextSelectorId();
  const { parts, compounds, combinators, specificity, complexity } = parseSelectorComplete(raw);
  const specificityScore = specificityToScore(specificity);

  const kinds = rule.elementKinds;
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    if (part) classifyPart(part, kinds);
  }

  const subject = compounds.length > 0 ? compounds[compounds.length - 1] : null;

  let includesPseudoSelector = false;
  let includesNesting = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.type === "pseudo-class" || part.type === "pseudo-element") {
      includesPseudoSelector = true;
      continue;
    }
    if (part.type === "nesting") includesNesting = true;
  }

  const subjectTag = subject?.tagName ?? null;
  const subjectIdValue = subject?.idValue ?? null;
  const subjectClasses = subject?.classes ?? [];
  const subjectAttributes = subject?.attributes ?? [];
  const includesDescendantCombinator = combinators.includes("descendant");

  let hasCheckboxAttribute = false;
  for (let i = 0; i < subjectAttributes.length; i++) {
    const a = subjectAttributes[i];
    if (!a) continue;
    if (a.name !== "type") continue;
    if (a.operator !== "equals") continue;
    if (a.value === null) continue;
    const normalized = a.caseInsensitive ? a.value.toLowerCase() : a.value;
    if (normalized !== "checkbox") continue;
    hasCheckboxAttribute = true;
    break;
  }

  const targetsCheckbox = (subjectTag === "input" || subjectTag === null) && hasCheckboxAttribute;
  const targetsTableCell = subjectTag === "td" || subjectTag === "th";

  const anchor: SelectorAnchor = {
    subjectTag,
    idValue: subjectIdValue,
    classes: subjectClasses,
    attributes: subjectAttributes,
    includesDescendantCombinator,
    includesPseudoSelector,
    dynamic: includesPseudoSelector || includesNesting,
    targetsCheckbox,
    targetsTableCell,
  };

  return {
    id,
    raw,
    rule,
    specificity,
    specificityScore,
    complexity,
    compounds,
    combinators,
    parts: parts.length > 0 ? parts : [],
    anchor,
    overrides: [],
    overriddenBy: [],
  };
}

/**
 * Creates a DeclarationEntity for a CSS property declaration.
 * @param graph - The CSS graph
 * @param node - The declaration node
 * @param parent - The parent rule or at-rule
 * @param file - The file entity
 * @returns The created DeclarationEntity
 */
function createDeclarationEntity(
  graph: CSSGraph,
  node: Declaration,
  parent: RuleEntity | AtRuleEntity,
  file: FileEntity,
): DeclarationEntity {
  const id = graph.nextDeclarationId();
  const sourceOrder = graph.nextSourceOrder();
  const rawValue = node.value;
  const { value, isImportant } = extractImportant(rawValue);
  const startLine = node.source?.start?.line ?? 1;
  const startColumn = node.source?.start?.column ?? 1;
  const endLine = node.source?.end?.line ?? startLine;
  const endColumn = node.source?.end?.column ?? startColumn;
  const startOffset = toOffset(file, startLine, startColumn);
  let endOffset = toOffset(file, endLine, endColumn);
  if (endOffset <= startOffset) {
    const fallbackLength = node.toString().length;
    endOffset = startOffset + (fallbackLength > 0 ? fallbackLength : 1);
  }

  let parsedValue;
  let functionCalls: FunctionCallInfo[];
  let parsedVarRefs: VarReference[];

  if (value.indexOf("(") === -1) {
    parsedValue = EMPTY_PARSED_VALUE;
    functionCalls = [];
    parsedVarRefs = [];
  } else {
    try {
      const result = parseValueWithFunctions(value);
      parsedValue = result.parsedValue;
      functionCalls = result.functionCalls.length > 0 ? result.functionCalls : [];
      parsedVarRefs = result.varReferences.length > 0 ? result.varReferences : [];
    } catch {
      parsedValue = EMPTY_PARSED_VALUE;
      functionCalls = [];
      parsedVarRefs = [];
    }
  }

  const cascadePosition = getCascadePosition(graph, sourceOrder, isImportant, parent);
  const rule = parent.kind === "rule" ? parent : null;

  return {
    id,
    node,
    rule,
    file,
    property: graph.intern(node.prop),
    value,
    rawValue,
    _flags: isImportant ? DECL_IS_IMPORTANT : 0,
    parsedValue,
    variableRefs: [],
    functionCalls,
    parsedVarRefs,
    startLine,
    startColumn,
    startOffset,
    endOffset,
    sourceOrder,
    cascadePosition,
    overrides: [],
    overriddenBy: [],
  };
}

/**
 * Extracts the !important flag from a CSS value.
 * @param rawValue - The raw CSS value string
 * @returns Object with value and isImportant flag
 */
function extractImportant(rawValue: string): { value: string; isImportant: boolean } {
  const len = rawValue.length;
  if (len === 0) return { value: "", isImportant: false };

  let end = len;
  while (end > 0 && isWhitespace(rawValue.charCodeAt(end - 1))) end--;

  if (end < 10) return { value: rawValue, isImportant: false };

  const p = end - 1;
  if ((rawValue.charCodeAt(p) | 32) !== CHAR_T) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 1) | 32) !== CHAR_N) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 2) | 32) !== CHAR_A) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 3) | 32) !== CHAR_T) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 4) | 32) !== CHAR_R) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 5) | 32) !== CHAR_O) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 6) | 32) !== CHAR_P) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 7) | 32) !== CHAR_M) return { value: rawValue, isImportant: false };
  if ((rawValue.charCodeAt(p - 8) | 32) !== CHAR_I) return { value: rawValue, isImportant: false };

  let pos = p - 9;
  while (pos >= 0 && isWhitespace(rawValue.charCodeAt(pos))) pos--;

  if (pos < 0 || rawValue.charCodeAt(pos) !== CHAR_EXCLAIM) {
    return { value: rawValue, isImportant: false };
  }

  let valueEnd = pos;
  while (valueEnd > 0 && isWhitespace(rawValue.charCodeAt(valueEnd - 1))) valueEnd--;

  return { value: rawValue.substring(0, valueEnd), isImportant: true };
}

/**
 * Computes the cascade position for a declaration.
 * @param graph - The CSS graph
 * @param sourceOrder - The source order of the declaration
 * @param isImportant - Whether declaration has !important
 * @param parent - The parent rule or at-rule
 * @returns The computed cascade position
 */
function getCascadePosition(
  graph: CSSGraph,
  sourceOrder: number,
  isImportant: boolean,
  parent: RuleEntity | AtRuleEntity,
): CascadePosition {
  let layer: string | null = null;
  let layerOrder = 0;

  if (parent.kind === "rule" && parent.containingLayer) {
    const layerAtRule = parent.containingLayer;
    layer = layerAtRule.parsedParams?.layerName ?? layerAtRule.params;
    layerOrder = graph.layerOrder.get(layer) ?? 0;
  }

  let specificity: Specificity = ZERO_SPECIFICITY;
  let specificityScore = 0;
  if (parent.kind === "rule") {
    const selectors = parent.selectors;
    const firstSelector = selectors[0];
    if (firstSelector && selectors.length === 1) {
      specificity = firstSelector.specificity;
      specificityScore = firstSelector.specificityScore;
    } else if (firstSelector && selectors.length > 1) {
      specificityScore = firstSelector.specificityScore;
      specificity = firstSelector.specificity;
      for (let i = 1; i < selectors.length; i++) {
        const sel = selectors[i];
        if (!sel) continue;
        if (sel.specificityScore > specificityScore) {
          specificityScore = sel.specificityScore;
          specificity = sel.specificity;
        }
      }
    }
  }

  return { layer, layerOrder, sourceOrder, specificity, specificityScore, isImportant };
}

/**
 * Creates a VariableEntity for a CSS custom property within a rule.
 * @param graph - The CSS graph
 * @param decl - The declaration node
 * @param declaration - The declaration entity
 * @param file - The file entity
 * @param parent - The parent rule or at-rule
 * @returns The created VariableEntity
 */
function createCSSVariableEntity(
  graph: CSSGraph,
  decl: Declaration,
  declaration: DeclarationEntity,
  file: FileEntity,
  parent: RuleEntity | AtRuleEntity,
): VariableEntity {
  const { scope, isGlobal } = getVariableScopeFromContext(parent);
  const scopeSelector = parent.kind === "rule" && parent.selectors.length > 0
    ? (parent.selectors[0] ?? null)
    : null;

  return {
    id: graph.nextVariableId(),
    name: graph.intern(decl.prop),
    declaration,
    file,
    scope,
    scopeSelector,
    _flags: isGlobal ? VAR_IS_GLOBAL : 0,
    value: decl.value,
    parsedValue: EMPTY_PARSED_VALUE,
    computedValue: null,
    references: [],
    shadows: [],
    shadowedBy: [],
    themeToken: null,
    scssName: null,
  };
}

/**
 * Creates a VariableEntity for an SCSS variable within a rule.
 * @param graph - The CSS graph
 * @param decl - The declaration node
 * @param declaration - The declaration entity
 * @param file - The file entity
 * @param parent - The parent rule or at-rule
 * @returns The created VariableEntity
 */
function createSCSSVariableEntity(
  graph: CSSGraph,
  decl: Declaration,
  declaration: DeclarationEntity,
  file: FileEntity,
  parent: RuleEntity | AtRuleEntity,
): VariableEntity {
  const { scope, isGlobal } = getVariableScopeFromContext(parent);
  const scopeSelector = parent.kind === "rule" && parent.selectors.length > 0
    ? (parent.selectors[0] ?? null)
    : null;
  const prop = decl.prop;

  return {
    id: graph.nextVariableId(),
    name: graph.intern("--" + prop.slice(1)),
    declaration,
    file,
    scope,
    scopeSelector,
    _flags: (isGlobal ? VAR_IS_GLOBAL : 0) | VAR_IS_SCSS,
    value: decl.value,
    parsedValue: EMPTY_PARSED_VALUE,
    computedValue: null,
    references: [],
    shadows: [],
    shadowedBy: [],
    themeToken: null,
    scssName: prop,
  };
}

interface ScopeResult {
  readonly scope: VariableScope;
  readonly isGlobal: boolean;
}

const GLOBAL_RESULT: ScopeResult = { scope: GLOBAL_SCOPE, isGlobal: true };

/**
 * Determines the scope of a variable based on its containing context.
 * @param parent - The parent rule or at-rule
 * @returns The scope result with scope type and global flag
 */
function getVariableScopeFromContext(parent: RuleEntity | AtRuleEntity): ScopeResult {
  if (parent.kind === "rule") {
    const selector = parent.selectorText;

    if (isRootSelector(selector)) return GLOBAL_RESULT;

    const firstSel = parent.selectors[0];
    const specificity = firstSel
      ? firstSel.specificity
      : ZERO_SPECIFICITY;

    return {
      scope: { type: "selector", condition: selector, specificity },
      isGlobal: false,
    };
  }

  const name = parent.name;

  if (name === "media") {
    return { scope: { type: "media", condition: parent.params, specificity: null }, isGlobal: false };
  }
  if (name === "supports") {
    return { scope: { type: "supports", condition: parent.params, specificity: null }, isGlobal: false };
  }
  if (name === "layer") {
    return { scope: { type: "layer", condition: parent.params || null, specificity: null }, isGlobal: false };
  }

  return GLOBAL_RESULT;
}

/**
 * Processes @layer declarations to establish cascade layer ordering.
 * @param graph - The CSS graph
 */
function processLayerOrdering(graph: CSSGraph): void {
  if (graph.layers.length === 0) return;

  const sortedLayers = graph.layers.toSorted((a, b) => a.sourceOrder - b.sourceOrder);

  let layerIndex = 0;
  for (let i = 0; i < sortedLayers.length; i++) {
    const layerRule = sortedLayers[i];
    if (!layerRule) continue;
    const params = layerRule.parsedParams;

    if (params.layerNames) {
      for (let j = 0; j < params.layerNames.length; j++) {
        const layerName = params.layerNames[j];
        if (!layerName) continue;
        if (!graph.layerOrder.has(layerName)) {
          graph.registerLayerOrder(layerName, layerIndex++);
        }
      }
    } else if (params.layerName && !graph.layerOrder.has(params.layerName)) {
      graph.registerLayerOrder(params.layerName, layerIndex++);
    }
  }
}
