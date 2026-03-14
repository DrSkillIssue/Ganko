import type { AlignmentContext } from "./context-model"
import type { LayoutElementNode } from "./graph"
import { CONTROL_ELEMENT_TAGS } from "./util"
import {
  ContentCompositionClassification,
  LayoutTextualContentState,
  type ContentCompositionFingerprint,
  type InlineReplacedKind,
  type LayoutSignalName,
  type LayoutSignalSnapshot,
  type LayoutSnapshotHotSignals,
} from "./signal-model"
import { alignmentStrengthCalibration } from "./calibration"

/**
 * Tags that are intrinsically-replaced elements in the CSS rendering model.
 * Their baseline is their bottom margin edge (not a text baseline).
 */
const INTRINSIC_REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img", "svg", "video", "canvas", "iframe", "object", "embed",
])

/**
 * Display values that establish a block formatting context boundary.
 * The fingerprint walk stops at these boundaries because children behind
 * them do not participate in the parent's inline baseline computation.
 */
const BLOCK_FORMATTING_CONTEXT_DISPLAYS: ReadonlySet<string> = new Set([
  "block", "flex", "grid", "table", "flow-root", "list-item",
])

/**
 * Display values that create inline-level boxes establishing their own
 * formatting context while participating in the parent's inline flow
 * as replaced-like elements.
 */
const INLINE_REPLACED_DISPLAYS: ReadonlySet<string> = new Set([
  "inline-flex", "inline-block", "inline-table", "inline-grid",
])

/**
 * Display values through which the fingerprint walk should continue,
 * because the element does not establish a new formatting context.
 */
const INLINE_CONTINUATION_DISPLAYS: ReadonlySet<string> = new Set([
  "inline", "contents",
])

/**
 * Height-contributing CSS properties that expand the content box
 * beyond what text alone would produce.
 */
const HEIGHT_CONTRIBUTING_SIGNALS: readonly LayoutSignalName[] = [
  "height", "min-height", "padding-top", "padding-bottom",
  "border-top-width", "border-bottom-width",
]

/**
 * `vertical-align` values that mitigate baseline shift when applied
 * to an inline-replaced child.
 */
const VERTICAL_ALIGN_MITIGATIONS: ReadonlySet<string> = new Set([
  "middle", "top", "bottom", "text-top", "text-bottom",
])

interface FingerprintWalkState {
  hasTextContent: boolean
  hasInlineReplaced: boolean
  inlineReplacedKind: InlineReplacedKind | null
  hasHeightContributingDescendant: boolean
  wrappingContextMitigates: boolean
  hasVerticalAlignMitigation: boolean
  mixedContentDepth: number
  analyzableChildCount: number
  totalChildCount: number
  blockChildCount: number
  inlineChildCount: number
}

/**
 * Computes the content composition fingerprint for a cohort element.
 * Walks the element's descendants within the same inline formatting context
 * (stopping at block formatting context boundaries) to determine the mix
 * of text and inline-replaced content.
 */
