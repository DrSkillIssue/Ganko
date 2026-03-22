/**
 * Phase 6: SCSS-Specific Processing
 *
 * Processes SCSS-specific constructs including mixins, functions,
 * placeholders, and @extend directives.
 */

import type { AtRule, Rule, ChildNode } from "postcss";
import type { CSSBuildContext } from "../build-context"
import type { CSSInput } from "../input";
import type {
  MixinEntity,
  MixinIncludeEntity,
  SCSSFunctionEntity,
  FunctionCallEntity,
  PlaceholderEntity,
  ExtendEntity,
  RuleEntity,
  FileEntity,
  DeclarationEntity,
  MixinParameter,
  FunctionParameter,
  MixinArgument,
  ReturnStatement,
} from "../entities";
import {
  MIXIN_HAS_REST_PARAM, MIXIN_HAS_CONTENT_BLOCK, MIXIN_IS_USED,
  INCLUDE_HAS_CONTENT_BLOCK, INCLUDE_IS_RESOLVED,
  FCALL_IS_BUILTIN, FCALL_IS_RESOLVED,
  SCSSFN_IS_USED,
  PLACEHOLDER_IS_USED,
  EXTEND_IS_OPTIONAL, EXTEND_IS_RESOLVED,
  setFlag,
} from "../entities";
import {
  CHAR_OPEN_PAREN,
  CHAR_CLOSE_PAREN,
  CHAR_PERCENT,
  FUNCTION_CALL_RE,
  splitParameters,
  endsWithCaseInsensitive,
} from "@drskillissue/ganko-shared";

const SCSS_BUILTIN_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb",
  "adjust-hue", "lighten", "darken", "saturate", "desaturate",
  "grayscale", "complement", "invert", "alpha", "opacity",
  "red", "green", "blue", "hue", "saturation", "lightness",
  "adjust-color", "scale-color", "change-color", "ie-hex-str",
  "mix", "color.adjust", "color.scale", "color.change",
  "quote", "unquote", "str-length", "str-insert", "str-index",
  "str-slice", "to-upper-case", "to-lower-case", "unique-id",
  "percentage", "round", "ceil", "floor", "abs", "min", "max",
  "random", "unit", "unitless", "comparable",
  "length", "nth", "set-nth", "join", "append", "zip", "index",
  "list-separator", "is-bracketed",
  "map-get", "map-merge", "map-remove", "map-keys", "map-values",
  "map-has-key",
  "selector-nest", "selector-append", "selector-extend",
  "selector-replace", "selector-unify", "is-superselector",
  "simple-selectors", "selector-parse",
  "type-of", "unit", "unitless", "comparable", "call",
  "variable-exists", "global-variable-exists", "function-exists",
  "mixin-exists", "inspect", "content-exists", "feature-exists",
  "if", "unique-id",
]);

const FUNCTION_CALL_PATTERN = FUNCTION_CALL_RE;

const EMPTY_EXTRACTED_CALLS: Array<{ name: string; args: string[]; sourceIndex: number }> = [];

export function runScssPhase(graph: CSSBuildContext, _input: CSSInput): void {
    if (!graph.hasScssFiles) return;

    const scssFiles: FileEntity[] = [];
    for (const f of graph.files) {
      if (f.syntax === "scss" || f.syntax === "sass") {
        scssFiles.push(f);
      }
    }

    if (scssFiles.length === 0) return;

    for (const file of scssFiles) {
      collectScssDefinitions(graph, file);
    }

    for (const include of graph.includes) {
      const mixin = graph.mixinsByName.get(include.name);
      if (mixin) {
        include.resolvedMixin = mixin;
        include._flags = setFlag(include._flags, INCLUDE_IS_RESOLVED);
        mixin.includes.push(include);
      }
    }

    for (const extend of graph.extends) {
      const { placeholder, rule } = resolveExtendTarget(graph, extend.selector);
      if (placeholder) {
        extend.resolvedPlaceholder = placeholder;
        extend._flags = setFlag(extend._flags, EXTEND_IS_RESOLVED);
        placeholder.extends.push(extend);
      } else if (rule) {
        extend.resolvedRule = rule;
        extend._flags = setFlag(extend._flags, EXTEND_IS_RESOLVED);
      }
    }

    const scssFileIds = new Set<number>();
    for (const f of scssFiles) scssFileIds.add(f.id);

    for (const decl of graph.declarations) {
      if (!scssFileIds.has(decl.file.id)) continue;

      const functionCalls = extractSCSSFunctionCalls(decl.value);
      if (functionCalls.length === 0) continue;

      const file = decl.file;
      for (const call of functionCalls) {
        const fnEntity = createFunctionCallEntity(graph, call, decl, file);
        graph.addFunctionCall(fnEntity);

        if (fnEntity.resolvedFunction) {
          fnEntity.resolvedFunction.calls.push(fnEntity);
        }
      }
    }

    markUnusedEntities(graph);
}

