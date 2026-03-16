
import ts from "typescript";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { VariableEntity, ReactiveKind } from "../entities/variable";
import type { FunctionEntity } from "../entities/function";
import { setVariableReactivity } from "../entities/variable";

export function runReactivityPhase(graph: SolidGraph, _input: SolidInput): void {
  // Build set of props variable names for O(1) lookup
  const propsVarNames = new Set<string>();
  const components = graph.componentFunctions;
  for (let i = 0, len = components.length; i < len; i++) {
    const comp = components[i];
    if (!comp) continue;
    const param = comp.params[0];
    if (param?.name) propsVarNames.add(param.name);
  }

  // Build map of primitive call assignments for O(1) lookup
  const primitiveAssignments = new Map<string, { kind: ReactiveKind; isSignalLike: boolean; isMemo: boolean }>();
  const calls = graph.calls;
  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const primitive = call.primitive;
    if (!primitive) continue;

    const varName = getAssignedVariableName(call.node);
    if (!varName) continue;

    const returns = primitive.returns;
    let kind: ReactiveKind | null = null;
    let isSignalLike = false;

    switch (returns.type) {
      case "signal":
        kind = "signal";
        isSignalLike = true;
        break;
      case "accessor":
        kind = primitive.name === "createMemo" ? "memo" : "accessor";
        isSignalLike = true;
        break;
      case "store":
        kind = "store";
        break;
      case "resource":
        kind = "resource";
        break;
    }

    if (kind) {
      primitiveAssignments.set(varName, { kind, isSignalLike, isMemo: kind === "memo" });
    }
  }

  // Single pass over variables
  const typeResolver = graph.typeResolver;
  const variables = graph.variables;
  for (let i = 0, len = variables.length; i < len; i++) {
    const variable = variables[i];
    if (!variable) continue;
    const name = variable.name;

    // Check primitive assignment first (highest priority)
    const primitiveInfo = primitiveAssignments.get(name);
    if (primitiveInfo) {
      setVariableReactivity(variable, true, primitiveInfo.kind, primitiveInfo.isSignalLike, null);
      if (primitiveInfo.isMemo) variable.isMemoVariable = true;
      continue;
    }

    // Check if this is a component props parameter
    if (propsVarNames.has(name)) {
      setVariableReactivity(variable, true, "props", false, null);
      continue;
    }

    // Fall back to type-based detection
    const declaration = variable.declarations[0];
    if (!declaration) continue;

    const result = typeResolver.getReactiveKindWithType(declaration as any);
    if (result.kind) {
      setVariableReactivity(variable, true, result.kind, result.kind === "signal" || result.kind === "accessor", result.type);
    }
  }

  graph.buildReactiveIndex();

  // Wire reactive captures AFTER variables have been marked reactive
  wireReactiveCaptures(graph);
  buildFunctionsWithReactiveCaptures(graph);
}

/**
 * Caches reactive captures for each function.
 * Must run after variables are marked reactive.
 */
function wireReactiveCaptures(graph: SolidGraph): void {
  const functions = graph.functions;
  if (functions.length === 0) return;

  for (let i = 0, len = functions.length; i < len; i++) {
    const fn = functions[i];
    if (!fn) continue;
    const captures = fn.captures;
    const reactive: VariableEntity[] = [];

    for (let j = 0, clen = captures.length; j < clen; j++) {
      const v = captures[j];
      if (!v) continue;
      if (v.isReactive) {
        reactive.push(v);
      }
    }

    fn._cachedReactiveCaptures = reactive;
  }
}

/**
 * Builds the list of functions that capture reactive variables.
 */
function buildFunctionsWithReactiveCaptures(graph: SolidGraph): void {
  const functions = graph.functions;
  const withCaptures: FunctionEntity[] = [];

  for (let i = 0, len = functions.length; i < len; i++) {
    const fn = functions[i];
    if (!fn) continue;
    const captures = fn._cachedReactiveCaptures;
    if (captures && captures.length > 0) {
      withCaptures.push(fn);
    }
  }

  graph.functionsWithReactiveCaptures = withCaptures;
}

/**
 * Gets the variable name a call expression is assigned to.
 */
function getAssignedVariableName(node: ts.CallExpression | ts.NewExpression): string | null {
  const parent = node.parent;
  if (!parent || !ts.isVariableDeclaration(parent)) return null;

  const name = parent.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isArrayBindingPattern(name) && name.elements[0] && ts.isBindingElement(name.elements[0]) && ts.isIdentifier(name.elements[0].name)) {
    return name.elements[0].name.text;
  }
  return null;
}
