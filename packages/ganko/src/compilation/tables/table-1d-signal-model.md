# Table 1D: Signal Model Type Fidelity

Every type in the signal/guard/context model mapped to its new-system equivalent.

**Rule**: No field may be lost. Discriminated unions must be preserved. String literal unions must not widen to `string`.

| # | Existing type | Key fields | New type | Fields preserved | Resolution |
|---|--------------|------------|----------|-----------------|------------|
| 1 | `LayoutSignalSnapshot` | node, signals (Map<LayoutSignalName, LayoutSignalValue>), knownSignalCount, unknownSignalCount, conditionalSignalCount | `SignalSnapshot` | ALL preserved. `LayoutSignalName` stays as 55-literal string union (NOT `string`). | Direct rename. |
| 2 | `LayoutKnownSignalValue` | kind: Known, name, normalized, source, guard, unit, px, quality | `KnownSignalValue` | ALL preserved. Part of `SignalValue` discriminated union. | Discriminated union preserved: `SignalValue = KnownSignalValue | UnknownSignalValue`. |
| 3 | `LayoutUnknownSignalValue` | kind: Unknown, name, source, guard, reason | `UnknownSignalValue` | ALL preserved including `reason: string`. | reason field is critical for diagnostic messages. |
| 4 | `LayoutRuleGuard` | Discriminated: {kind: Unconditional, conditions: [], key} \| {kind: Conditional, conditions: LayoutGuardConditionProvenance[], key} | `RuleGuard` | ALL preserved. `conditions` and `key` fields MUST be present. | NOT collapsed to `kind: number`. Full guard provenance chain preserved. |
| 5 | `LayoutGuardConditionProvenance` | kind: 'media'\|'supports'\|'container'\|'dynamic-attribute', query, key | `GuardConditionProvenance` | ALL preserved. | Used by conditional delta rules and stateful rules. |
| 6 | `LayoutSnapshotHotSignals` | 20 named signal evidence fields (lineHeight, verticalAlign, ...) | `SnapshotHotSignals` | ALL 20 fields preserved. | Internal to cohort analysis. Not on SemanticModel API. Extracted from SignalSnapshot during CohortIndexBuilder. |
| 7 | `HotEvidenceWitness<T>` | present, value: T\|null, kind: EvidenceValueKind | `HotEvidenceWitness<T>` | ALL preserved. | Generic witness type for hot signal extraction. |
| 8 | `AlignmentContext` | ALL 16+ fields: kind, certainty, crossAxisIsBlockAxis, baselineRelevance, parentDisplay, parentAlignItems, parentSolidFile, parentElementId, parentElementKey, parentTag, axis, axisCertainty, inlineDirection, inlineDirectionCertainty, parentPlaceItems, hasPositionedOffset, crossAxisIsBlockAxisCertainty, evidence | `AlignmentContext` | ALL 16+ fields preserved. NOT truncated to 6. | Previous SPEC had only 6 fields. Must have all. |
| 9 | `AlignmentCase` | subject, cohort, cohortProfile, cohortSignals, subjectIdentifiability, factorCoverage, cohortSnapshots, cohortFactSummary, cohortProvenance, offsets, context, contentComposition, cohortContentCompositions | `AlignmentCase` | ALL preserved. | Input to Bayesian evaluateAlignmentCase(). |
| 10 | `AlignmentEvaluation` | severity, confidence, offsets, contextKind, contextCertainty, posterior, evidenceMass, topFactors, signalFindings | `AlignmentEvaluation` | ALL preserved. | Output of evaluateAlignmentCase(). |
| 11 | `ContentCompositionFingerprint` | hasTextContent, hasInlineReplaced, inlineReplacedKind, hasHeightContributingDescendant, wrappingContextMitigates, hasVerticalAlignMitigation, mixedContentDepth, classification, analyzableChildCount, totalChildCount, hasOnlyBlockChildren | `ContentCompositionFingerprint` | ALL preserved. | On CohortSubjectStats.contentComposition. |
| 12 | `AlignmentCohortSignals` | verticalAlign, alignSelf, placeSelf, hasControlOrReplacedPeer, textContrastWithPeers | `AlignmentCohortSignals` | ALL preserved. | On CohortSubjectStats.signals. |
| 13 | `LayoutCohortStats` | profile, snapshots, factSummary, provenance, conditionalSignalCount, totalSignalCount, subjectsByElementKey, excludedElementKeys | `CohortStats` | ALL preserved including factSummary, provenance, conditionalSignalCount, totalSignalCount. | Previous SPEC was missing 4 fields. |
| 14 | `LayoutCohortSubjectStats` | element, declaredOffset, effectiveOffset, lineHeight, baselineProfile, signals, identifiability, contentComposition | `CohortSubjectStats` | ALL preserved including signals (AlignmentCohortSignals) and contentComposition. | Previous SPEC was missing signals and contentComposition. |
| 15 | `EvidenceProvenance` | reason, guardKey, guards: LayoutGuardConditionProvenance[] | `EvidenceProvenance` | ALL preserved. | On CohortStats.provenance. |
| 16 | `AlignmentCohortFactSummary` | exact, interval, unknown, conditional, total, exactShare, intervalShare, unknownShare, conditionalShare | `AlignmentCohortFactSummary` | ALL preserved. | On CohortStats.factSummary. |
| 17 | `LayoutNormalizedRuleDeclaration` | declarationId, property, normalizedValue, filePath, startLine, startColumn, propertyLength | `NormalizedRuleDeclaration` | ALL preserved. | Used by stateful rule analysis. |
| 18 | `LayoutStatefulSelectorEntry` | raw, isStateful, statePseudoClasses, isDirectInteraction, baseLookupKeys | `StatefulSelectorEntry` | ALL preserved. |  |
| 19 | `SignalConflictEvidence` | value: SignalConflictValue, kind: EvidenceValueKind | `SignalConflictEvidence` | ALL preserved. |  |
| 20 | `CohortIdentifiability` | dominantShare, subjectExcludedDominantShare, subjectMembership, ambiguous, kind | `CohortIdentifiability` | ALL preserved. |  |
| 21 | `AlignmentCohortProfile` | medianDeclaredOffsetPx, declaredOffsetDispersionPx, medianEffectiveOffsetPx, effectiveOffsetDispersionPx, medianLineHeightPx, lineHeightDispersionPx, dominantClusterSize, dominantClusterShare, unimodal | `CohortProfile` | ALL preserved. |  |
| 22 | `EvidenceAtom` | factorId, valueKind, contribution: LogOddsInterval, provenance, relevanceWeight, coverage | `EvidenceAtom` | ALL preserved. | Bayesian evidence atom. |
| 23 | `AlignmentSignalFinding` | kind, message, fix, weight | `AlignmentSignalFinding` | ALL preserved. |  |