/**
 * Parses an @mixin definition.
 * @param graph - The CSS graph
 * @param node - The @mixin at-rule node
 * @param file - The file containing the mixin
 * @returns The parsed mixin entity
 */
function parseMixin(
  graph: CSSBuildContext,
  node: AtRule,
  file: FileEntity,
): MixinEntity {
  const { name, params } = parseMixinName(node.params);
  const { parameters, hasRestParam } = parseMixinParameters(params);
  const hasContentBlock = hasContentBlockUsage(node);

  return {
    id: graph.nextMixinId(),
    name,
    node,
    file,
    parameters,
    _flags: (hasRestParam ? MIXIN_HAS_REST_PARAM : 0) | (hasContentBlock ? MIXIN_HAS_CONTENT_BLOCK : 0),
    declarations: [],
    rules: [],
    includes: [],
    startLine: node.source?.start?.line ?? 0,
    endLine: node.source?.end?.line ?? 0,
  };
}

/**
 * Parses mixin name and parameters from params string.
 * @param params - The @mixin params string
 * @returns Object with name and parameters string
 */
function parseMixinName(params: string): { name: string; params: string } {
  const trimmed = params.trim();
  const parenIndex = trimmed.indexOf("(");

  if (parenIndex === -1) {
    return { name: trimmed, params: "" };
  }

  return {
    name: trimmed.slice(0, parenIndex).trim(),
    params: trimmed.slice(parenIndex + 1, -1),
  };
}

interface ParsedMixinParameters {
  readonly parameters: MixinParameter[];
  readonly hasRestParam: boolean;
}

const EMPTY_PARSED_PARAMS: ParsedMixinParameters = {
  parameters: [],
  hasRestParam: false,
};

/**
 * Parses mixin parameters from a parameters string.
 * @param params - The parameters string inside parentheses
 * @returns Object with parsed parameters and hasRestParam flag
 */
function parseMixinParameters(params: string): ParsedMixinParameters {
  const trimmed = params.trim();
  if (!trimmed) {
    return EMPTY_PARSED_PARAMS;
  }

  const result: MixinParameter[] = [];
  const parts = splitParameters(params);
  let hasRestParam = false;

  for (const part of parts) {
    const partTrimmed = part.trim();
    if (!partTrimmed) continue;

    const isRest = partTrimmed.endsWith("...");
    if (isRest) hasRestParam = true;
    const cleaned = isRest ? partTrimmed.slice(0, -3) : partTrimmed;
    const colonIndex = cleaned.indexOf(":");

    if (colonIndex === -1) {
      result.push({
        name: cleaned.trim(),
        defaultValue: null,
        isRest,
      });
    } else {
      result.push({
        name: cleaned.slice(0, colonIndex).trim(),
        defaultValue: cleaned.slice(colonIndex + 1).trim(),
        isRest,
      });
    }
  }

  return { parameters: result, hasRestParam };
}

/**
 * Parses an @include directive without resolving the mixin.
 * @param graph - The CSS graph
 * @param node - The @include at-rule node
 * @param file - The file containing the include
 * @param rule - The parent rule if any
 * @returns The parsed include entity
 */
