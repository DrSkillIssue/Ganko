import { declarationNoOverriddenWithinRule, mediaQueryOverlapConflict, noDescendingSpecificityConflict, noLayerOrderInversion, noRedundantOverridePairs } from "./cascade"
import { cssNoDiscreteTransition, cssNoEmptyKeyframes, noLayoutPropertyAnimation, noTransitionAll, noUnknownAnimationName, noUnusedKeyframes } from "./animation"
import { noComplexSelectors, noDuplicateSelectors, noIdSelectors, selectorMaxAttributeAndUniversal, selectorMaxSpecificity } from "./selector"
import { cssNoCustomPropertyCycle, cssNoHardcodedZIndex, cssNoLegacyVh100, cssZIndexRequiresPositionedContext, noImportant, noUnresolvedCustomProperties, noUnusedCustomProperties } from "./property"
import { cssNoOutlineNoneWithoutFocusVisible, cssPolicyContrast, cssPolicySpacing, cssPolicyTouchTarget, cssPolicyTypography, cssRequireReducedMotionOverride } from "./a11y"
import { cssNoEmptyRule, cssNoUnknownContainerName, cssNoUnusedContainerName, layerRequirementForComponentRules } from "./structure"

export const rules = [
  cssNoDiscreteTransition,
  cssNoCustomPropertyCycle,
  cssNoEmptyKeyframes,
  cssNoEmptyRule,
  cssNoHardcodedZIndex,
  cssNoLegacyVh100,
  cssNoOutlineNoneWithoutFocusVisible,
  cssNoUnknownContainerName,
  cssNoUnusedContainerName,
  cssRequireReducedMotionOverride,
  cssZIndexRequiresPositionedContext,
  declarationNoOverriddenWithinRule,
  layerRequirementForComponentRules,
  mediaQueryOverlapConflict,
  noComplexSelectors,
  noDescendingSpecificityConflict,
  noDuplicateSelectors,
  noIdSelectors,
  noImportant,
  noLayoutPropertyAnimation,
  noLayerOrderInversion,
  noRedundantOverridePairs,
  noTransitionAll,
  noUnknownAnimationName,
  noUnresolvedCustomProperties,
  noUnusedCustomProperties,
  noUnusedKeyframes,
  selectorMaxAttributeAndUniversal,
  selectorMaxSpecificity,
  cssPolicyTypography,
  cssPolicyTouchTarget,
  cssPolicySpacing,
  cssPolicyContrast,
] as const
