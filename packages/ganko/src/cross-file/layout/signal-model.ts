import type { AlignmentContext, AlignmentContextKind, ContextCertainty } from "./context-model"
import type { LayoutElementNode } from "./graph"
import type { LayoutGuardConditionProvenance, LayoutRuleGuard } from "./guard-model"

export const layoutSignalNames = [
  "line-height",
  "font-size",
  "width",
  "inline-size",
  "height",
  "block-size",
  "min-width",
  "min-block-size",
  "min-height",
  "max-width",
  "max-height",
  "aspect-ratio",
  "vertical-align",
  "display",
  "white-space",
  "object-fit",
  "overflow",
  "overflow-y",
  "overflow-anchor",
  "scrollbar-gutter",
  "scrollbar-width",
  "contain-intrinsic-size",
  "content-visibility",
  "align-items",
  "align-self",
  "justify-items",
  "place-items",
  "place-self",
  "flex-direction",
  "flex-basis",
  "grid-auto-flow",
  "appearance",
  "box-sizing",
  "padding-top",
  "padding-left",
  "padding-right",
  "padding-bottom",
  "border-top-width",
  "border-left-width",
  "border-right-width",
  "border-bottom-width",
  "position",
  "top",
  "bottom",
  "margin-top",
  "margin-bottom",
  "transform",
  "translate",
  "inset-block-start",
  "inset-block-end",
  "writing-mode",
  "direction",
  "contain",
] as const

export type LayoutSignalName = (typeof layoutSignalNames)[number]

export const enum LayoutSignalSource { Selector = 0, InlineStyle = 1 }

export const enum LayoutSignalGuard { Unconditional = 0, Conditional = 1 }

export const enum LayoutSignalUnit { Px = 0, Unitless = 1, Keyword = 2, Unknown = 3 }

export const enum SignalValueKind { Known = 0, Unknown = 1 }

export const enum SignalQuality { Exact = 0, Estimated = 1 }

export interface LayoutKnownSignalValue {
  readonly kind: SignalValueKind.Known
  readonly name: LayoutSignalName
  readonly normalized: string
  readonly source: LayoutSignalSource
  readonly guard: LayoutRuleGuard
  readonly unit: LayoutSignalUnit
  readonly px: number | null
  readonly quality: SignalQuality
}

export interface LayoutUnknownSignalValue {
  readonly kind: SignalValueKind.Unknown
  readonly name: LayoutSignalName
  readonly source: LayoutSignalSource | null
  readonly guard: LayoutRuleGuard
  readonly reason: string
}

export type LayoutSignalValue = LayoutKnownSignalValue | LayoutUnknownSignalValue

export const enum LayoutTextualContentState { Yes = 0, No = 1, Unknown = 2, DynamicText = 3 }

export interface LayoutSignalSnapshot {
  readonly node: LayoutElementNode
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}

export interface AlignmentElementEvidence {
  readonly solidFile: string
  readonly elementKey: string
  readonly elementId: number
  readonly tag: string | null
  readonly snapshot: LayoutSignalSnapshot
}

export interface AlignmentCohort {
  readonly parentElementKey: string
  readonly parentElementId: number
  readonly parentTag: string | null
  readonly siblingCount: number
}

export const enum AlignmentTextContrast { Different = 0, Same = 1, Unknown = 2 }

export const enum SignalConflictValue { Conflict = 0, Aligned = 1, Unknown = 2 }

export interface SignalConflictEvidence {
  readonly value: SignalConflictValue
  readonly kind: EvidenceValueKind
}

export interface AlignmentCohortSignals {
  readonly verticalAlign: SignalConflictEvidence
  readonly alignSelf: SignalConflictEvidence
  readonly placeSelf: SignalConflictEvidence
  readonly hasControlOrReplacedPeer: boolean
  readonly textContrastWithPeers: AlignmentTextContrast
}

