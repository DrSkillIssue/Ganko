/**
 * SCSS-specific query functions (mixins, functions, placeholders)
 */
import type { CSSGraph } from "../impl";
import type {
  MixinEntity,
  MixinIncludeEntity,
  SCSSFunctionEntity,
  FunctionCallEntity,
  PlaceholderEntity,
  ExtendEntity,
} from "../entities";
import {
  hasFlag,
  MIXIN_IS_USED,
  SCSSFN_IS_USED,
  PLACEHOLDER_IS_USED,
} from "../entities";

export function getMixinByName(graph: CSSGraph, name: string): MixinEntity | null {
  return graph.mixinsByName.get(name) ?? null;
}

export function getMixinIncludesFor(_graph: CSSGraph, mixin: MixinEntity): readonly MixinIncludeEntity[] {
  return mixin.includes;
}

export function isMixinUsed(_graph: CSSGraph, mixin: MixinEntity): boolean {
  return hasFlag(mixin._flags, MIXIN_IS_USED);
}

export function getUnusedMixins(graph: CSSGraph): readonly MixinEntity[] {
  return graph.unusedMixins;
}

export function getUnresolvedMixinIncludes(graph: CSSGraph): readonly MixinIncludeEntity[] {
  return graph.unresolvedMixinIncludes;
}

export function getFunctionByName(graph: CSSGraph, name: string): SCSSFunctionEntity | null {
  return graph.functionsByName.get(name) ?? null;
}

export function getFunctionCallsFor(_graph: CSSGraph, fn: SCSSFunctionEntity): readonly FunctionCallEntity[] {
  return fn.calls;
}

export function isFunctionUsed(_graph: CSSGraph, fn: SCSSFunctionEntity): boolean {
  return hasFlag(fn._flags, SCSSFN_IS_USED);
}

export function getUnusedFunctions(graph: CSSGraph): readonly SCSSFunctionEntity[] {
  return graph.unusedFunctions;
}

export function getPlaceholderByName(graph: CSSGraph, name: string): PlaceholderEntity | null {
  return graph.placeholdersByName.get(name) ?? null;
}

export function getPlaceholderExtends(_graph: CSSGraph, placeholder: PlaceholderEntity): readonly ExtendEntity[] {
  return placeholder.extends;
}

export function isPlaceholderUsed(_graph: CSSGraph, placeholder: PlaceholderEntity): boolean {
  return hasFlag(placeholder._flags, PLACEHOLDER_IS_USED);
}

export function getUnusedPlaceholders(graph: CSSGraph): readonly PlaceholderEntity[] {
  return graph.unusedPlaceholders;
}

export function getUnresolvedExtends(graph: CSSGraph): readonly ExtendEntity[] {
  return graph.unresolvedExtends;
}
