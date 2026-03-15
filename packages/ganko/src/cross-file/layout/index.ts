export { LayoutScrollAxis } from "./graph"
export type {
  LayoutElementNode,
  LayoutElementRef,
  LayoutGraph,
  LayoutGraphTopology,
  LayoutGraphCascade,
  LayoutGraphFacts,
  LayoutGraphCohorts,
  LayoutGraphIndexes,
  LayoutMatchEdge,
  LayoutConditionalSignalDeltaFact,
  LayoutContainingBlockFact,
  LayoutFlowParticipationFact,
  LayoutNormalizedRuleDeclaration,
  LayoutReservedSpaceFact,
  LayoutReservedSpaceReason,
  LayoutScrollContainerFact,
  LayoutStatefulSelectorEntry,
  LayoutStyleRuleNode,
} from "./graph"
export { toLayoutElementKey } from "./graph"
export { ContextCertainty } from "./context-model"
export type {
  AlignmentContext,
  AlignmentContextKind,
  BaselineRelevance,
  InlineDirectionModel,
  LayoutAxisModel,
} from "./context-model"
export {
  AlignmentTextContrast,
  ContentCompositionClassification,
  CohortSubjectMembership,
  EvidenceValueKind,
  LayoutSignalGuard,
  LayoutSignalSource,
  LayoutSignalUnit,
  LayoutTextualContentState,
  SignalConflictValue,
} from "./signal-model"
export type {
  AlignmentCase,
  AlignmentCohort,
  AlignmentCohortFactSummary,
  ContentCompositionFingerprint,
  InlineReplacedKind,
  LayoutCohortStats,
  LayoutCohortSubjectStats,
  AlignmentCohortProfile,
  AlignmentCohortSignals,
  AlignmentFactorCoverage,
  AlignmentElementEvidence,
  AlignmentEvaluation,
  AlignmentFactorId,
  AlignmentFindingKind,
  CohortIdentifiability,
  EvidenceProvenance,
  EvidenceAtom,
  EvidenceWitness,
  LogOddsInterval,
  NumericEvidenceValue,
  PosteriorInterval,
  AlignmentSignalFinding,
  LayoutKnownSignalValue,
  LayoutSignalName,
  LayoutSignalSnapshot,
  LayoutSnapshotHotSignals,
  SignalConflictEvidence,
  LayoutSignalValue,
  LayoutUnknownSignalValue,
} from "./signal-model"
export { layoutSignalNames } from "./signal-model"
export { collectSignalSnapshot } from "./signal-collection"
export {
  getMonitoredSignalNames,
  isMonitoredSignal,
  isControlTag,
  isReplacedTag,
  normalizeSignalMap,
  normalizeSignalMapWithCounts,
} from "./signal-normalization"
export { classifyAlignmentContext, getContextElementRef, finalizeTableCellBaselineRelevance } from "./context-classification"
export { formatAlignmentCauses, formatPrimaryFix, orderAlignmentFindings } from "./diagnostics"
export { buildLayoutGraph } from "./build"
export type { LayoutPerfStats, LayoutPerfStatsMutable } from "./perf"
export {
  createLayoutPerfStats,
  snapshotLayoutPerfStats,
  publishLayoutPerfStatsForTest,
  getLatestLayoutPerfStatsForTest,
  maybeLogLayoutPerf,
} from "./perf"
export {
  computeContentCompositionFingerprint,
  formatCompositionClassification,
  formatCompositionFixSuggestion,
  resolveCompositionCoverage,
  resolveCompositionDivergence,
} from "./content-composition"
export { collectAlignmentCases } from "./case-builder"
export type { AlignmentEvaluationDecision, AlignmentRejectionDetail, AlignmentRejectionReason } from "./scoring"
export { evaluateAlignmentCase } from "./scoring"
export type { LayoutSignalFact } from "./consistency-domain"
export { collectSignalFacts, summarizeSignalFacts } from "./consistency-domain"
export type { ConsistencyEvidence } from "./consistency-evidence"
export { buildConsistencyEvidence } from "./consistency-evidence"
export type {
  ConsistencyPolicyDecision,
  ConsistencyPolicyInput,
  ConsistencyRejectDetail,
  ConsistencyRejectionReason,
} from "./consistency-policy"
export { applyConsistencyPolicy } from "./consistency-policy"
export type { LayoutEvidence, LayoutDetector, LayoutDetection } from "./rule-kit"
export { runLayoutDetector } from "./rule-kit"
export { collectCSSScopeBySolidFile } from "./scope"
export type { LayoutBlockOffsetDelta, LayoutBlockOffsetEstimate } from "./offset"
export {
  computeBlockOffsetDelta,
  computeBlockOffsetDeltaWithDeclared,
  estimateBlockOffset,
  estimateBlockOffsetWithDeclared,
} from "./offset"
export { isEquivalentOffset, layoutOffsetSignals, parseOffsetPx } from "./offset-baseline"
export {
  hasEffectivePosition,
  readBaselineOffsetFacts,
  readConditionalSignalDeltaFact,
  readContainingBlockFact,
  readDynamicSlotCandidateElements,
  readElementRef,
  readElementRefById,
  readElementsByKnownSignalValue,
  readElementsByTagName,
  readElementsWithConditionalOffsetDelta,
  readElementsWithConditionalOverflowDelta,
  readElementsWithConditionalSignalDelta,
  readFlowParticipationFact,
  readReservedSpaceFact,
  readScrollContainerElements,
  readScrollContainerFact,
  readStatefulBaseValueIndex,
  readStatefulNormalizedDeclarationsByRuleId,
  readStatefulSelectorEntriesByRuleId,
  readNormalizedSignalEvidence,
  readNumericSignalEvidence,
  readKnownNormalized,
  readKnownNormalizedWithGuard,
  readKnownPx,
  readKnownSignal,
  readKnownSignalWithGuard,
} from "./signal-access"
