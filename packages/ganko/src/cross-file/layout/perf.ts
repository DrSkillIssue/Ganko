import type { Logger } from "@drskillissue/ganko-shared"
import { selectKth } from "./util"

export interface LayoutPerfStats {
  readonly elementsScanned: number
  readonly selectorCandidatesChecked: number
  readonly compiledSelectorCount: number
  readonly selectorsRejectedUnsupported: number
  readonly selectorsGuardedConditional: number
  readonly ancestryChecks: number
  readonly matchEdgesCreated: number
  readonly casesScored: number
  readonly casesCollected: number
  readonly casesRejectedLowEvidence: number
  readonly casesRejectedThreshold: number
  readonly casesRejectedUndecidable: number
  readonly casesRejectedIdentifiability: number
  readonly undecidableInterval: number
  readonly conditionalSignalRatio: number
  readonly conditionalSignals: number
  readonly totalSignals: number
  readonly cohortUnimodalFalse: number
  readonly factorCoverageMean: number
  readonly posteriorWidthP95: number
  readonly uncertaintyEscalations: number
  readonly signalSnapshotsBuilt: number
  readonly signalSnapshotCacheHits: number
  readonly measurementIndexHits: number
  readonly contextsClassified: number
  readonly diagnosticsEmitted: number
  readonly selectorIndexMs: number
  readonly selectorMatchMs: number
  readonly cascadeBuildMs: number
  readonly caseBuildMs: number
  readonly scoringMs: number
  readonly elapsedMs: number
}

export interface LayoutPerfStatsMutable {
  elementsScanned: number
  selectorCandidatesChecked: number
  compiledSelectorCount: number
  selectorsRejectedUnsupported: number
  selectorsGuardedConditional: number
  ancestryChecks: number
  matchEdgesCreated: number
  casesScored: number
  casesCollected: number
  casesRejectedLowEvidence: number
  casesRejectedThreshold: number
  casesRejectedUndecidable: number
  casesRejectedIdentifiability: number
  undecidableInterval: number
  conditionalSignals: number
  totalSignals: number
  cohortUnimodalFalse: number
  factorCoverageSum: number
  factorCoverageCount: number
  posteriorWidths: number[]
  uncertaintyEscalations: number
  signalSnapshotsBuilt: number
  signalSnapshotCacheHits: number
  measurementIndexHits: number
  contextsClassified: number
  diagnosticsEmitted: number
  selectorIndexMs: number
  selectorMatchMs: number
  cascadeBuildMs: number
  caseBuildMs: number
  scoringMs: number
  elapsedMs: number
}

const EMPTY_STATS: LayoutPerfStats = {
  elementsScanned: 0,
  selectorCandidatesChecked: 0,
  compiledSelectorCount: 0,
  selectorsRejectedUnsupported: 0,
  selectorsGuardedConditional: 0,
  ancestryChecks: 0,
  matchEdgesCreated: 0,
  casesScored: 0,
  casesCollected: 0,
  casesRejectedLowEvidence: 0,
  casesRejectedThreshold: 0,
  casesRejectedUndecidable: 0,
  casesRejectedIdentifiability: 0,
  undecidableInterval: 0,
  conditionalSignalRatio: 0,
  conditionalSignals: 0,
  totalSignals: 0,
  cohortUnimodalFalse: 0,
  factorCoverageMean: 0,
  posteriorWidthP95: 0,
  uncertaintyEscalations: 0,
  signalSnapshotsBuilt: 0,
  signalSnapshotCacheHits: 0,
  measurementIndexHits: 0,
  contextsClassified: 0,
  diagnosticsEmitted: 0,
  selectorIndexMs: 0,
  selectorMatchMs: 0,
  cascadeBuildMs: 0,
  caseBuildMs: 0,
  scoringMs: 0,
  elapsedMs: 0,
}

let lastStats: LayoutPerfStats = EMPTY_STATS

export function createLayoutPerfStats(): LayoutPerfStatsMutable {
  return {
    elementsScanned: 0,
    selectorCandidatesChecked: 0,
    compiledSelectorCount: 0,
    selectorsRejectedUnsupported: 0,
    selectorsGuardedConditional: 0,
    ancestryChecks: 0,
    matchEdgesCreated: 0,
    casesScored: 0,
    casesCollected: 0,
    casesRejectedLowEvidence: 0,
    casesRejectedThreshold: 0,
    casesRejectedUndecidable: 0,
    casesRejectedIdentifiability: 0,
    undecidableInterval: 0,
    conditionalSignals: 0,
    totalSignals: 0,
    cohortUnimodalFalse: 0,
    factorCoverageSum: 0,
    factorCoverageCount: 0,
    posteriorWidths: [],
    uncertaintyEscalations: 0,
    signalSnapshotsBuilt: 0,
    signalSnapshotCacheHits: 0,
    measurementIndexHits: 0,
    contextsClassified: 0,
    diagnosticsEmitted: 0,
    selectorIndexMs: 0,
    selectorMatchMs: 0,
    cascadeBuildMs: 0,
    caseBuildMs: 0,
    scoringMs: 0,
    elapsedMs: 0,
  }
}

