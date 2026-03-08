import { jsxNoUndefinedCssClass } from "./undefined-css-class"
import { cssNoUnreferencedComponentClass } from "./unreferenced-css-class"
import { jsxNoDuplicateClassTokenClassClasslist } from "./jsx-no-duplicate-class-token-class-classlist"
import { jsxClasslistStaticKeys } from "./jsx-classlist-static-keys"
import { jsxClasslistNoConstantLiterals } from "./jsx-classlist-no-constant-literals"
import { jsxClasslistBooleanValues } from "./jsx-classlist-boolean-values"
import { jsxClasslistNoAccessorReference } from "./jsx-classlist-no-accessor-reference"
import { jsxStyleKebabCaseKeys } from "./jsx-style-kebab-case-keys"
import { jsxStyleNoFunctionValues } from "./jsx-style-no-function-values"
import { jsxStyleNoUnusedCustomProp } from "./jsx-style-no-unused-custom-prop"
import { jsxStylePolicy } from "./jsx-style-policy"
import { cssLayoutSiblingAlignmentOutlier } from "./css-layout-sibling-alignment-outlier"
import { cssLayoutTransitionLayoutProperty } from "./css-layout-transition-layout-property"
import { cssLayoutAnimationLayoutProperty } from "./css-layout-animation-layout-property"
import { cssLayoutStatefulBoxModelShift } from "./css-layout-stateful-box-model-shift"
import { cssLayoutUnsizedReplacedElement } from "./css-layout-unsized-replaced-element"
import { cssLayoutDynamicSlotNoReservedSpace } from "./css-layout-dynamic-slot-no-reserved-space"
import { cssLayoutScrollbarGutterInstability } from "./css-layout-scrollbar-gutter-instability"
import { cssLayoutOverflowAnchorInstability } from "./css-layout-overflow-anchor-instability"
import { cssLayoutFontSwapInstability } from "./css-layout-font-swap-instability"
import { cssLayoutConditionalDisplayCollapse } from "./css-layout-conditional-display-collapse"
import { cssLayoutConditionalWhiteSpaceWrapShift } from "./css-layout-conditional-white-space-wrap-shift"
import { cssLayoutOverflowModeToggleInstability } from "./css-layout-overflow-mode-toggle-instability"
import { cssLayoutBoxSizingToggleWithChrome } from "./css-layout-box-sizing-toggle-with-chrome"
import { cssLayoutContentVisibilityNoIntrinsicSize } from "./css-layout-content-visibility-no-intrinsic-size"
import { cssLayoutConditionalOffsetShift } from "./css-layout-conditional-offset-shift"
import { jsxLayoutUnstableStyleToggle } from "./jsx-layout-unstable-style-toggle"
import { jsxLayoutClasslistGeometryToggle } from "./jsx-layout-classlist-geometry-toggle"
import { jsxLayoutPictureSourceRatioConsistency } from "./jsx-layout-picture-source-ratio-consistency"
import { jsxLayoutFillImageParentMustBeSized } from "./jsx-layout-fill-image-parent-must-be-sized"

export const rules = [
  jsxNoUndefinedCssClass,
  cssNoUnreferencedComponentClass,
  jsxNoDuplicateClassTokenClassClasslist,
  jsxClasslistStaticKeys,
  jsxClasslistNoConstantLiterals,
  jsxClasslistBooleanValues,
  jsxClasslistNoAccessorReference,
  jsxStyleKebabCaseKeys,
  jsxStyleNoFunctionValues,
  jsxStyleNoUnusedCustomProp,
  jsxStylePolicy,
  jsxLayoutUnstableStyleToggle,
  jsxLayoutClasslistGeometryToggle,
  jsxLayoutPictureSourceRatioConsistency,
  jsxLayoutFillImageParentMustBeSized,
  cssLayoutSiblingAlignmentOutlier,
  cssLayoutTransitionLayoutProperty,
  cssLayoutAnimationLayoutProperty,
  cssLayoutStatefulBoxModelShift,
  cssLayoutUnsizedReplacedElement,
  cssLayoutDynamicSlotNoReservedSpace,
  cssLayoutScrollbarGutterInstability,
  cssLayoutOverflowAnchorInstability,
  cssLayoutFontSwapInstability,
  cssLayoutConditionalDisplayCollapse,
  cssLayoutConditionalWhiteSpaceWrapShift,
  cssLayoutOverflowModeToggleInstability,
  cssLayoutBoxSizingToggleWithChrome,
  cssLayoutContentVisibilityNoIntrinsicSize,
  cssLayoutConditionalOffsetShift,
] as const
