/**
 * At-rule query functions (media, keyframes, layers, etc.)
 */
import type { CSSWorkspaceView as CSSGraph } from "../workspace-view"
import type { AtRuleEntity, RuleEntity, DeclarationEntity, AtRuleKind } from "../entities";

export function getKeyframeByName(graph: CSSGraph, name: string): AtRuleEntity | null {
  const keyframes = graph.keyframes;
  for (let i = 0, len = keyframes.length; i < len; i++) {
    const kf = keyframes[i];
    if (!kf) continue;
    if (kf.parsedParams.animationName === name) {
      return kf;
    }
  }
  return null;
}

export function getMediaQueriesForCondition(
  graph: CSSGraph,
  mediaType: "all" | "screen" | "print" | "speech",
): readonly AtRuleEntity[] {
  const result: AtRuleEntity[] = [];
  const queries = graph.mediaQueries;
  for (let i = 0, len = queries.length; i < len; i++) {
    const query = queries[i];
    if (!query) continue;
    const conditions = query.parsedParams.mediaConditions;
    if (conditions) {
      for (let j = 0, clen = conditions.length; j < clen; j++) {
        const cond = conditions[j];
        if (cond && cond.type === mediaType) {
          result.push(query);
          break;
        }
      }
    }
  }
  return result;
}

export function getLayerByName(graph: CSSGraph, name: string): AtRuleEntity | null {
  const layers = graph.layers;
  for (let i = 0, len = layers.length; i < len; i++) {
    const layer = layers[i];
    if (!layer) continue;
    if (layer.parsedParams.layerName === name) {
      return layer;
    }
  }
  return null;
}

export function getRulesInAtRule(_graph: CSSGraph, atRule: AtRuleEntity): readonly RuleEntity[] {
  return atRule.rules;
}

export function getDeclarationsInAtRule(_graph: CSSGraph, atRule: AtRuleEntity): readonly DeclarationEntity[] {
  return atRule.declarations;
}

export function getNestedAtRules(_graph: CSSGraph, atRule: AtRuleEntity): readonly AtRuleEntity[] {
  return atRule.nestedAtRules;
}

export function getAtRuleDepth(_graph: CSSGraph, atRule: AtRuleEntity): number {
  return atRule.depth;
}

export function isAtRuleKind(_graph: CSSGraph, atRule: AtRuleEntity, kind: AtRuleKind): boolean {
  return atRule.kind === kind;
}
