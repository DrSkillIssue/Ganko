/**
 * Predicate-based search: find, some, every, filter, count
 */
import type { SolidSyntaxTree as SolidGraph } from "../../compilation/core/solid-syntax-tree";
import { queryOps } from "../../util/query-ops";

const fnOps = queryOps<SolidGraph, SolidGraph["functions"][number]>((g) => g.functions);
const callOps = queryOps<SolidGraph, SolidGraph["calls"][number]>((g) => g.calls);
const varOps = queryOps<SolidGraph, SolidGraph["variables"][number]>((g) => g.variables);
const jsxOps = queryOps<SolidGraph, SolidGraph["jsxElements"][number]>((g) => g.jsxElements);

export function countFunctionsWithReactiveCaptures(graph: SolidGraph): number {
  return graph.functionsWithReactiveCaptures.length;
}

export function countReactiveVariables(graph: SolidGraph): number {
  return graph.reactiveVariables.length;
}

export function countComponentFunctions(graph: SolidGraph): number {
  return graph.componentFunctions.length;
}

export const countFunctionsWhere = fnOps.countWhere;
export const countCallsWhere = callOps.countWhere;
export const countVariablesWhere = varOps.countWhere;
export const countJSXElementsWhere = jsxOps.countWhere;

export const findFunction = fnOps.find;
export const findCall = callOps.find;
export const findVariable = varOps.find;
export const findJSXElement = jsxOps.find;

export const someFunction = fnOps.some;
export const someCall = callOps.some;
export const someVariable = varOps.some;
export const someJSXElement = jsxOps.some;

export const everyFunction = fnOps.every;
export const everyCall = callOps.every;
export const everyVariable = varOps.every;

export const filterFunctions = fnOps.filter;
export const filterCalls = callOps.filter;
export const filterVariables = varOps.filter;
export const filterJSXElements = jsxOps.filter;