function parseIncludeDeferred(
  graph: CSSBuildContext,
  node: AtRule,
  file: FileEntity,
  rule: RuleEntity | null,
): MixinIncludeEntity {
  const { name, params } = parseMixinName(node.params);
  const args = parseIncludeArguments(params);
  const hasContentBlock = node.nodes !== undefined && node.nodes.length > 0;

  return {
    id: graph.nextIncludeId(),
    name,
    node,
    file,
    arguments: args,
    _flags: hasContentBlock ? INCLUDE_HAS_CONTENT_BLOCK : 0,
    resolvedMixin: null,
    rule,
    atRule: null,
  };
}

/**
 * Parses @include arguments from a parameters string.
 * @param params - The arguments string inside parentheses
 * @returns Array of parsed arguments
 */
function parseIncludeArguments(params: string): MixinArgument[] {
  const trimmed = params.trim();
  if (!trimmed) {
    return [];
  }

  const result: MixinArgument[] = [];
  const parts = splitParameters(params);

  for (const part of parts) {
    const partTrimmed = part.trim();
    if (!partTrimmed) continue;

    const colonIndex = partTrimmed.indexOf(":");
    if (colonIndex === -1) {
      result.push({
        name: null,
        value: partTrimmed,
        isNamed: false,
      });
    } else {
      result.push({
        name: partTrimmed.slice(0, colonIndex).trim(),
        value: partTrimmed.slice(colonIndex + 1).trim(),
        isNamed: true,
      });
    }
  }

  return result;
}

/**
 * Parses an @function definition.
 * @param graph - The CSS graph
 * @param node - The @function at-rule node
 * @param file - The file containing the function
 * @returns The parsed function entity
 */
function parseFunction(
  graph: CSSBuildContext,
  node: AtRule,
  file: FileEntity,
): SCSSFunctionEntity {
  const { name, params } = parseMixinName(node.params);
  const parameters = parseFunctionParameters(params);
  const returnStatements = findReturnStatements(node);

  return {
    id: graph.nextFunctionId(),
    name,
    node,
    file,
    parameters,
    returnStatements,
    calls: [],
    _flags: 0,
    startLine: node.source?.start?.line ?? 0,
    endLine: node.source?.end?.line ?? 0,
  };
}

/**
 * Parses function parameters from a parameters string.
 * @param params - The parameters string inside parentheses
 * @returns Array of parsed parameters
 */
function parseFunctionParameters(params: string): FunctionParameter[] {
  const trimmed = params.trim();
  if (!trimmed) {
    return [];
  }

  const result: FunctionParameter[] = [];
  const parts = splitParameters(params);

  for (const part of parts) {
    const partTrimmed = part.trim();
    if (!partTrimmed) continue;

    const colonIndex = partTrimmed.indexOf(":");
    if (colonIndex === -1) {
      result.push({
        name: partTrimmed,
        defaultValue: null,
      });
    } else {
      result.push({
        name: partTrimmed.slice(0, colonIndex).trim(),
        defaultValue: partTrimmed.slice(colonIndex + 1).trim(),
      });
    }
  }

  return result;
}

/**
 * Parses a %placeholder selector.
 * @param graph - The CSS graph
 * @param node - The placeholder rule node
 * @param file - The file containing the placeholder
 * @returns The parsed placeholder entity
 */
function parsePlaceholder(
  graph: CSSBuildContext,
  node: Rule,
  file: FileEntity,
): PlaceholderEntity {
  return {
    id: graph.nextPlaceholderId(),
    name: node.selector.slice(1),
    node,
    file,
    declarations: [],
    extends: [],
    _flags: 0,
    startLine: node.source?.start?.line ?? 0,
    endLine: node.source?.end?.line ?? 0,
  };
}

/**
 * Parses an @extend directive without resolving the target.
 * @param graph - The CSS graph
 * @param node - The @extend at-rule node
 * @param file - The file containing the extend
 * @param rule - The parent rule
 * @returns The parsed extend entity
 */
