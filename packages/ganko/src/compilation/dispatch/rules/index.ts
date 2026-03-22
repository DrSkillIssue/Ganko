import type { AnalysisRule } from "../rule"

import { cssLayoutTransitionLayoutProperty } from "./css-layout-transition-layout-property"
import { cssLayoutAnimationLayoutProperty } from "./css-layout-animation-layout-property"
import { cssLayoutFontSwapInstability } from "./css-layout-font-swap-instability"
import { jsxNoUndefinedCssClass } from "./jsx-no-undefined-css-class"
import { cssNoUnreferencedComponentClass } from "./css-no-unreferenced-component-class"
import { jsxClasslistBooleanValues } from "./jsx-classlist-boolean-values"
import { jsxClasslistNoAccessorReference } from "./jsx-classlist-no-accessor-reference"
import { jsxClasslistNoConstantLiterals } from "./jsx-classlist-no-constant-literals"
import { jsxClasslistStaticKeys } from "./jsx-classlist-static-keys"
import { jsxStyleKebabCaseKeys } from "./jsx-style-kebab-case-keys"
import { jsxStyleNoFunctionValues } from "./jsx-style-no-function-values"
import { jsxStyleNoUnusedCustomProp } from "./jsx-style-no-unused-custom-prop"
import { jsxLayoutClasslistGeometryToggle } from "./jsx-layout-classlist-geometry-toggle"
import { jsxLayoutPictureSourceRatioConsistency } from "./jsx-layout-picture-source-ratio-consistency"
import { jsxNoDuplicateClassTokenClassClasslist } from "./jsx-no-duplicate-class-token-class-classlist"
import { jsxStylePolicy } from "./jsx-style-policy"
import { jsxLayoutFillImageParentMustBeSized } from "./jsx-layout-fill-image-parent-must-be-sized"
import { cssLayoutUnsizedReplacedElement } from "./css-layout-unsized-replaced-element"
import { cssLayoutDynamicSlotNoReservedSpace } from "./css-layout-dynamic-slot-no-reserved-space"
import { cssLayoutOverflowAnchorInstability } from "./css-layout-overflow-anchor-instability"
import { cssLayoutScrollbarGutterInstability } from "./css-layout-scrollbar-gutter-instability"
import { cssLayoutContentVisibilityNoIntrinsicSize } from "./css-layout-content-visibility-no-intrinsic-size"
import { cssLayoutStatefulBoxModelShift } from "./css-layout-stateful-box-model-shift"
import { jsxLayoutUnstableStyleToggle } from "./jsx-layout-unstable-style-toggle"
import { jsxLayoutPolicyTouchTarget } from "./jsx-layout-policy-touch-target"
import { cssLayoutConditionalDisplayCollapse } from "./css-layout-conditional-display-collapse"
import { cssLayoutConditionalOffsetShift } from "./css-layout-conditional-offset-shift"
import { cssLayoutConditionalWhiteSpaceWrapShift } from "./css-layout-conditional-white-space-wrap-shift"
import { cssLayoutOverflowModeToggleInstability } from "./css-layout-overflow-mode-toggle-instability"
import { cssLayoutBoxSizingToggleWithChrome } from "./css-layout-box-sizing-toggle-with-chrome"
import { cssLayoutSiblingAlignmentOutlier } from "./css-layout-sibling-alignment-outlier"
import { cssNoEmptyRule } from "./css-no-empty-rule"
import { cssNoIdSelectors } from "./css-no-id-selectors"
import { cssNoComplexSelectors } from "./css-no-complex-selectors"
import { cssSelectorMaxSpecificity } from "./css-selector-max-specificity"
import { cssSelectorMaxAttributeAndUniversal } from "./css-selector-max-attribute-and-universal"
import { cssDeclarationNoOverriddenWithinRule } from "./css-declaration-no-overridden-within-rule"
import { cssNoHardcodedZIndex } from "./css-no-hardcoded-z-index"
import { cssZIndexRequiresPositionedContext } from "./css-z-index-requires-positioned-context"
import { cssNoDiscreteTransition } from "./css-no-discrete-transition"
import { cssNoTransitionAll } from "./css-no-transition-all"
import { cssNoLegacyVh100 } from "./css-no-legacy-vh-100"
import { cssPreferLogicalProperties } from "./css-prefer-logical-properties"
import { cssNoImportant } from "./css-no-important"
import { cssNoUnresolvedCustomProperties } from "./css-no-unresolved-custom-properties"
import { cssNoUnusedCustomProperties } from "./css-no-unused-custom-properties"
import { cssNoDuplicateSelectors } from "./css-no-duplicate-selectors"
import { cssNoEmptyKeyframes } from "./css-no-empty-keyframes"
import { cssNoUnknownAnimationName } from "./css-no-unknown-animation-name"
import { cssNoUnusedKeyframes } from "./css-no-unused-keyframes"
import { cssNoUnknownContainerName } from "./css-no-unknown-container-name"
import { cssNoUnusedContainerName } from "./css-no-unused-container-name"
import { cssRequireReducedMotionOverride } from "./css-require-reduced-motion-override"
import { cssNoOutlineNoneWithoutFocusVisible } from "./css-no-outline-none-without-focus-visible"
import { cssPolicyContrast } from "./css-policy-contrast"
import { cssPolicyTypography } from "./css-policy-typography"
import { cssPolicySpacing } from "./css-policy-spacing"
import { cssNoLayoutPropertyAnimation } from "./css-no-layout-property-animation"
import { cssLayerRequirementForComponentRules } from "./css-layer-requirement-for-component-rules"
import { cssNoCustomPropertyCycle } from "./css-no-custom-property-cycle"
import { cssNoLayerOrderInversion } from "./css-no-layer-order-inversion"
import { cssNoRedundantOverridePairs } from "./css-no-redundant-override-pairs"
import { cssMediaQueryOverlapConflict } from "./css-media-query-overlap-conflict"
import { cssNoDescendingSpecificityConflict } from "./css-no-descending-specificity-conflict"