export function computeContentCompositionFingerprint(
  elementNode: LayoutElementNode,
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>,
): ContentCompositionFingerprint {
  const state: FingerprintWalkState = {
    hasTextContent: false,
    hasInlineReplaced: false,
    inlineReplacedKind: null,
    hasHeightContributingDescendant: false,
    wrappingContextMitigates: false,
    hasVerticalAlignMitigation: false,
    mixedContentDepth: 0,
    analyzableChildCount: 0,
    totalChildCount: 0,
    blockChildCount: 0,
    inlineChildCount: 0,
  }

  if (elementNode.textualContent === LayoutTextualContentState.Yes || elementNode.textualContent === LayoutTextualContentState.DynamicText) {
    state.hasTextContent = true
  }

  const elementHotSignals = snapshotHotSignalsByElementKey.get(elementNode.key)
  const elementDisplay = elementHotSignals?.display.value ?? null

  // When the element itself establishes its own formatting context — whether
  // block-level (block, flex, grid) or inline-level (inline-flex, inline-block,
  // inline-grid) — its internal content composition does not propagate baseline
  // information to the parent's formatting context. The parent sees this element
  // as an opaque box whose alignment is determined by its own box model, not by
  // what's inside it. Classify as block-segmented to suppress composition findings.
  if (elementDisplay !== null && establishesFormattingContext(elementDisplay)) {
    return {
      hasTextContent: state.hasTextContent,
      hasInlineReplaced: false,
      inlineReplacedKind: null,
      hasHeightContributingDescendant: false,
      wrappingContextMitigates: false,
      hasVerticalAlignMitigation: false,
      mixedContentDepth: 0,
      classification: ContentCompositionClassification.BlockSegmented,
      analyzableChildCount: 0,
      totalChildCount: 0,
      hasOnlyBlockChildren: false,
    }
  }

  walkInlineDescendants(
    elementNode,
    childrenByParentNode,
    snapshotByElementNode,
    snapshotHotSignalsByElementKey,
    state,
    0,
  )

  const hasOnlyBlockChildren = state.analyzableChildCount > 0
    && state.blockChildCount > 0
    && state.inlineChildCount === 0
  const classification = classifyFromState(state, elementNode, hasOnlyBlockChildren)

  return {
    hasTextContent: state.hasTextContent,
    hasInlineReplaced: state.hasInlineReplaced,
    inlineReplacedKind: state.inlineReplacedKind,
    hasHeightContributingDescendant: state.hasHeightContributingDescendant,
    wrappingContextMitigates: state.wrappingContextMitigates,
    hasVerticalAlignMitigation: state.hasVerticalAlignMitigation,
    mixedContentDepth: state.mixedContentDepth,
    classification,
    analyzableChildCount: state.analyzableChildCount,
    totalChildCount: state.totalChildCount,
    hasOnlyBlockChildren,
  }
}

function walkInlineDescendants(
  node: LayoutElementNode,
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>,
  state: FingerprintWalkState,
  depth: number,
): void {
  const children = childrenByParentNode.get(node)
  if (!children) return

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (depth === 0) state.totalChildCount++

    const snapshot = snapshotByElementNode.get(child)
    if (!snapshot) continue

    if (depth === 0) state.analyzableChildCount++

    const childTag = child.tagName?.toLowerCase() ?? null
    const hotSignals = snapshotHotSignalsByElementKey.get(child.key)
    const childDisplay = hotSignals?.display.value ?? null

    if (childTag !== null && (isIntrinsicReplacedTag(childTag) || isControlReplacedTag(childTag))) {
      state.hasInlineReplaced = true
      updateInlineReplacedKind(state, "intrinsic")
      checkHeightContributions(snapshot, state)
      checkVerticalAlignMitigation(snapshot, state)
      updateMixedContentDepth(state, depth)
      if (depth === 0) state.inlineChildCount++
      continue
    }

    if (childDisplay !== null && isBlockFormattingContextDisplay(childDisplay)) {
      if (depth === 0) state.blockChildCount++
      continue
    }

    if (childDisplay !== null && isInlineReplacedDisplay(childDisplay)) {
      state.hasInlineReplaced = true
      updateInlineReplacedKind(state, "container")
      checkHeightContributions(snapshot, state)
      checkVerticalAlignMitigation(snapshot, state)
      updateMixedContentDepth(state, depth)
      if (depth === 0) state.inlineChildCount++

      // Two mitigation paths for inline-replaced elements:
      //
      // 1. The PARENT node wraps text + this inline-replaced child in a flex/grid
      //    context with non-baseline alignment → parent mitigates.
      //
      // 2. The inline-replaced child itself is a flex/grid container with non-baseline
      //    alignment AND it wraps mixed content internally (both text and other
      //    inline-replaced descendants). In this case, the child IS the wrapping
      //    context that resolves the baseline issue — e.g., a sort-wrapper span
      //    with `display: inline-flex; align-items: center` containing label text
      //    and an icon. A leaf element (e.g., a badge containing only text) does
      //    NOT mitigate, because it IS the inline-replaced element causing the shift.
      const parentHotSignals = snapshotHotSignalsByElementKey.get(node.key)
      const parentDisplay = parentHotSignals?.display.value ?? null
      if (parentDisplay !== null && isAlignmentContextWithNonBaselineAlignment(parentDisplay, parentHotSignals)) {
        state.wrappingContextMitigates = true
      } else if (isAlignmentContextWithNonBaselineAlignment(childDisplay, hotSignals)
        && containsMixedContent(child, childrenByParentNode, snapshotByElementNode, snapshotHotSignalsByElementKey)) {
        state.wrappingContextMitigates = true
      }

      continue
    }

    if (child.textualContent === LayoutTextualContentState.Yes || child.textualContent === LayoutTextualContentState.DynamicText) {
      state.hasTextContent = true
    }

    checkHeightContributions(snapshot, state)
    if (depth === 0) state.inlineChildCount++

    if (childDisplay === null || isInlineContinuationDisplay(childDisplay)) {
      walkInlineDescendants(
        child,
        childrenByParentNode,
        snapshotByElementNode,
        snapshotHotSignalsByElementKey,
        state,
        depth + 1,
      )
    }
  }
}

