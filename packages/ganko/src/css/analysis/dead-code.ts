/**
 * Dead Code Detection
 *
 * Functions for finding unused CSS code: variables, mixins,
 * functions, placeholders, and keyframes.
 *
 * All functions delegate to pre-built indexes on the graph
 * (populated during graph construction in impl.ts).
 */

import type {
  VariableEntity,
  AtRuleEntity,
  MixinEntity,
  SCSSFunctionEntity,
  PlaceholderEntity,
} from "../entities";
import type { CSSWorkspaceView as CSSGraph } from "../workspace-view"

/**
 * Report of unused code in the CSS.
 */
export interface UnusedCodeReport {
  readonly variables: readonly VariableEntity[];
  readonly mixins: readonly MixinEntity[];
  readonly functions: readonly SCSSFunctionEntity[];
  readonly placeholders: readonly PlaceholderEntity[];
  readonly keyframes: readonly AtRuleEntity[];
  readonly totalCount: number;
}

export function findUnusedCode(graph: CSSGraph): UnusedCodeReport {
  const variables = graph.unusedVariables;
  const mixins = graph.unusedMixins;
  const functions = graph.unusedFunctions;
  const placeholders = graph.unusedPlaceholders;
  const keyframes = graph.unusedKeyframes;

  return {
    variables,
    mixins,
    functions,
    placeholders,
    keyframes,
    totalCount:
      variables.length +
      mixins.length +
      functions.length +
      placeholders.length +
      keyframes.length,
  };
}

export function findUnusedVariables(graph: CSSGraph): readonly VariableEntity[] {
  return graph.unusedVariables;
}

export function findUnusedMixins(graph: CSSGraph): readonly MixinEntity[] {
  return graph.unusedMixins;
}

export function findUnusedFunctions(graph: CSSGraph): readonly SCSSFunctionEntity[] {
  return graph.unusedFunctions;
}

export function findUnusedPlaceholders(graph: CSSGraph): readonly PlaceholderEntity[] {
  return graph.unusedPlaceholders;
}

export function findUnusedKeyframes(graph: CSSGraph): readonly AtRuleEntity[] {
  return graph.unusedKeyframes;
}
