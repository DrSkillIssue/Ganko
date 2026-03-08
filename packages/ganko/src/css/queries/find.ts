/**
 * Predicate-based search: find, some, every, filter, count
 */
import type { CSSGraph } from "../impl";
import { queryOps } from "../../util/query-ops";

const ruleOps = queryOps<CSSGraph, CSSGraph["rules"][number]>((g) => g.rules);
const selectorOps = queryOps<CSSGraph, CSSGraph["selectors"][number]>((g) => g.selectors);
const declOps = queryOps<CSSGraph, CSSGraph["declarations"][number]>((g) => g.declarations);
const varOps = queryOps<CSSGraph, CSSGraph["variables"][number]>((g) => g.variables);
const atRuleOps = queryOps<CSSGraph, CSSGraph["atRules"][number]>((g) => g.atRules);

export function countRules(graph: CSSGraph): number {
  return graph.rules.length;
}

export function countSelectors(graph: CSSGraph): number {
  return graph.selectors.length;
}

export function countDeclarations(graph: CSSGraph): number {
  return graph.declarations.length;
}

export function countVariables(graph: CSSGraph): number {
  return graph.variables.length;
}

export function countUnusedVariables(graph: CSSGraph): number {
  return graph.unusedVariables.length;
}

export const countRulesWhere = ruleOps.countWhere;
export const countSelectorsWhere = selectorOps.countWhere;
export const countDeclarationsWhere = declOps.countWhere;
export const countVariablesWhere = varOps.countWhere;

export const findRule = ruleOps.find;
export const findSelector = selectorOps.find;
export const findDeclaration = declOps.find;
export const findVariable = varOps.find;
export const findAtRule = atRuleOps.find;

export const someRule = ruleOps.some;
export const someSelector = selectorOps.some;
export const someDeclaration = declOps.some;
export const someVariable = varOps.some;

export const everyRule = ruleOps.every;
export const everySelector = selectorOps.every;
export const everyDeclaration = declOps.every;
export const everyVariable = varOps.every;

export const filterRules = ruleOps.filter;
export const filterSelectors = selectorOps.filter;
export const filterDeclarations = declOps.filter;
export const filterVariables = varOps.filter;
export const filterAtRules = atRuleOps.filter;