function checkHeightContributions(
  snapshot: LayoutSignalSnapshot,
  state: FingerprintWalkState,
): void {
  for (let i = 0; i < HEIGHT_CONTRIBUTING_SIGNALS.length; i++) {
    const signalName = HEIGHT_CONTRIBUTING_SIGNALS[i]
    if (!signalName) continue
    const signal = snapshot.signals.get(signalName)
    if (!signal) continue
    if (signal.kind !== "known") continue
    if (signal.px !== null && signal.px > 0) {
      state.hasHeightContributingDescendant = true
      return
    }
  }
}

function checkVerticalAlignMitigation(
  snapshot: LayoutSignalSnapshot,
  state: FingerprintWalkState,
): void {
  const verticalAlign = snapshot.signals.get("vertical-align")
  if (!verticalAlign) return
  if (verticalAlign.kind !== "known") return
  if (VERTICAL_ALIGN_MITIGATIONS.has(verticalAlign.normalized)) {
    state.hasVerticalAlignMitigation = true
  }
}

/**
 * Checks if a display value represents a flex/inline-flex/grid container
 * with `align-items` set to a non-baseline value. This mitigates baseline
 * shift because the container controls alignment explicitly.
 */
function isAlignmentContextWithNonBaselineAlignment(
  display: string,
  hotSignals: LayoutSnapshotHotSignals | undefined,
): boolean {
  if (display !== "flex" && display !== "inline-flex" && display !== "grid" && display !== "inline-grid") return false
  if (!hotSignals) return false

  const alignItems = hotSignals.alignItems.value
  if (alignItems === null) return false
  return alignItems !== "baseline"
}

/**
 * Checks whether an inline-replaced element wraps mixed content internally
 * (both text and at least one other inline-replaced descendant). This
 * distinguishes wrapper containers (like a sort-header span with text + icon)
 * from leaf elements (like a badge that only contains text).
 */
function containsMixedContent(
  node: LayoutElementNode,
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>,
): boolean {
  const hasText = node.textualContent === LayoutTextualContentState.Yes || node.textualContent === LayoutTextualContentState.DynamicText
  const hasReplaced = false
  return scanMixedContent(node, childrenByParentNode, snapshotByElementNode, snapshotHotSignalsByElementKey, { hasText, hasReplaced })
}

function scanMixedContent(
  node: LayoutElementNode,
  childrenByParentNode: ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>,
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  snapshotHotSignalsByElementKey: ReadonlyMap<string, LayoutSnapshotHotSignals>,
  found: { hasText: boolean; hasReplaced: boolean },
): boolean {
  const children = childrenByParentNode.get(node)
  if (!children) return false

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    const childTag = child.tagName?.toLowerCase() ?? null
    const hotSignals = snapshotHotSignalsByElementKey.get(child.key)
    const childDisplay = hotSignals?.display.value ?? null

    if (childTag !== null && (isIntrinsicReplacedTag(childTag) || isControlReplacedTag(childTag))) {
      found.hasReplaced = true
      if (found.hasText) return true
      continue
    }

    if (childDisplay !== null && isBlockFormattingContextDisplay(childDisplay)) {
      continue
    }

    if (childDisplay !== null && isInlineReplacedDisplay(childDisplay)) {
      found.hasReplaced = true
      if (found.hasText) return true
      continue
    }

    if (child.textualContent === LayoutTextualContentState.Yes || child.textualContent === LayoutTextualContentState.DynamicText) {
      found.hasText = true
      if (found.hasReplaced) return true
    }

    if (childDisplay === null || isInlineContinuationDisplay(childDisplay)) {
      if (scanMixedContent(child, childrenByParentNode, snapshotByElementNode, snapshotHotSignalsByElementKey, found)) {
        return true
      }
    }
  }

  return false
}

