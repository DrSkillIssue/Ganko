/**
 * Phase 3: Variable Reference Linking
 *
 * Links var() references to variable definitions.
 */

import type { CSSBuildContext } from "../build-context"
import type { CSSInput } from "../input";
import type {
  VariableReferenceEntity,
  DeclarationEntity,
  VariableEntity,
  FileEntity,
  RuleEntity,
} from "../entities";
import {
  EMPTY_VARIABLE_REFS,
  REF_IS_RESOLVED,
  VAR_IS_USED,
  setFlag,
} from "../entities";
import { extractVarReferences, type VarReference } from "../parser/value";
import { getContainingAtRule } from "../queries/context";

const MAX_FALLBACK_DEPTH = 10;

// TODO REPLACE WITH FUNCTION / CSSBuildContext
/**
 * Resolve var() references to variable definitions.
 * @param graph CSS graph
 * @param input CSS input
 */
export function runReferencesPhase(graph: CSSBuildContext, _input: CSSInput): void {
    if (graph.declarations.length === 0) {
      return;
    }

    const declarations = graph.declarations;

    for (let i = 0; i < declarations.length; i++) {
      const declaration = declarations[i];
      if (!declaration) continue;
      const file = declaration.file;
      const refs = declaration.parsedVarRefs;
      const declVarRefs = declaration.variableRefs;

      for (let j = 0; j < refs.length; j++) {
        const ref = refs[j];
        if (!ref) continue;
        const refEntity = createAndResolveReference(graph, ref, declaration, file, 0);
        graph.addVariableRef(refEntity);
        declVarRefs.push(refEntity);
      }
    }

    graph.buildUnusedIndexes();
}

/**
 * Creates a variable reference entity and resolves it to its definition.
 * @param graph - The CSS graph
 * @param ref - The variable reference to resolve
 * @param declaration - The declaration containing the reference
 * @param file - The file entity
 * @param depth - The current fallback chain depth
 * @returns The created and resolved VariableReferenceEntity
 */
function createAndResolveReference(
  graph: CSSBuildContext,
  ref: VarReference,
  declaration: DeclarationEntity,
  file: FileEntity,
  depth: number,
): VariableReferenceEntity {
  const id = graph.nextVariableRefId();

  let fallbackRefs: VariableReferenceEntity[];
  if (ref.fallback && depth < MAX_FALLBACK_DEPTH) {
    const parsed = parseFallbackChainResolved(graph, ref.fallback, declaration, file, depth + 1);
    fallbackRefs = parsed.length > 0 ? parsed : EMPTY_VARIABLE_REFS;
  } else {
    fallbackRefs = EMPTY_VARIABLE_REFS;
  }

  const name = graph.intern(ref.name);
  const resolvedVariable = resolveVariableForDeclaration(graph, name, declaration);

  const refEntity: VariableReferenceEntity = {
    id,
    name,
    declaration,
    file,
    resolvedVariable,
    _flags: resolvedVariable !== null ? REF_IS_RESOLVED : 0,
    fallback: ref.fallback,
    fallbackReferences: fallbackRefs,
    fallbackChainDepth: depth,
    sourceIndex: ref.sourceIndex,
    raw: ref.raw,
  };

  if (resolvedVariable !== null) {
    resolvedVariable.references.push(refEntity);
    resolvedVariable._flags = setFlag(resolvedVariable._flags, VAR_IS_USED);
  }

  return refEntity;
}

interface DeclarationResolutionContext {
  readonly filePath: string;
  readonly rule: RuleEntity | null;
  readonly selector: string | null;
  readonly media: string | null;
  readonly supports: string | null;
  readonly layer: string | null;
}

function resolveVariableForDeclaration(
  graph: CSSBuildContext,
  name: string,
  declaration: DeclarationEntity,
): VariableEntity | null {
  const variables = graph.variablesByName.get(name);
  if (!variables || variables.length === 0) return null;

  const context = getDeclarationResolutionContext(declaration);
  let best: VariableEntity | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < variables.length; i++) {
    const variable = variables[i];
    if (!variable) continue;
    if (!isScopeCompatible(variable, context)) continue;

    const score = resolutionScore(variable, context);
    if (score > bestScore) {
      best = variable;
      bestScore = score;
    }
  }

  return best;
}

function getDeclarationResolutionContext(declaration: DeclarationEntity): DeclarationResolutionContext {
  const rule = declaration.rule;
  if (!rule) {
    return {
      filePath: declaration.file.path,
      rule: null,
      selector: null,
      media: null,
      supports: null,
      layer: null,
    };
  }

  const supports = getContainingAtRule(rule, "supports")?.params ?? null;

  return {
    filePath: declaration.file.path,
    rule,
    selector: rule.selectorText,
    media: rule.containingMedia?.params ?? null,
    supports,
    layer: rule.containingLayer?.params ?? null,
  };
}