## Enums (preserved as const enums)

| Existing enum | Values | New enum | Status |
|--------------|--------|----------|--------|
| `LayoutSignalSource` | Selector=0, InlineStyle=1 | Same name, drop Layout prefix if present | Preserved |
| `LayoutSignalGuard` | Unconditional=0, Conditional=1 | Same name, drop Layout prefix if present | Preserved |
| `LayoutSignalUnit` | Px=0, Unitless=1, Keyword=2, Unknown=3 | Same name, drop Layout prefix if present | Preserved |
| `SignalValueKind` | Known=0, Unknown=1 | Same name, drop Layout prefix if present | Preserved |
| `SignalQuality` | Exact=0, Estimated=1 | Same name, drop Layout prefix if present | Preserved |
| `LayoutTextualContentState` | Yes=0, No=1, Unknown=2, DynamicText=3 | Same name, drop Layout prefix if present | Preserved |
| `LayoutScrollAxis` | None=0, X=1, Y=2, Both=3 | Same name, drop Layout prefix if present | Preserved |
| `EvidenceValueKind` | Exact=0, Interval=1, Conditional=2, Unknown=3 | Same name, drop Layout prefix if present | Preserved |
| `AlignmentTextContrast` | Different=0, Same=1, Unknown=2 | Same name, drop Layout prefix if present | Preserved |
| `SignalConflictValue` | Conflict=0, Aligned=1, Unknown=2 | Same name, drop Layout prefix if present | Preserved |
| `CohortSubjectMembership` | Dominant=0, Nondominant=1, Ambiguous=2, Insufficient=3 | Same name, drop Layout prefix if present | Preserved |
| `ContentCompositionClassification` | TextOnly=0, ReplacedOnly=1, MixedUnmitigated=2, MixedMitigated=3, BlockSegmented=4, Unknown=5 | Same name, drop Layout prefix if present | Preserved |