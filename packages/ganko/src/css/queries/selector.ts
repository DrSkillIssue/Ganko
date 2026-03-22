/**
 * Selector-specific query functions
 */
import type { CSSWorkspaceView as CSSGraph } from "../workspace-view"
import type { SelectorEntity, RuleEntity } from "../entities";

export function getSelectorsBySpecificityRange(
  graph: CSSGraph,
  minScore: number,
  maxScore: number,
): readonly SelectorEntity[] {
  const result: SelectorEntity[] = [];
  const selectors = graph.selectors;
  for (let i = 0, len = selectors.length; i < len; i++) {
    const sel = selectors[i];
    if (!sel) continue;
    if (sel.specificityScore >= minScore && sel.specificityScore <= maxScore) {
      result.push(sel);
    }
  }
  return result;
}

export function getHighSpecificitySelectors(
  graph: CSSGraph,
  threshold: number = 10000,
): readonly SelectorEntity[] {
  const result: SelectorEntity[] = [];
  const selectors = graph.selectors;
  for (let i = 0, len = selectors.length; i < len; i++) {
    const sel = selectors[i];
    if (!sel) continue;
    if (sel.specificityScore >= threshold) {
      result.push(sel);
    }
  }
  return result;
}

export function getSelectorsWithIds(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.idSelectors;
}

export function getSelectorsWithUniversal(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.universalSelectors;
}

export function getComplexSelectors(
  graph: CSSGraph,
  maxDepth: number = 3,
): readonly SelectorEntity[] {
  const result: SelectorEntity[] = [];
  const selectors = graph.selectors;
  for (let i = 0, len = selectors.length; i < len; i++) {
    const sel = selectors[i];
    if (!sel) continue;
    if (sel.complexity.depth > maxDepth) {
      result.push(sel);
    }
  }
  return result;
}

export function getDuplicateSelectorRules(graph: CSSGraph): readonly { selector: string; rules: readonly RuleEntity[] }[] {
  const result: { selector: string; rules: readonly RuleEntity[] }[] = [];
  for (const [, entry] of graph.duplicateSelectors) {
    result.push({ selector: entry.selector, rules: entry.rules });
  }
  return result;
}

export function getSelectorOverrides(_graph: CSSGraph, selector: SelectorEntity): readonly SelectorEntity[] {
  return selector.overriddenBy;
}

export function getSelectorOverriddenBy(_graph: CSSGraph, selector: SelectorEntity): readonly SelectorEntity[] {
  return selector.overrides;
}
