/**
 * Variable and reference query functions
 */
import type { CSSGraph } from "../impl";
import type { VariableEntity, VariableReferenceEntity } from "../entities";
import { hasFlag, VAR_IS_USED, VAR_HAS_FALLBACK } from "../entities";

export function getVariableReferences(_graph: CSSGraph, variable: VariableEntity): readonly VariableReferenceEntity[] {
  return variable.references;
}

export function isVariableUsed(_graph: CSSGraph, variable: VariableEntity): boolean {
  return hasFlag(variable._flags, VAR_IS_USED);
}

export function getVariableShadows(_graph: CSSGraph, variable: VariableEntity): readonly VariableEntity[] {
  return variable.shadows;
}

export function getVariableShadowedBy(_graph: CSSGraph, variable: VariableEntity): readonly VariableEntity[] {
  return variable.shadowedBy;
}

export function resolveVariableReference(_graph: CSSGraph, ref: VariableReferenceEntity): VariableEntity | null {
  return ref.resolvedVariable;
}

export function getVariablesInScope(
  graph: CSSGraph,
  scopeType: "global" | "selector" | "media" | "supports" | "layer",
): readonly VariableEntity[] {
  const result: VariableEntity[] = [];
  const vars = graph.variables;
  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i];
    if (!v) continue;
    if (v.scope.type === scopeType) {
      result.push(v);
    }
  }
  return result;
}

export function getVariablesWithFallback(graph: CSSGraph): readonly VariableEntity[] {
  const result: VariableEntity[] = [];
  const vars = graph.variables;
  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i];
    if (!v) continue;
    if (hasFlag(v._flags, VAR_HAS_FALLBACK)) {
      result.push(v);
    }
  }
  return result;
}

export function getReferencesWithFallback(graph: CSSGraph): readonly VariableReferenceEntity[] {
  const result: VariableReferenceEntity[] = [];
  const refs = graph.variableRefs;
  for (let i = 0, len = refs.length; i < len; i++) {
    const ref = refs[i];
    if (!ref) continue;
    if (ref.fallback !== null) {
      result.push(ref);
    }
  }
  return result;
}

export function getDeepFallbackChains(graph: CSSGraph, minDepth: number = 2): readonly VariableReferenceEntity[] {
  const result: VariableReferenceEntity[] = [];
  const refs = graph.variableRefs;
  for (let i = 0, len = refs.length; i < len; i++) {
    const ref = refs[i];
    if (!ref) continue;
    if (ref.fallbackChainDepth >= minDepth) {
      result.push(ref);
    }
  }
  return result;
}