export const enum CohortSubjectMembership { Dominant = 0, Nondominant = 1, Ambiguous = 2, Insufficient = 3 }

export interface CohortIdentifiability {
  readonly dominantShare: number
  readonly subjectExcludedDominantShare: number
  readonly subjectMembership: CohortSubjectMembership
  readonly ambiguous: boolean
  readonly kind: EvidenceValueKind
}

export interface AlignmentCohortProfile {
  readonly medianDeclaredOffsetPx: number | null
  readonly declaredOffsetDispersionPx: number | null
  readonly medianEffectiveOffsetPx: number | null
  readonly effectiveOffsetDispersionPx: number | null
  readonly medianLineHeightPx: number | null
  readonly lineHeightDispersionPx: number | null
  readonly dominantClusterSize: number
  readonly dominantClusterShare: number
  readonly unimodal: boolean
}

export type AlignmentFactorCoverage = Readonly<Record<AlignmentFactorId, number>>

export interface AlignmentCohortFactSummary {
  readonly exact: number
  readonly interval: number
  readonly unknown: number
  readonly conditional: number
  readonly total: number
  readonly exactShare: number
  readonly intervalShare: number
  readonly unknownShare: number
  readonly conditionalShare: number
}

export interface HotEvidenceWitness<T> extends EvidenceWitness<T> {
  readonly present: boolean
}

export type HotNumericSignalEvidence = HotEvidenceWitness<number>

export type HotNormalizedSignalEvidence = HotEvidenceWitness<string>

export interface LayoutSnapshotHotSignals {
  readonly lineHeight: HotNumericSignalEvidence
  readonly verticalAlign: HotNormalizedSignalEvidence
  readonly alignSelf: HotNormalizedSignalEvidence
  readonly placeSelf: HotNormalizedSignalEvidence
  readonly flexDirection: HotNormalizedSignalEvidence
  readonly gridAutoFlow: HotNormalizedSignalEvidence
  readonly writingMode: HotNormalizedSignalEvidence
  readonly direction: HotNormalizedSignalEvidence
  readonly display: HotNormalizedSignalEvidence
  readonly alignItems: HotNormalizedSignalEvidence
  readonly placeItems: HotNormalizedSignalEvidence
  readonly position: HotNormalizedSignalEvidence
  readonly insetBlockStart: HotNumericSignalEvidence
  readonly insetBlockEnd: HotNumericSignalEvidence
  readonly transform: HotNumericSignalEvidence
  readonly translate: HotNumericSignalEvidence
  readonly top: HotNumericSignalEvidence
  readonly bottom: HotNumericSignalEvidence
  readonly marginTop: HotNumericSignalEvidence
  readonly marginBottom: HotNumericSignalEvidence
}

export interface LayoutCohortSubjectStats {
  readonly element: AlignmentElementEvidence
  readonly declaredOffset: NumericEvidenceValue
  readonly effectiveOffset: NumericEvidenceValue
  readonly lineHeight: NumericEvidenceValue
  readonly baselineProfile: AlignmentCohortProfile
  readonly signals: AlignmentCohortSignals
  readonly identifiability: CohortIdentifiability
  readonly contentComposition: ContentCompositionFingerprint
}

export interface LayoutCohortStats {
  readonly profile: AlignmentCohortProfile
  readonly snapshots: readonly LayoutSignalSnapshot[]
  readonly factSummary: AlignmentCohortFactSummary
  readonly provenance: EvidenceProvenance
  readonly conditionalSignalCount: number
  readonly totalSignalCount: number
  readonly subjectsByElementKey: ReadonlyMap<string, LayoutCohortSubjectStats>
  /** Element keys excluded from cohort analysis (e.g. visually-hidden accessible elements). */
  readonly excludedElementKeys: ReadonlySet<string>
}