function updateInlineReplacedKind(state: FingerprintWalkState, kind: InlineReplacedKind): void {
  if (state.inlineReplacedKind === null) {
    state.inlineReplacedKind = kind
    return
  }
  if (state.inlineReplacedKind !== kind) {
    state.inlineReplacedKind = "intrinsic"
  }
}

function updateMixedContentDepth(state: FingerprintWalkState, depth: number): void {
  if (state.mixedContentDepth === 0 || depth < state.mixedContentDepth) {
    state.mixedContentDepth = depth + 1
  }
}

function classifyFromState(
  state: FingerprintWalkState,
  elementNode: LayoutElementNode,
  hasOnlyBlockChildren: boolean,
): ContentCompositionClassification {
  if (hasOnlyBlockChildren) {
    return ContentCompositionClassification.BlockSegmented
  }

  if (state.totalChildCount === 0 && !state.hasTextContent) {
    if (elementNode.textualContent === LayoutTextualContentState.Unknown) return ContentCompositionClassification.Unknown
    if (elementNode.textualContent === LayoutTextualContentState.Yes || elementNode.textualContent === LayoutTextualContentState.DynamicText) {
      return ContentCompositionClassification.TextOnly
    }
    return ContentCompositionClassification.Unknown
  }

  if (state.analyzableChildCount === 0 && state.totalChildCount > 0) {
    return ContentCompositionClassification.Unknown
  }

  if (state.hasTextContent && state.hasInlineReplaced) {
    if (state.wrappingContextMitigates) return ContentCompositionClassification.MixedMitigated
    if (state.hasVerticalAlignMitigation) return ContentCompositionClassification.MixedMitigated
    return ContentCompositionClassification.MixedUnmitigated
  }

  if (!state.hasTextContent && state.hasInlineReplaced) {
    return ContentCompositionClassification.ReplacedOnly
  }

  if (state.hasTextContent && !state.hasInlineReplaced) {
    return ContentCompositionClassification.TextOnly
  }

  return ContentCompositionClassification.Unknown
}

function isIntrinsicReplacedTag(tag: string): boolean {
  return INTRINSIC_REPLACED_TAGS.has(tag)
}

function isControlReplacedTag(tag: string): boolean {
  return CONTROL_ELEMENT_TAGS.has(tag)
}

/**
 * Returns true when a display value establishes a formatting context that
 * isolates its children from the parent's baseline/inline calculations.
 * This includes both block-level (block, flex, grid) and inline-level
 * formatting contexts (inline-flex, inline-block, inline-grid).
 *
 * Only `inline` and `contents` are transparent to baseline propagation;
 * everything else creates a boundary.
 */
function establishesFormattingContext(display: string): boolean {
  return !INLINE_CONTINUATION_DISPLAYS.has(display)
}

function isBlockFormattingContextDisplay(display: string): boolean {
  return BLOCK_FORMATTING_CONTEXT_DISPLAYS.has(display)
}

function isInlineReplacedDisplay(display: string): boolean {
  return INLINE_REPLACED_DISPLAYS.has(display)
}

function isInlineContinuationDisplay(display: string): boolean {
  return INLINE_CONTINUATION_DISPLAYS.has(display)
}

/**
 * Resolves the composition divergence strength for a subject element relative
 * to its cohort's majority classification. Takes into account the parent
 * alignment context: when the parent uses `align-items: center` (not baseline),
 * content composition divergence is suppressed because the parent masks baseline
 * differences.
 *
 * Returns 0 when there is no divergence or when all siblings share the same
 * composition (no outlier to flag).
 */
