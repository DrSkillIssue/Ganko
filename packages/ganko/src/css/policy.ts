/**
 * Accessibility Policy Templates
 *
 * Predefined bundles of sizing, spacing, and contrast constraints
 * derived from WCAG 2.2, Material Design 3, Apple HIG, and
 * W3C Low Vision Needs.
 */

import { ACCESSIBILITY_POLICIES, type AccessibilityPolicy } from "@ganko/shared"

/** All enforceable thresholds for a single policy template. */
export interface PolicyThresholds {
  readonly minBodyFontSize: number
  readonly minCaptionFontSize: number
  readonly minButtonFontSize: number
  readonly minHeadingFontSize: number
  readonly minLineHeight: number
  readonly minHeadingLineHeight: number

  readonly minButtonHeight: number
  readonly minButtonWidth: number
  readonly minTouchTarget: number
  readonly minButtonHorizontalPadding: number
  readonly minInputHeight: number

  readonly minParagraphSpacing: number
  readonly minLetterSpacing: number
  readonly minWordSpacing: number

  readonly minContrastNormalText: number
  readonly minContrastLargeText: number
  readonly minContrastUIComponents: number
  readonly largeTextThreshold: number

  readonly minReflowWidth: number
  readonly minTextScaling: number
}

/** Named policy template identifiers. Re-exported from shared. */
export type PolicyName = AccessibilityPolicy

/** WCAG 2.2 Level AA — the legal compliance baseline. */
const WCAG_AA: PolicyThresholds = {
  minBodyFontSize: 16,
  minCaptionFontSize: 12,
  minButtonFontSize: 14,
  minHeadingFontSize: 16,
  minLineHeight: 1.5,
  minHeadingLineHeight: 1.2,
  minButtonHeight: 24,
  minButtonWidth: 24,
  minTouchTarget: 24,
  minButtonHorizontalPadding: 8,
  minInputHeight: 24,
  minParagraphSpacing: 2.0,
  minLetterSpacing: 0.12,
  minWordSpacing: 0.16,
  minContrastNormalText: 4.5,
  minContrastLargeText: 3.0,
  minContrastUIComponents: 3.0,
  largeTextThreshold: 24,
  minReflowWidth: 320,
  minTextScaling: 200,
}

/** WCAG 2.2 Level AAA — enhanced contrast and 44px touch targets. */
const WCAG_AAA: PolicyThresholds = {
  minBodyFontSize: 16,
  minCaptionFontSize: 12,
  minButtonFontSize: 14,
  minHeadingFontSize: 16,
  minLineHeight: 1.5,
  minHeadingLineHeight: 1.2,
  minButtonHeight: 44,
  minButtonWidth: 44,
  minTouchTarget: 44,
  minButtonHorizontalPadding: 12,
  minInputHeight: 44,
  minParagraphSpacing: 2.0,
  minLetterSpacing: 0.12,
  minWordSpacing: 0.16,
  minContrastNormalText: 7.0,
  minContrastLargeText: 4.5,
  minContrastUIComponents: 3.0,
  largeTextThreshold: 24,
  minReflowWidth: 320,
  minTextScaling: 200,
}

/** Touch-optimized mobile — Apple HIG + Material Design 3 48dp targets. */
const MOBILE_FIRST: PolicyThresholds = {
  minBodyFontSize: 16,
  minCaptionFontSize: 12,
  minButtonFontSize: 16,
  minHeadingFontSize: 18,
  minLineHeight: 1.5,
  minHeadingLineHeight: 1.3,
  minButtonHeight: 48,
  minButtonWidth: 48,
  minTouchTarget: 48,
  minButtonHorizontalPadding: 16,
  minInputHeight: 48,
  minParagraphSpacing: 2.0,
  minLetterSpacing: 0.12,
  minWordSpacing: 0.16,
  minContrastNormalText: 4.5,
  minContrastLargeText: 3.0,
  minContrastUIComponents: 3.0,
  largeTextThreshold: 24,
  minReflowWidth: 320,
  minTextScaling: 200,
}

/** Data-dense desktop — dashboards, admin panels, IDEs. */
const DENSE_UI: PolicyThresholds = {
  minBodyFontSize: 13,
  minCaptionFontSize: 11,
  minButtonFontSize: 12,
  minHeadingFontSize: 14,
  minLineHeight: 1.4,
  minHeadingLineHeight: 1.15,
  minButtonHeight: 24,
  minButtonWidth: 24,
  minTouchTarget: 24,
  minButtonHorizontalPadding: 4,
  minInputHeight: 24,
  minParagraphSpacing: 1.5,
  minLetterSpacing: 0.05,
  minWordSpacing: 0.08,
  minContrastNormalText: 4.5,
  minContrastLargeText: 3.0,
  minContrastUIComponents: 3.0,
  largeTextThreshold: 24,
  minReflowWidth: 320,
  minTextScaling: 200,
}

/** Low vision / elderly — exceeds AAA, based on APH large print guidelines. */
const LARGE_TEXT: PolicyThresholds = {
  minBodyFontSize: 24,
  minCaptionFontSize: 18,
  minButtonFontSize: 20,
  minHeadingFontSize: 24,
  minLineHeight: 1.8,
  minHeadingLineHeight: 1.5,
  minButtonHeight: 48,
  minButtonWidth: 48,
  minTouchTarget: 48,
  minButtonHorizontalPadding: 20,
  minInputHeight: 48,
  minParagraphSpacing: 2.5,
  minLetterSpacing: 0.16,
  minWordSpacing: 0.24,
  minContrastNormalText: 10.0,
  minContrastLargeText: 7.0,
  minContrastUIComponents: 4.5,
  largeTextThreshold: 24,
  minReflowWidth: 320,
  minTextScaling: 400,
}

/** All named policy templates. */
export const POLICIES: Readonly<Record<PolicyName, PolicyThresholds>> = {
  "wcag-aa": WCAG_AA,
  "wcag-aaa": WCAG_AAA,
  "mobile-first": MOBILE_FIRST,
  "dense-ui": DENSE_UI,
  "large-text": LARGE_TEXT,
}

/** Active policy name. Defaults to wcag-aa. */
let activePolicyName: PolicyName = "wcag-aa"

/** Set the active policy for all policy rules. */
export function setActivePolicy(name: string): void {
  const match = ACCESSIBILITY_POLICIES.find(n => n === name)
  if (match) {
    activePolicyName = match
  }
}

/** Get the active policy name. */
export function getActivePolicyName(): PolicyName {
  return activePolicyName
}

/** Resolve a policy name to its thresholds. Defaults to wcag-aa. */
export function resolvePolicy(name: string): PolicyThresholds {
  const match = ACCESSIBILITY_POLICIES.find(n => n === name)
  if (match) return POLICIES[match]
  return WCAG_AA
}

/** Get the active policy thresholds. */
export function getActivePolicy(): PolicyThresholds {
  return POLICIES[activePolicyName]
}