function parseExtendDeferred(
  graph: CSSBuildContext,
  node: AtRule,
  file: FileEntity,
  rule: RuleEntity,
): ExtendEntity {
  let selector = node.params.trim();
  const isOptional = endsWithCaseInsensitive(selector, "!optional");
  if (isOptional) {
    selector = selector.slice(0, -9).trim();
  }

  return {
    id: graph.nextExtendId(),
    selector,
    node,
    file,
    rule,
    resolvedPlaceholder: null,
    resolvedRule: null,
    _flags: isOptional ? EXTEND_IS_OPTIONAL : 0,
  };
}

/**
 * Resolves the target of an @extend directive.
 * @param graph - The CSS graph
 * @param selector - The selector to extend
 * @returns Object with resolved placeholder and/or rule
 */
function resolveExtendTarget(
  graph: CSSBuildContext,
  selector: string,
): { placeholder: PlaceholderEntity | null; rule: RuleEntity | null } {
  if (selector.charCodeAt(0) === CHAR_PERCENT) {
    const placeholder = graph.placeholdersByName.get(selector.slice(1)) ?? null;
    return { placeholder, rule: null };
  }

  const rules = graph.rulesBySelector.get(selector);
  if (rules && rules.length > 0) {
    const firstRule = rules[0];
    if (firstRule) return { placeholder: null, rule: firstRule };
  }

  return { placeholder: null, rule: null };
}

/** Extracts mixin, function, include, extend, and placeholder definitions from a single SCSS file. */
function collectScssDefinitions(graph: CSSBuildContext, file: FileEntity): void {
  walkNodes(file.node, (node, parent) => {
    if (node.type === "atrule") {
      const name = node.name;

      if (name === "mixin") {
        graph.addMixin(parseMixin(graph, node, file));
      } else if (name === "function") {
        graph.addFunction(parseFunction(graph, node, file));
      } else if (name === "include") {
        const parentRule = findParentRule(parent, graph);
        graph.addMixinInclude(parseIncludeDeferred(graph, node, file, parentRule));
      } else if (name === "extend") {
        const parentRule = findParentRule(parent, graph);
        if (parentRule) {
          graph.addExtend(parseExtendDeferred(graph, node, file, parentRule));
        }
      }
    } else if (node.type === "rule" && node.selector.charCodeAt(0) === CHAR_PERCENT) {
      graph.addPlaceholder(parsePlaceholder(graph, node, file));
    }
  });
}

/**
 * Walks all nodes in a PostCSS root.
 * @param root - The PostCSS root or node containing child nodes
 * @param callback - Function called for each node with the node and its parent
 * @param parent - The parent node
 */
function walkNodes(
  root: { nodes?: ChildNode[] | undefined },
  callback: (node: ChildNode, parent: ChildNode | null) => void,
  parent: ChildNode | null = null,
): void {
  const nodes = root.nodes;
  if (!nodes) return;

  for (const node of nodes) {
    callback(node, parent);
    if ("nodes" in node) {
      walkNodes(node, callback, node);
    }
  }
}

/**
 * Checks if a mixin uses @content.
 * @param node - The @mixin at-rule node to check
 * @returns True if the mixin contains @content directive
 */
function hasContentBlockUsage(node: AtRule): boolean {
  const nodes = node.nodes;
  if (!nodes) return false;

  for (const child of nodes) {
    if (child.type === "atrule" && child.name === "content") {
      return true;
    }
    if (child.type === "atrule" && hasContentBlockUsage(child)) {
      return true;
    }
  }

  return false;
}

/**
 * Finds @return statements in a function body.
 * @param node - The @function at-rule node
 * @returns Array of return statements found in the function
 */
function findReturnStatements(node: AtRule): ReturnStatement[] {
  const returns: ReturnStatement[] = [];

  function walk(n: { nodes?: ChildNode[] | undefined }): void {
    const nodes = n.nodes;
    if (!nodes) return;

    for (const child of nodes) {
      if (child.type === "atrule" && child.name === "return") {
        returns.push({
          node: child,
          value: child.params,
        });
      }
      if ("nodes" in child) {
        walk(child);
      }
    }
  }

  walk(node);
  return returns;
}