export function resolveCompositionDivergenceStrength(
  subjectFingerprint: ContentCompositionFingerprint,
  allFingerprints: readonly ContentCompositionFingerprint[],
  parentContext: AlignmentContext | null,
): number {
  if (allFingerprints.length < 2) return 0

  if (parentContext !== null && !hasSharedBaselineAlignment(parentContext)) {
    return 0
  }

  const countByClassification = new Map<ContentCompositionClassification, number>()
  for (let i = 0; i < allFingerprints.length; i++) {
    const fp = allFingerprints[i]
    if (!fp) continue
    const normalized = normalizeClassificationForComparison(fp.classification)
    const existing = countByClassification.get(normalized) ?? 0
    countByClassification.set(normalized, existing + 1)
  }

  const subjectNormalized = normalizeClassificationForComparison(subjectFingerprint.classification)
  const subjectCount = countByClassification.get(subjectNormalized) ?? 0

  if (subjectCount === allFingerprints.length) {
    return resolveInlineReplacedKindDivergence(subjectFingerprint, allFingerprints)
  }

  let majorityClassification: ContentCompositionClassification = ContentCompositionClassification.Unknown
  let majorityCount = 0
  for (const [classification, count] of countByClassification) {
    if (count > majorityCount) {
      majorityCount = count
      majorityClassification = classification
    }
  }

  if (subjectNormalized === majorityClassification) {
    return resolveInlineReplacedKindDivergence(subjectFingerprint, allFingerprints)
  }

  if (subjectNormalized === ContentCompositionClassification.Unknown) {
    return 0
  }

  const cal = alignmentStrengthCalibration

  if (majorityClassification === ContentCompositionClassification.TextOnly && subjectNormalized === ContentCompositionClassification.MixedUnmitigated) {
    return cal.compositionMixedUnmitigatedOutlierStrength
  }

  if (majorityClassification === ContentCompositionClassification.ReplacedOnly && subjectNormalized === ContentCompositionClassification.MixedUnmitigated) {
    return cal.compositionMixedOutlierAmongReplacedStrength
  }

  if (majorityClassification === ContentCompositionClassification.MixedUnmitigated && subjectNormalized === ContentCompositionClassification.TextOnly) {
    return cal.compositionTextOutlierAmongMixedStrength
  }

  if (majorityClassification === ContentCompositionClassification.MixedUnmitigated && subjectNormalized === ContentCompositionClassification.ReplacedOnly) {
    return cal.compositionTextOutlierAmongMixedStrength
  }

  if (majorityClassification === ContentCompositionClassification.TextOnly && subjectNormalized === ContentCompositionClassification.ReplacedOnly) {
    return cal.compositionMixedOutlierAmongReplacedStrength
  }

  if (majorityClassification === ContentCompositionClassification.ReplacedOnly && subjectNormalized === ContentCompositionClassification.TextOnly) {
    return cal.compositionTextOutlierAmongMixedStrength
  }

  if (majorityClassification === ContentCompositionClassification.Unknown) {
    return 0
  }

  return cal.compositionUnknownPenalty
}

/**
 * Detects divergence within same-classification cohorts based on the type of
 * inline-replaced content. An `<img>` (intrinsic) and an `inline-block` `<span>`
 * (container) both classify as `mixed-unmitigated`, but have different baseline
 * behavior: intrinsic replaced elements use their bottom margin edge as the
 * baseline, while inline-block containers use their last text baseline.
 */
function resolveInlineReplacedKindDivergence(
  subjectFingerprint: ContentCompositionFingerprint,
  allFingerprints: readonly ContentCompositionFingerprint[],
): number {
  if (subjectFingerprint.inlineReplacedKind === null) return 0

  const countByKind = new Map<InlineReplacedKind, number>()
  for (let i = 0; i < allFingerprints.length; i++) {
    const fp = allFingerprints[i]
    if (!fp) continue
    const kind = fp.inlineReplacedKind
    if (kind === null) continue
    const existing = countByKind.get(kind) ?? 0
    countByKind.set(kind, existing + 1)
  }

  if (countByKind.size < 2) return 0

  const subjectKindCount = countByKind.get(subjectFingerprint.inlineReplacedKind) ?? 0
  if (subjectKindCount === allFingerprints.length) return 0

  return alignmentStrengthCalibration.compositionMixedOutlierAmongReplacedStrength
}