export const allRules: readonly AnalysisRule[] = [
  cssLayoutTransitionLayoutProperty,
  cssLayoutAnimationLayoutProperty,
  cssLayoutFontSwapInstability,
  jsxNoUndefinedCssClass,
  cssNoUnreferencedComponentClass,
  jsxClasslistBooleanValues,
  jsxClasslistNoAccessorReference,
  jsxClasslistNoConstantLiterals,
  jsxClasslistStaticKeys,
  jsxStyleKebabCaseKeys,
  jsxStyleNoFunctionValues,
  jsxStyleNoUnusedCustomProp,
  jsxLayoutClasslistGeometryToggle,
  jsxLayoutPictureSourceRatioConsistency,
  jsxNoDuplicateClassTokenClassClasslist,
  jsxStylePolicy,
  jsxLayoutFillImageParentMustBeSized,
  cssLayoutUnsizedReplacedElement,
  cssLayoutDynamicSlotNoReservedSpace,
  cssLayoutOverflowAnchorInstability,
  cssLayoutScrollbarGutterInstability,
  cssLayoutContentVisibilityNoIntrinsicSize,
  cssLayoutStatefulBoxModelShift,
  jsxLayoutUnstableStyleToggle,
  jsxLayoutPolicyTouchTarget,
  cssLayoutConditionalDisplayCollapse,
  cssLayoutConditionalOffsetShift,
  cssLayoutConditionalWhiteSpaceWrapShift,
  cssLayoutOverflowModeToggleInstability,
  cssLayoutBoxSizingToggleWithChrome,
  cssLayoutSiblingAlignmentOutlier,
  cssNoEmptyRule,
  cssNoIdSelectors,
  cssNoComplexSelectors,
  cssSelectorMaxSpecificity,
  cssSelectorMaxAttributeAndUniversal,
  cssDeclarationNoOverriddenWithinRule,
  cssNoHardcodedZIndex,
  cssZIndexRequiresPositionedContext,
  cssNoDiscreteTransition,
  cssNoTransitionAll,
  cssNoLegacyVh100,
  cssPreferLogicalProperties,
  cssNoImportant,
  cssNoUnresolvedCustomProperties,
  cssNoUnusedCustomProperties,
  cssNoDuplicateSelectors,
  cssNoEmptyKeyframes,
  cssNoUnknownAnimationName,
  cssNoUnusedKeyframes,
  cssNoUnknownContainerName,
  cssNoUnusedContainerName,
  cssRequireReducedMotionOverride,
  cssNoOutlineNoneWithoutFocusVisible,
  cssPolicyContrast,
  cssPolicyTypography,
  cssPolicySpacing,
  cssNoLayoutPropertyAnimation,
  cssLayerRequirementForComponentRules,
  cssNoCustomPropertyCycle,
  cssNoLayerOrderInversion,
  cssNoRedundantOverridePairs,
  cssMediaQueryOverlapConflict,
  cssNoDescendingSpecificityConflict,
]