/**
 * Finds the parent rule for an at-rule.
 * @param parent - The parent node
 * @param graph - The CSS graph containing rule mappings
 * @returns The parent rule entity, or null if not found
 */
function findParentRule(
  parent: ChildNode | null,
  graph: CSSBuildContext,
): RuleEntity | null {
  if (!parent || parent.type !== "rule") return null;
  return graph.rulesByNode.get(parent) ?? null;
}

/**
 * Extracts SCSS function calls from a value string.
 * @param value - The CSS value string to parse
 * @returns Array of function call objects with name, args, and source index
 */
function extractSCSSFunctionCalls(value: string): Array<{ name: string; args: string[]; sourceIndex: number }> {
  if (value.indexOf("(") === -1) return EMPTY_EXTRACTED_CALLS;

  FUNCTION_CALL_PATTERN.lastIndex = 0;

  const calls: Array<{ name: string; args: string[]; sourceIndex: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = FUNCTION_CALL_PATTERN.exec(value)) !== null) {
    const name = match[1];
    if (!name) continue;
    const startIndex = match.index + match[0].length;
    const valueLen = value.length;

    let depth = 1;
    let endIndex = startIndex;
    for (let i = startIndex; i < valueLen; i++) {
      const char = value.charCodeAt(i);
      if (char === CHAR_OPEN_PAREN) {
        depth++;
      } else if (char === CHAR_CLOSE_PAREN) {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    const argsString = value.slice(startIndex, endIndex);
    const args = splitParameters(argsString).map((a) => a.trim());

    calls.push({
      name,
      args,
      sourceIndex: match.index,
    });
  }

  return calls;
}

/**
 * Creates a function call entity.
 * @param graph - The CSS graph
 * @param call - The parsed function call data
 * @param decl - The declaration containing the function call
 * @param file - The file containing the function call
 * @returns The created function call entity
 */
function createFunctionCallEntity(
  graph: CSSBuildContext,
  call: { name: string; args: string[]; sourceIndex: number },
  decl: DeclarationEntity,
  file: FileEntity,
): FunctionCallEntity {
  const isBuiltIn = SCSS_BUILTIN_FUNCTIONS.has(call.name.toLowerCase());
  const resolvedFunction = graph.functionsByName.get(call.name) ?? null;

  return {
    id: graph.nextFunctionCallId(),
    name: call.name,
    declaration: decl,
    file,
    arguments: call.args,
    resolvedFunction,
    _flags: (isBuiltIn ? FCALL_IS_BUILTIN : 0) | ((isBuiltIn || resolvedFunction !== null) ? FCALL_IS_RESOLVED : 0),
    sourceIndex: call.sourceIndex,
  };
}

/**
 * Marks unused SCSS entities and populates tracking arrays.
 * @param graph - The CSS graph containing SCSS entities
 */
function markUnusedEntities(graph: CSSBuildContext): void {
  const mixins = graph.mixins;
  const unusedMixins = graph.unusedMixins;
  for (let i = 0; i < mixins.length; i++) {
    const mixin = mixins[i];
    if (!mixin) continue;
    const isUsed = mixin.includes.length > 0;
    mixin._flags = isUsed ? setFlag(mixin._flags, MIXIN_IS_USED) : mixin._flags;
    if (!isUsed) unusedMixins.push(mixin);
  }

  const functions = graph.functions;
  const unusedFunctions = graph.unusedFunctions;
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    if (!fn) continue;
    const isUsed = fn.calls.length > 0;
    fn._flags = isUsed ? setFlag(fn._flags, SCSSFN_IS_USED) : fn._flags;
    if (!isUsed) unusedFunctions.push(fn);
  }

  const placeholders = graph.placeholders;
  const unusedPlaceholders = graph.unusedPlaceholders;
  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    if (!placeholder) continue;
    const isUsed = placeholder.extends.length > 0;
    placeholder._flags = isUsed ? setFlag(placeholder._flags, PLACEHOLDER_IS_USED) : placeholder._flags;
    if (!isUsed) unusedPlaceholders.push(placeholder);
  }
}
