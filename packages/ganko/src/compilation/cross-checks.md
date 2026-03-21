# Mandatory Cross-Checks
## CHECK 1: Table rows → Section 2 types
Every preserved/mapped row in dissolution tables must reference a type defined in SPEC.ts.
**PASS**: All table rows reference types defined in SPEC.ts.

## CHECK 2: Section 2 types → Section 3 phases
Every exported type in SPEC.ts must be created by exactly one implementation phase.
**Types with no phase**: StyleSymbolKind, AdditionalInput, AdditionalInputKind, TailwindConfigInput, PackageManifestInput, TSConfigInput, TailwindDesignSystem, createStyleCompilation, StyleCompilationOptions, LayoutSignalName, KnownSignalValue, UnknownSignalValue, SignalValueKind, SignalUnit, SignalQuality, GuardConditionKind, GuardConditionProvenance, SignalGuardKind, AlignmentContextKind, LayoutAxisModel, InlineDirectionModel, LayoutContextContainerKind, ContextCertainty, BaselineRelevance, LayoutContextEvidence, CohortFactSummary, EvidenceProvenance, EvidenceValueKind, EvidenceWitness, NumericEvidenceValue, AlignmentTextContrast, SignalConflictValue, SignalConflictEvidence, AlignmentCohortSignals, CohortSubjectMembership, CohortIdentifiability, ContentCompositionClassification, InlineReplacedKind, ContentCompositionFingerprint, AlignmentElementEvidence, HotEvidenceWitness, HotNumericSignalEvidence, HotNormalizedSignalEvidence, SnapshotHotSignals, AlignmentFactorId, AlignmentFactorCoverage, AlignmentFindingKind, AlignmentCohort, AlignmentCase, LogOddsInterval, EvidenceAtom, PosteriorInterval, AlignmentSignalFinding, AlignmentEvaluation, NormalizedRuleDeclaration, CSSSourceProviderKind, createPlainCSSProvider, createSCSSProvider, createTailwindProvider, createCompilationTracker, createCompilationFromLegacy
(These may be supporting types referenced transitively — verify manually.)
**Types referenced in many phases** (verify single creation point): SolidSyntaxTree, CSSSyntaxTree, ClassNameSymbol, ClassNameSource, SelectorSymbol, DeclarationTable, StyleCompilation, ElementCascade, SelectorMatch, SignalSnapshot, AnalysisDispatcher, CompilationTracker

## CHECK 3: SemanticModel queries → backing data
Every query method on FileSemanticModel must have a data source.
**PASS**: All SemanticModel queries have identified backing data sources.

| Query | Backing source |
|-------|---------------|
| `getElementNode` | Phase 6: element-builder.ts |
| `getElementNodes` | Phase 6: element-builder.ts |
| `getElementCascade` | Phase 6: cascade-binder.ts |
| `getMatchingSelectors` | Phase 6: cascade-binder.ts |
| `getComponentHost` | Phase 6: element-builder.ts (component-host resolution) |
| `getSignalSnapshot` | Phase 7: signal-builder.ts |
| `getLayoutFact` | Phase 7: layout-fact.ts |
| `getConditionalDelta` | Phase 7: cascade-analyzer.ts |
| `getBaselineOffsets` | Phase 7: cascade-analyzer.ts |
| `getClassNameInfo` | Phase 5: symbolTable.classNames lookup |
| `getCustomPropertyResolution` | Phase 5: symbolTable.customProperties lookup |
| `getSelectorOverrides` | Phase 6: symbolTable.duplicateSelectors |
| `getScopedCSSFiles` | Phase 5: dependencyGraph.getCSSScope() |
| `getScopedSelectors` | Phase 6: scope-resolver.ts |
| `getImportChain` | Phase 5: solidTree.imports |
| `getReactiveKind` | Phase 5: solidTree.reactiveVariables |
| `getDependencyEdges` | Phase 5: solidTree.dependencyEdges |
| `getAlignmentContext` | Phase 7: alignment.ts |
| `getCohortStats` | Phase 7: alignment.ts |
| `getElementsWithConditionalDelta` | Phase 7: cascade-analyzer.ts index |
| `getScrollContainerElements` | Phase 7: layout-fact.ts filter |
| `getDynamicSlotCandidates` | Phase 6: element-builder.ts filter |
| `getElementsByTagName` | Phase 6: element-builder.ts index |
| `getStatefulSelectorEntries` | Phase 7: statefulness.ts |
| `getStatefulNormalizedDeclarations` | Phase 7: statefulness.ts |
| `getStatefulBaseValueIndex` | Phase 7: statefulness.ts |
| `getElementsByKnownSignalValue` | Phase 7: signal-builder.ts index |

## CHECK 4: Rules → dispatch action data availability
**PASS**: All 31 rules can execute via their registered action types.

## CHECK 5: Phase 11 deletion safety
Verify that every data source consumed by CSS-only rules (Table 1G) and cross-file rules (Table 1E) survives Phase 11.
**PASS**: All data sources survive Phase 11 deletion.

---
## Summary
**61 issues found across 5 checks.** See details above.
