/**
 * Exemption logic for layout property animation rules.
 *
 * Layout property transitions/animations can only cause CLS when the
 * animating element participates in normal document flow AND the
 * transition fires without user interaction. This module checks the
 * CSS context surrounding a declaration to determine exemptions:
 *
 * 1. Out-of-flow: The rule (or an ancestor in the CSS nesting chain)
 *    has `position: fixed | absolute`, removing the element from flow.
 *
 * 2. Contained expand/collapse: `grid-template-rows` transitions where
 *    the element's nested rules include `overflow: hidden | clip`, which
 *    is the standard CSS-only expand/collapse pattern (0fr → 1fr).
 *
 * 3. User-interaction-gated: The selector includes state-indicating
 *    attribute selectors (e.g., `[data-ready]`, `[data-expanded]`)
 *    that indicate the transition only activates after a state change,
 *    meaning the layout shift is within the 500ms user-input exclusion
 *    window and does not count toward CLS scoring.
 */

import type { DeclarationEntity } from "../../entities/declaration"
import type { RuleEntity } from "../../entities/rule"
import type { AtRuleEntity } from "../../entities/at-rule"

const OUT_OF_FLOW_POSITIONS = new Set(["fixed", "absolute"])

const OVERFLOW_CONTAINMENT_VALUES = new Set(["hidden", "clip"])

/**
 * Component-identifying attribute prefixes. These establish identity rather
 * than state, so they should NOT be treated as state-indicating selectors.
 */
const IDENTITY_ATTRIBUTE_NAMES = new Set(["data-component", "data-slot"])

/**
 * Check if a layout property transition declaration is exempt from CLS warnings.
 *
 * @param declaration - The transition/transition-property declaration
 * @param layoutProperty - The specific layout property being transitioned (e.g., "width", "grid-template-rows")
 * @returns true if the declaration is exempt from layout animation warnings
 */
export function isLayoutAnimationExempt(
  declaration: DeclarationEntity,
  layoutProperty: string,
): boolean {
  const rule = declaration.rule
  if (!rule) return false

  if (isInOutOfFlowContext(rule)) return true
  if (isContainedExpandCollapse(rule, layoutProperty)) return true
  if (isUserGatedTransition(rule)) return true

  return false
}

/**
 * Walk the rule and its CSS nesting ancestors to check if any establish
 * out-of-flow positioning (position: fixed | absolute).
 */
function isInOutOfFlowContext(rule: RuleEntity): boolean {
  let current: RuleEntity | AtRuleEntity | null = rule

  while (current !== null) {
    if (current.kind === "rule") {
      if (hasOutOfFlowPosition(current)) return true
      current = current.parent
    } else {
      // AtRuleEntity — skip but continue walking
      current = current.parent
    }
  }

  return false
}

/**
 * Check if a rule has a position declaration with fixed or absolute value.
 */
function hasOutOfFlowPosition(rule: RuleEntity): boolean {
  const positionDecls = rule.declarationIndex.get("position")
  if (!positionDecls) return false

  for (let i = 0; i < positionDecls.length; i++) {
    const decl = positionDecls[i]
    if (!decl) continue
    const value = decl.value.trim().toLowerCase()
    if (OUT_OF_FLOW_POSITIONS.has(value)) return true
  }

  return false
}

/**
 * For `grid-template-rows` transitions, check if the rule has nested
 * rules with `overflow: hidden | clip`. This is the standard CSS-only
 * expand/collapse pattern where 0fr → 1fr animates height while the
 * inner wrapper clips overflow.
 */
function isContainedExpandCollapse(rule: RuleEntity, layoutProperty: string): boolean {
  if (layoutProperty !== "grid-template-rows" && layoutProperty !== "grid-template-columns") {
    return false
  }

  return hasOverflowContainmentInNestedRules(rule)
}

/**
 * Recursively check if any nested rule (direct child or deeper) has
 * overflow: hidden | clip.
 */
function hasOverflowContainmentInNestedRules(rule: RuleEntity): boolean {
  for (let i = 0; i < rule.nestedRules.length; i++) {
    const nested = rule.nestedRules[i]
    if (!nested) continue
    if (hasOverflowContainment(nested)) return true
    if (hasOverflowContainmentInNestedRules(nested)) return true
  }

  return false
}

/**
 * Check if a rule has overflow: hidden | clip.
 */
function hasOverflowContainment(rule: RuleEntity): boolean {
  const overflowDecls = rule.declarationIndex.get("overflow")
  if (overflowDecls) {
    for (let i = 0; i < overflowDecls.length; i++) {
      const decl = overflowDecls[i];
      if (!decl) continue;
      const value = decl.value.trim().toLowerCase()
      if (OVERFLOW_CONTAINMENT_VALUES.has(value)) return true
    }
  }

  const overflowX = rule.declarationIndex.get("overflow-x")
  if (overflowX) {
    for (let i = 0; i < overflowX.length; i++) {
      const decl = overflowX[i];
      if (!decl) continue;
      const value = decl.value.trim().toLowerCase()
      if (OVERFLOW_CONTAINMENT_VALUES.has(value)) return true
    }
  }

  const overflowY = rule.declarationIndex.get("overflow-y")
  if (overflowY) {
    for (let i = 0; i < overflowY.length; i++) {
      const decl = overflowY[i];
      if (!decl) continue;
      const value = decl.value.trim().toLowerCase()
      if (OVERFLOW_CONTAINMENT_VALUES.has(value)) return true
    }
  }

  return false
}

/**
 * Check if the rule's selector(s) include state-indicating attribute
 * selectors beyond component identity attributes.
 *
 * Selectors like `[data-component="sidebar"][data-ready]` indicate
 * that the rule only matches after a state change (e.g., user interaction,
 * mount completion). Transitions gated behind such selectors fire within
 * the browser's user-input attribution window and are excluded from CLS
 * scoring.
 *
 * Identity attributes (`data-component`, `data-slot`) are not state
 * indicators — they're structural. Only additional attribute selectors
 * beyond identity qualify as state gates.
 */
function isUserGatedTransition(rule: RuleEntity): boolean {
  const selectors = rule.selectors
  if (selectors.length === 0) return false

  // ALL selectors in the rule must be user-gated (a rule can have
  // comma-separated selectors; if any matches without a state gate,
  // the transition can fire without user interaction).
  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    if (!sel) continue;
    if (!selectorHasStateAttribute(sel.anchor.attributes)) {
      return false
    }
  }

  return true
}

/**
 * Check if a selector's attribute constraints include at least one
 * state-indicating attribute (not an identity attribute).
 */
function selectorHasStateAttribute(
  attributes: readonly { name: string; operator: string; value: string | null }[],
): boolean {
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i]
    if (!attr) continue
    if (IDENTITY_ATTRIBUTE_NAMES.has(attr.name)) continue
    // Any non-identity attribute selector is a state gate
    return true
  }

  return false
}