/**
 * Whether the alignment context uses baseline-sharing between siblings.
 *
 * Delegates to the pre-computed `baselineRelevance` field on `AlignmentContext`,
 * which is the single source of truth for whether baselines are consulted.
 *
 * See `context-model.ts::BaselineRelevance` for the CSS spec references
 * governing each context kind.
 */
function hasSharedBaselineAlignment(context: AlignmentContext): boolean {
  return context.baselineRelevance === "relevant"
}

/**
 * Resolves the majority classification for diagnostic messages.
 */
export function resolveMajorityClassification(
  allFingerprints: readonly ContentCompositionFingerprint[],
): ContentCompositionClassification {
  const countByClassification = new Map<ContentCompositionClassification, number>()
  for (let i = 0; i < allFingerprints.length; i++) {
    const fp = allFingerprints[i]
    if (!fp) continue
    const normalized = normalizeClassificationForComparison(fp.classification)
    const existing = countByClassification.get(normalized) ?? 0
    countByClassification.set(normalized, existing + 1)
  }

  let majorityClassification: ContentCompositionClassification = ContentCompositionClassification.Unknown
  let majorityCount = 0
  for (const [classification, count] of countByClassification) {
    if (count > majorityCount) {
      majorityCount = count
      majorityClassification = classification
    }
  }

  return majorityClassification
}

function normalizeClassificationForComparison(
  classification: ContentCompositionClassification,
): ContentCompositionClassification {
  if (classification === ContentCompositionClassification.MixedMitigated) return ContentCompositionClassification.TextOnly
  if (classification === ContentCompositionClassification.BlockSegmented) return ContentCompositionClassification.TextOnly
  return classification
}

/**
 * Resolves the evidence coverage for the content composition factor.
 * Coverage reflects how confidently the rule can determine the content
 * composition of the element and its cohort.
 */
export function resolveCompositionCoverage(
  subjectFingerprint: ContentCompositionFingerprint,
  allFingerprints: readonly ContentCompositionFingerprint[],
): number {
  if (allFingerprints.length < 2) return 0

  let analyzableCount = 0
  for (let i = 0; i < allFingerprints.length; i++) {
    const fp = allFingerprints[i]
    if (fp && fp.classification !== ContentCompositionClassification.Unknown) {
      analyzableCount++
    }
  }

  const analyzableShare = analyzableCount / allFingerprints.length

  if (subjectFingerprint.classification === ContentCompositionClassification.Unknown) {
    return analyzableShare * 0.3
  }

  if (subjectFingerprint.totalChildCount > 0 && subjectFingerprint.analyzableChildCount === 0) {
    return analyzableShare * 0.4
  }

  return analyzableShare
}

/**
 * Formats a human-readable description of a content composition classification.
 */
const COMPOSITION_LABELS: Record<ContentCompositionClassification, string> = {
  [ContentCompositionClassification.TextOnly]: "text-only",
  [ContentCompositionClassification.ReplacedOnly]: "inline-replaced-only",
  [ContentCompositionClassification.MixedUnmitigated]: "mixed text + inline-replaced",
  [ContentCompositionClassification.MixedMitigated]: "mixed (alignment mitigated)",
  [ContentCompositionClassification.BlockSegmented]: "block-segmented",
  [ContentCompositionClassification.Unknown]: "unknown",
}

export function formatCompositionClassification(
  classification: ContentCompositionClassification,
): string {
  return COMPOSITION_LABELS[classification]
}

/**
 * Generates a fix suggestion for a content composition conflict.
 */
export function formatCompositionFixSuggestion(
  subjectFingerprint: ContentCompositionFingerprint,
): string {
  if (subjectFingerprint.classification === ContentCompositionClassification.MixedUnmitigated) {
    if (subjectFingerprint.hasVerticalAlignMitigation) {
      return "verify vertical-align resolves the baseline shift"
    }
    return "add display: inline-flex; align-items: center to the wrapping container, or vertical-align: middle on the inline-replaced child"
  }
  return "ensure consistent content composition across siblings"
}
