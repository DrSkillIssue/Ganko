# Table 1E: Cross-File Rule Accounting

**Total cross-file rules: 31**

| # | Rule variable | Tier | Dispatch action | Notes |
|---|--------------|------|-----------------|-------|
| 1 | `jsxNoUndefinedCssClass` | 1 | `registerCrossSyntaxAction` | |
| 2 | `cssNoUnreferencedComponentClass` | 1 | `registerCrossSyntaxAction` | |
| 3 | `jsxNoDuplicateClassTokenClassClasslist` | 2 | `registerElementAction` | |
| 4 | `jsxClasslistStaticKeys` | 1 | `registerCrossSyntaxAction` | |
| 5 | `jsxClasslistNoConstantLiterals` | 1 | `registerCrossSyntaxAction` | |
| 6 | `jsxClasslistBooleanValues` | 1 | `registerCrossSyntaxAction` | |
| 7 | `jsxClasslistNoAccessorReference` | 1 | `registerCrossSyntaxAction` | |
| 8 | `jsxStyleKebabCaseKeys` | 1 | `registerCrossSyntaxAction` | |
| 9 | `jsxStyleNoFunctionValues` | 1 | `registerCrossSyntaxAction` | |
| 10 | `jsxStyleNoUnusedCustomProp` | 1 | `registerCrossSyntaxAction` | |
| 11 | `jsxStylePolicy` | 2 | `registerElementAction` | |
| 12 | `jsxLayoutUnstableStyleToggle` | 3 | `registerFactAction` | |
| 13 | `jsxLayoutClasslistGeometryToggle` | 1 | `registerCrossSyntaxAction` | |
| 14 | `jsxLayoutPictureSourceRatioConsistency` | 1 | `registerCrossSyntaxAction` | |
| 15 | `jsxLayoutFillImageParentMustBeSized` | 3 | `registerFactAction` | |
| 16 | `cssLayoutSiblingAlignmentOutlier` | 5 | `registerAlignmentAction` | |
| 17 | `cssLayoutTransitionLayoutProperty` | 0 | `registerCSSSyntaxAction` | |
| 18 | `cssLayoutAnimationLayoutProperty` | 0 | `registerCSSSyntaxAction` | |
| 19 | `cssLayoutStatefulBoxModelShift` | 3 | `registerFactAction` | |
| 20 | `cssLayoutUnsizedReplacedElement` | 3 | `registerFactAction` | |
| 21 | `cssLayoutDynamicSlotNoReservedSpace` | 3 | `registerFactAction` | |
| 22 | `cssLayoutScrollbarGutterInstability` | 3 | `registerFactAction` | |
| 23 | `cssLayoutOverflowAnchorInstability` | 3 | `registerFactAction` | |
| 24 | `cssLayoutFontSwapInstability` | 0 | `registerCSSSyntaxAction` | |
| 25 | `cssLayoutConditionalDisplayCollapse` | 4 | `registerConditionalDeltaAction` | |
| 26 | `cssLayoutConditionalWhiteSpaceWrapShift` | 4 | `registerConditionalDeltaAction` | |
| 27 | `cssLayoutOverflowModeToggleInstability` | 4 | `registerConditionalDeltaAction` | |
| 28 | `cssLayoutBoxSizingToggleWithChrome` | 4 | `registerConditionalDeltaAction` | |
| 29 | `cssLayoutContentVisibilityNoIntrinsicSize` | 3 | `registerFactAction` | |
| 30 | `cssLayoutConditionalOffsetShift` | 4 | `registerConditionalDeltaAction` | |
| 31 | `jsxLayoutPolicyTouchTarget` | 3 | `registerFactAction` | |

## Tier summary

| Tier | Count | Description |
|------|-------|-------------|
| 0 | 3 | CSS syntax only |
| 1 | 11 | Solid + CSS syntax |
| 2 | 2 | Element resolution |
| 3 | 9 | Selective layout facts |
| 4 | 5 | Full cascade + signals |
| 5 | 1 | Alignment model |
| **Total** | **31** | |