function isScopeCompatible(variable: VariableEntity, context: DeclarationResolutionContext): boolean {
  const type = variable.scope.type;

  if (type === "global") return true;
  if (variable.file.path !== context.filePath) return false;

  if (type === "selector") {
    if (!context.selector) return false;
    if (variable.scope.condition === context.selector) return true;
    if (isAncestorRuleSelector(context.rule, variable.scope.condition)) return true;
    return isDescendantSelectorOf(context.selector, variable.scope.condition);
  }

  if (type === "media") return variable.scope.condition === context.media;
  if (type === "supports") return variable.scope.condition === context.supports;
  if (type === "layer") return variable.scope.condition === context.layer;

  return false;
}

/**
 * Checks whether a variable's defining selector is an ancestor of the reference's rule.
 * CSS custom properties cascade from parent to child, so a variable defined in a parent
 * selector is available to all nested child selectors within the same rule block.
 */
function isAncestorRuleSelector(rule: RuleEntity | null, variableSelectorCondition: string | null): boolean {
  if (variableSelectorCondition === null) return false;

  let current: RuleEntity["parent"] = rule?.parent ?? null;
  while (current !== null) {
    if (current.kind === "rule" && current.selectorText === variableSelectorCondition) return true;
    current = current.parent;
  }

  return false;
}

/**
 * Checks whether the reference selector is a descendant selector that begins with
 * the variable's defining selector. In CSS, custom properties cascade from ancestors
 * to descendants in the DOM tree. If selector A defines `--x` and selector B is
 * `A [data-slot="y"]`, then `--x` cascades from elements matching A to children
 * matching `[data-slot="y"]`.
 *
 * We verify that the character immediately after the prefix is a descendant combinator
 * (space) or child combinator (` >`), ensuring this is a genuine ancestor–descendant
 * relationship, not a coincidental prefix overlap.
 */
function isDescendantSelectorOf(referenceSelector: string, variableSelector: string | null): boolean {
  if (variableSelector === null) return false;
  const prefixLen = variableSelector.length;
  if (referenceSelector.length <= prefixLen) return false;
  if (!referenceSelector.startsWith(variableSelector)) return false;

  // The character immediately after the variable's selector determines the relationship:
  //  - Whitespace (space/tab): descendant combinator → variable is on an ancestor element
  //  - `[`, `.`, `#`, `:`: compound selector refinement → variable is on the same element
  //    with additional constraints (e.g. [data-component="X"][data-state="open"])
  //  - `>`, `~`, `+`: child/sibling combinators → variable is on a parent/sibling
  // All of these are valid scope relationships for CSS custom property inheritance.
  const charAfter = referenceSelector.charCodeAt(prefixLen);
  return (
    charAfter === 0x20 /* space */ ||
    charAfter === 0x09 /* tab */ ||
    charAfter === 0x5B /* [ */ ||
    charAfter === 0x2E /* . */ ||
    charAfter === 0x23 /* # */ ||
    charAfter === 0x3A /* : */ ||
    charAfter === 0x3E /* > */ ||
    charAfter === 0x7E /* ~ */ ||
    charAfter === 0x2B /* + */
  );
}

function resolutionScore(variable: VariableEntity, context: DeclarationResolutionContext): number {
  let score = 0;

  if (variable.file.path === context.filePath) score += 10_000;

  if (variable.scope.type === "selector") score += 4_000;
  if (variable.scope.type === "media") score += 3_000;
  if (variable.scope.type === "supports") score += 3_000;
  if (variable.scope.type === "layer") score += 3_000;
  if (variable.scope.type === "global") score += 1_000;

  score += variable.declaration.cascadePosition.specificityScore;
  score += variable.declaration.sourceOrder / 10_000;

  return score;
}

/**
 * Parses and resolves var() references in a fallback value chain.
 * @param graph - The CSS graph
 * @param fallback - The fallback value string
 * @param declaration - The declaration containing the reference
 * @param file - The file entity
 * @param depth - The current fallback chain depth
 * @returns Array of resolved variable references
 */
function parseFallbackChainResolved(
  graph: CSSBuildContext,
  fallback: string,
  declaration: DeclarationEntity,
  file: FileEntity,
  depth: number,
): VariableReferenceEntity[] {
  if (depth >= MAX_FALLBACK_DEPTH) {
    return [];
  }

  const refs = extractVarReferences(fallback);
  if (refs.length === 0) {
    return [];
  }

  const refEntities: VariableReferenceEntity[] = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref) continue;
    const refEntity = createAndResolveReference(graph, ref, declaration, file, depth);
    graph.addVariableRef(refEntity);
    refEntities.push(refEntity);
  }

  return refEntities;
}