export function snapshotLayoutPerfStats(stats: LayoutPerfStatsMutable): LayoutPerfStats {
  const conditionalSignalRatio = stats.totalSignals === 0
    ? 0
    : stats.conditionalSignals / stats.totalSignals
  const factorCoverageMean = stats.factorCoverageCount === 0
    ? 0
    : stats.factorCoverageSum / stats.factorCoverageCount
  const posteriorWidthP95 = computeP95(stats.posteriorWidths)

  return {
    elementsScanned: stats.elementsScanned,
    selectorCandidatesChecked: stats.selectorCandidatesChecked,
    compiledSelectorCount: stats.compiledSelectorCount,
    selectorsRejectedUnsupported: stats.selectorsRejectedUnsupported,
    selectorsGuardedConditional: stats.selectorsGuardedConditional,
    ancestryChecks: stats.ancestryChecks,
    matchEdgesCreated: stats.matchEdgesCreated,
    casesScored: stats.casesScored,
    casesCollected: stats.casesCollected,
    casesRejectedLowEvidence: stats.casesRejectedLowEvidence,
    casesRejectedThreshold: stats.casesRejectedThreshold,
    casesRejectedUndecidable: stats.casesRejectedUndecidable,
    casesRejectedIdentifiability: stats.casesRejectedIdentifiability,
    undecidableInterval: stats.undecidableInterval,
    conditionalSignalRatio,
    conditionalSignals: stats.conditionalSignals,
    totalSignals: stats.totalSignals,
    cohortUnimodalFalse: stats.cohortUnimodalFalse,
    factorCoverageMean,
    posteriorWidthP95,
    uncertaintyEscalations: stats.uncertaintyEscalations,
    signalSnapshotsBuilt: stats.signalSnapshotsBuilt,
    signalSnapshotCacheHits: stats.signalSnapshotCacheHits,
    measurementIndexHits: stats.measurementIndexHits,
    contextsClassified: stats.contextsClassified,
    diagnosticsEmitted: stats.diagnosticsEmitted,
    selectorIndexMs: stats.selectorIndexMs,
    selectorMatchMs: stats.selectorMatchMs,
    cascadeBuildMs: stats.cascadeBuildMs,
    caseBuildMs: stats.caseBuildMs,
    scoringMs: stats.scoringMs,
    elapsedMs: stats.elapsedMs,
  }
}

export function publishLayoutPerfStatsForTest(stats: LayoutPerfStatsMutable): void {
  lastStats = snapshotLayoutPerfStats(stats)
}

export function getLatestLayoutPerfStatsForTest(): LayoutPerfStats {
  return lastStats
}

export function maybeLogLayoutPerf(stats: LayoutPerfStatsMutable, log?: Logger): void {
  if (process.env["SOLID_LINT_LAYOUT_PROFILE"] !== "1") return
  if (!log || !log.enabled) return
  const view = snapshotLayoutPerfStats(stats)
  log.debug(
    `[layout] elements=${view.elementsScanned}`
    + ` candidates=${view.selectorCandidatesChecked}`
    + ` compiledSelectors=${view.compiledSelectorCount}`
    + ` unsupportedSelectors=${view.selectorsRejectedUnsupported}`
    + ` conditionalSelectors=${view.selectorsGuardedConditional}`
    + ` ancestryChecks=${view.ancestryChecks}`
    + ` edges=${view.matchEdgesCreated}`
    + ` collected=${view.casesCollected}`
    + ` cases=${view.casesScored}`
    + ` rejectLowEvidence=${view.casesRejectedLowEvidence}`
    + ` rejectThreshold=${view.casesRejectedThreshold}`
    + ` rejectUndecidable=${view.casesRejectedUndecidable}`
    + ` rejectIdentifiability=${view.casesRejectedIdentifiability}`
    + ` undecidableInterval=${view.undecidableInterval}`
    + ` conditionalSignalRatio=${Math.round(view.conditionalSignalRatio * 1000) / 1000}`
    + ` conditionalSignals=${view.conditionalSignals}`
    + ` totalSignals=${view.totalSignals}`
    + ` cohortUnimodalFalse=${view.cohortUnimodalFalse}`
    + ` factorCoverageMean=${Math.round(view.factorCoverageMean * 1000) / 1000}`
    + ` posteriorWidthP95=${Math.round(view.posteriorWidthP95 * 1000) / 1000}`
    + ` uncertaintyEscalations=${view.uncertaintyEscalations}`
    + ` snapshots=${view.signalSnapshotsBuilt}`
    + ` snapshotHits=${view.signalSnapshotCacheHits}`
    + ` measurementIndexHits=${view.measurementIndexHits}`
    + ` contexts=${view.contextsClassified}`
    + ` diagnostics=${view.diagnosticsEmitted}`
    + ` selectorIndexMs=${Math.round(view.selectorIndexMs * 100) / 100}`
    + ` selectorMatchMs=${Math.round(view.selectorMatchMs * 100) / 100}`
    + ` cascadeBuildMs=${Math.round(view.cascadeBuildMs * 100) / 100}`
    + ` caseBuildMs=${Math.round(view.caseBuildMs * 100) / 100}`
    + ` scoringMs=${Math.round(view.scoringMs * 100) / 100}`
    + ` elapsedMs=${Math.round(view.elapsedMs * 100) / 100}`,
  )
}

function computeP95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const scratch = [...values]
  const index = Math.ceil(scratch.length * 0.95) - 1
  const clamped = index <= 0 ? 0 : index >= scratch.length ? scratch.length - 1 : index
  return selectKth(scratch, clamped)
}
