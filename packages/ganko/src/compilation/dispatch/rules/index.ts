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
]