export interface AlignmentCase {
  readonly subject: AlignmentElementEvidence
  readonly cohort: AlignmentCohort
  readonly cohortProfile: AlignmentCohortProfile
  readonly cohortSignals: AlignmentCohortSignals
  readonly subjectIdentifiability: CohortIdentifiability
  readonly factorCoverage: AlignmentFactorCoverage
  readonly cohortSnapshots: readonly LayoutSignalSnapshot[]
  readonly cohortFactSummary: AlignmentCohortFactSummary
  readonly cohortProvenance: EvidenceProvenance
  readonly subjectDeclaredOffsetDeviation: NumericEvidenceValue
  readonly subjectEffectiveOffsetDeviation: NumericEvidenceValue
  readonly subjectLineHeightDeviation: NumericEvidenceValue
  readonly context: AlignmentContext
  readonly subjectContentComposition: ContentCompositionFingerprint
  readonly cohortContentCompositions: readonly ContentCompositionFingerprint[]
}

export type AlignmentFindingKind =
  | "offset-delta"
  | "declared-offset-delta"
  | "baseline-conflict"
  | "context-conflict"
  | "replaced-control-risk"
  | "content-composition-conflict"

export type AlignmentFactorId =
  | "offset-delta"
  | "declared-offset-delta"
  | "baseline-conflict"
  | "context-conflict"
  | "replaced-control-risk"
  | "content-composition-conflict"
  | "context-certainty"

export const enum ContentCompositionClassification {
  TextOnly = 0, ReplacedOnly = 1, MixedUnmitigated = 2,
  MixedMitigated = 3, BlockSegmented = 4, Unknown = 5,
}

/**
 * Distinguishes intrinsically-replaced elements (img, svg, video, canvas) from
 * inline-block/inline-flex containers. Their baseline rules differ: an img uses
 * its bottom edge as the baseline, while an inline-block uses its last line of text.
 */
export type InlineReplacedKind = "intrinsic" | "container"

export interface ContentCompositionFingerprint {
  readonly hasTextContent: boolean
  readonly hasInlineReplaced: boolean
  readonly inlineReplacedKind: InlineReplacedKind | null
  readonly hasHeightContributingDescendant: boolean
  readonly wrappingContextMitigates: boolean
  readonly hasVerticalAlignMitigation: boolean
  readonly mixedContentDepth: number
  readonly classification: ContentCompositionClassification
  readonly analyzableChildCount: number
  readonly totalChildCount: number
  readonly hasOnlyBlockChildren: boolean
}

export const enum EvidenceValueKind { Exact = 0, Interval = 1, Conditional = 2, Unknown = 3 }

export interface EvidenceWitness<T> {
  readonly value: T | null
  readonly kind: EvidenceValueKind
}

export type NumericEvidenceValue = EvidenceWitness<number>

export interface EvidenceProvenance {
  readonly reason: string
  readonly guardKey: string
  readonly guards: readonly LayoutGuardConditionProvenance[]
}

export interface LogOddsInterval {
  readonly min: number
  readonly max: number
}

export interface EvidenceAtom {
  readonly factorId: AlignmentFactorId
  readonly valueKind: EvidenceValueKind
  readonly contribution: LogOddsInterval
  readonly provenance: EvidenceProvenance
  readonly relevanceWeight: number
  readonly coverage: number
}

export interface PosteriorInterval {
  readonly lower: number
  readonly upper: number
}

export interface AlignmentSignalFinding {
  readonly kind: AlignmentFindingKind
  readonly message: string
  readonly fix: string
  readonly weight: number
}

export interface AlignmentEvaluation {
  readonly severity: number
  readonly confidence: number
  readonly declaredOffsetPx: number | null
  readonly estimatedOffsetPx: number | null
  readonly contextKind: AlignmentContextKind
  readonly contextCertainty: ContextCertainty
  readonly posterior: PosteriorInterval
  readonly evidenceMass: number
  readonly topFactors: readonly AlignmentFactorId[]
  readonly signalFindings: readonly AlignmentSignalFinding[]
}
