import type { SelectorEntity, VariableEntity } from "../entities";
import { CHAR_HYPHEN, CHAR_UNDERSCORE } from "@drskillissue/ganko-shared";

const BEM_BLOCK = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const BEM_ELEMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*__[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const BEM_MODIFIER = /^[a-z][a-z0-9]*(-[a-z0-9]+)*((__[a-z0-9]+(-[a-z0-9]+)*)?)--[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const UTILITY_CLASS = /^(u-|util-|utility-|is-|has-|js-)/;
const DESIGN_TOKEN_VAR = /^--([a-z]+-){1,}(color|spacing|size|font|radius|shadow|border|z|breakpoint|motion)/;
const SCOPED_SELECTORS = /^\[data-v-|^\[data-s-|\.svelte-|:host|::slotted|:global\(|:local\(/;

export function isScopedSelector(selector: SelectorEntity): boolean {
  return SCOPED_SELECTORS.test(selector.raw);
}

/** BEM block: lowercase with optional single-hyphen separators. */
export function isBEMBlock(name: string): boolean {
  return BEM_BLOCK.test(name);
}

export function isBEMElement(name: string): boolean {
  return BEM_ELEMENT.test(name);
}

export function isBEMModifier(name: string): boolean {
  return BEM_MODIFIER.test(name);
}

export function isUtilityClass(name: string): boolean {
  return UTILITY_CLASS.test(name);
}

export function isDesignToken(name: string): boolean {
  return DESIGN_TOKEN_VAR.test(name);
}

export function isPrivateVariable(variable: VariableEntity): boolean {
  const name = variable.scssName;
  if (name === null) return false;
  const second = name.charCodeAt(1);
  return second === CHAR_HYPHEN || second === CHAR_UNDERSCORE;
}
