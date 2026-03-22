/**
 * Phase 5: Override/Shadow Analysis
 *
 * Analyzes cascade relationships between declarations and variables.
 * Determines which declarations override others and which variables
 * shadow other variables.
 */
import type { CSSBuildContext } from "../build-context"
import type { CSSInput } from "../input";
import type { DeclarationEntity, VariableEntity } from "../entities";
import { hasFlag, DECL_IS_IMPORTANT, VAR_IS_GLOBAL } from "../entities";
import { extractKeyframeNames } from "@drskillissue/ganko-shared";

/**
 * Build declaration override and variable shadow relationships.
 * @param graph CSS graph
 * @param input CSS input options
 */
export function runCascadePhase(graph: CSSBuildContext, input: CSSInput): void {
  if (input.options?.analyzeCascade === false) return;

  for (const declarations of graph.declarationsByProperty.values()) {
    if (declarations.length > 1) {
      analyzeDeclarationOverrides(declarations);
    }
  }

  for (const variables of graph.variablesByName.values()) {
    if (variables.length > 1) {
      analyzeVariableShadows(variables);
    }
  }

  detectUnusedKeyframes(graph);
};

/**
 * Analyzes override relationships between declarations of the same property.
 * @param declarations - Declarations with the same property
 */
function analyzeDeclarationOverrides(declarations: DeclarationEntity[]): void {
  const len = declarations.length;
  if (len === 0) return;

  declarations.sort((a, b) => {
    if (hasFlag(a._flags, DECL_IS_IMPORTANT) !== hasFlag(b._flags, DECL_IS_IMPORTANT)) {
      return hasFlag(a._flags, DECL_IS_IMPORTANT) ? 1 : -1;
    }

    const aLayerOrder = a.cascadePosition.layerOrder;
    const bLayerOrder = b.cascadePosition.layerOrder;
    if (aLayerOrder !== bLayerOrder) {
      const layerDiff = aLayerOrder - bLayerOrder;
      return hasFlag(a._flags, DECL_IS_IMPORTANT) ? -layerDiff : layerDiff;
    }

    const aSpecScore = a.cascadePosition.specificityScore;
    const bSpecScore = b.cascadePosition.specificityScore;
    if (aSpecScore !== bSpecScore) {
      return aSpecScore - bSpecScore;
    }

    return a.sourceOrder - b.sourceOrder;
  });

  for (let i = 1; i < len; i++) {
    const current = declarations[i];
    if (!current) continue;
    for (let j = 0; j < i; j++) {
      const previous = declarations[j];
      if (!previous) continue;
      current.overrides.push(previous);
      previous.overriddenBy.push(current);
    }
  }
}

/**
 * Analyzes shadow relationships between variables of the same name.
 * @param variables - Variables with the same name
 */
function analyzeVariableShadows(variables: VariableEntity[]): void {
  const len = variables.length;
  if (len === 0) return;

  variables.sort((a, b) => {
    if (hasFlag(a._flags, VAR_IS_GLOBAL) !== hasFlag(b._flags, VAR_IS_GLOBAL)) {
      return hasFlag(a._flags, VAR_IS_GLOBAL) ? -1 : 1;
    }

    const aSpecScore = a.scopeSelector?.specificityScore ?? 0;
    const bSpecScore = b.scopeSelector?.specificityScore ?? 0;
    if (aSpecScore !== bSpecScore) {
      return aSpecScore - bSpecScore;
    }

    return a.declaration.sourceOrder - b.declaration.sourceOrder;
  });

  for (let i = 1; i < len; i++) {
    const current = variables[i];
    if (!current) continue;
    for (let j = 0; j < i; j++) {
      const previous = variables[j];
      if (!previous) continue;
      current.shadows.push(previous);
      previous.shadowedBy.push(current);
    }
  }
}

/**
 * Detects unused @keyframes rules.
 * @param graph - The CSS graph
 */
function detectUnusedKeyframes(graph: CSSBuildContext): void {
  const keyframes = graph.keyframes;
  if (keyframes.length === 0) return;

  const usedAnimationNames = new Set<string>();
  const animationDecls = graph.declarationsByProperty.get("animation");
  const animationNameDecls = graph.declarationsByProperty.get("animation-name");

  if (animationNameDecls) {
    for (let i = 0; i < animationNameDecls.length; i++) {
      const decl = animationNameDecls[i];
      if (!decl) continue;
      const names = extractKeyframeNames(decl.value, "animation-name");
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        if (!name) continue;
        usedAnimationNames.add(name);
      }
    }
  }

  if (animationDecls) {
    for (let i = 0; i < animationDecls.length; i++) {
      const decl = animationDecls[i];
      if (!decl) continue;
      const names = extractKeyframeNames(decl.value, "animation");
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        if (!name) continue;
        usedAnimationNames.add(name);
      }
    }
  }

  /* Trace keyframe names through resolved CSS custom property references.
     Pattern: `--animate-shimmer: shimmer 1.5s linear infinite;`
     used via `animation: var(--animate-shimmer);`
     extractKeyframeNames skips var() calls, so for each var() reference
     in an animation property, resolve the variable and extract names
     from its declaration value. */
  for (const ref of graph.variableRefs) {
    const resolvedVar = ref.resolvedVariable;
    if (!resolvedVar) continue;
    const prop = ref.declaration.property.toLowerCase();
    if (prop !== "animation" && prop !== "animation-name") continue;

    const names = extractKeyframeNames(resolvedVar.declaration.value, prop);
    for (let j = 0; j < names.length; j++) {
      const n = names[j];
      if (!n) continue;
      usedAnimationNames.add(n);
    }
  }

  /* Scan at-rules whose declarations are not indexed (e.g. Tailwind @utility)
     for animation references. These at-rules have child declaration nodes in the
     PostCSS AST, but they were not registered via processDeclaration because
     their at-rule kind does not support standard declaration indexing (to avoid
     false positives from @theme and other framework-specific at-rules). */
  for (let i = 0; i < graph.atRules.length; i++) {
    const atRule = graph.atRules[i];
    if (!atRule) continue;
    if (atRule.declarations.length > 0) continue; // already indexed
    const nodes = atRule.node.nodes;
    if (!nodes) continue;
    for (let j = 0; j < nodes.length; j++) {
      const child = nodes[j];
      if (!child) continue;
      if (child.type !== "decl") continue;
      const prop = child.prop.toLowerCase();
      if (prop !== "animation" && prop !== "animation-name") continue;
      const childNames = extractKeyframeNames(child.value, prop);
      for (let k = 0; k < childNames.length; k++) {
        const cn = childNames[k];
        if (!cn) continue;
        usedAnimationNames.add(cn);
      }
    }
  }

  const unusedKeyframes = graph.unusedKeyframes;
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    if (!kf) continue;
    const name = kf.parsedParams.animationName ?? kf.params.trim();
    if (!usedAnimationNames.has(name)) {
      unusedKeyframes.push(kf);
    }
  }
}
