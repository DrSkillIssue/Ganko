import type { AlignmentContext, AlignmentContextKind, ContextCertainty } from "./context-model"
import type { LayoutGuardConditionProvenance } from "./guard-model"

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
] as const

export type LayoutSignalName = (typeof layoutSignalNames)[number]

export type LayoutSignalSource = "selector" | "inline-style"

export type LayoutSignalGuard = "unconditional" | "conditional"

export interface LayoutGuardProvenance {
  readonly kind: LayoutSignalGuard
  readonly conditions: readonly LayoutGuardConditionProvenance[]
  readonly key: string
}

export type LayoutSignalUnit = "px" | "unitless" | "keyword" | "unknown"

export interface LayoutKnownSignalValue {
  readonly kind: "known"
  readonly name: LayoutSignalName
  readonly raw: string
  readonly normalized: string
  readonly source: LayoutSignalSource
  readonly guard: LayoutSignalGuard
  readonly guardProvenance: LayoutGuardProvenance
  readonly unit: LayoutSignalUnit
  readonly px: number | null
  readonly quality: "exact" | "estimated"
}

export interface LayoutUnknownSignalValue {
  readonly kind: "unknown"
  readonly name: LayoutSignalName
  readonly raw: string | null
  readonly source: LayoutSignalSource | null
  readonly guard: LayoutSignalGuard
  readonly guardProvenance: LayoutGuardProvenance
  readonly reason: string
}

export type LayoutSignalValue = LayoutKnownSignalValue | LayoutUnknownSignalValue

export type LayoutTextualContentState = "yes" | "no" | "unknown" | "dynamic-text"

export interface LayoutSignalSnapshot {
  readonly solidFile: string
  readonly elementId: number
  readonly elementKey: string
  readonly tag: string | null
  readonly textualContent: LayoutTextualContentState
  readonly isControl: boolean
  readonly isReplaced: boolean
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

export type AlignmentTextContrast = "different" | "same" | "unknown"

export type SignalConflictValue = "conflict" | "aligned" | "unknown"

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

export type CohortSubjectMembership = "dominant" | "nondominant" | "ambiguous" | "insufficient"

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

export type ContentCompositionClassification =
  | "text-only"
  | "replaced-only"
  | "mixed-unmitigated"
  | "mixed-mitigated"
  | "block-segmented"
  | "unknown"

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

export type EvidenceValueKind = "exact" | "interval" | "conditional" | "unknown"

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
