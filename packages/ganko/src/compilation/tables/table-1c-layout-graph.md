# Table 1C: LayoutGraph → SemanticModel (binding) + Analysis (derived)

Every field on `LayoutGraph`, `LayoutElementRecord`, and `LayoutElementNode` mapped to new home.

## LayoutGraph fields

| # | Field | Type | Layer | New query/computation | Return type | Notes |
|---|-------|------|-------|----------------------|-------------|-------|
| 1 | `elements` | `readonly LayoutElementNode[]` | Binding | `FileSemanticModel.getElementNodes()` | `readonly ElementNode[]` |  |
| 2 | `childrenByParentNode` | `ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>` | Binding | `Implicit via ElementNode.parentElementNode + childElementNodes` | `readonly ElementNode[]` | ElementNode carries both parent ref and children array |
| 3 | `elementBySolidFileAndId` | `ReadonlyMap<string, ReadonlyMap<number, LayoutElementNode>>` | Binding | `FileSemanticModel.getElementNode(elementId)` | `ElementNode \\| null` |  |
| 4 | `elementRefsBySolidFileAndId` | `ReadonlyMap<string, ReadonlyMap<number, LayoutElementRef>>` | Binding | `ElementNode.jsxEntity` | `JSXElementEntity` | ElementNode carries direct JSXElementEntity reference (not just ID) |
| 5 | `elementsByTagName` | `ReadonlyMap<string, readonly LayoutElementNode[]>` | Binding | `FileSemanticModel.getElementsByTagName(tag)` | `readonly ElementNode[]` |  |
| 6 | `measurementNodeByRootKey` | `ReadonlyMap<string, LayoutElementNode>` | Derived | `Internal to AlignmentAnalyzer.getMeasurementNode(rootKey)` | `ElementNode \\| null` | Not exposed on SemanticModel — consumed only by alignment analysis |
| 7 | `hostElementRefsByNode` | `ReadonlyMap<LayoutElementNode, LayoutElementRef>` | Binding | `FileSemanticModel.getComponentHost(importSource, exportName)` | `ComponentHostSymbol \\| null` |  |
| 8 | `styleRules` | `readonly LayoutStyleRuleNode[]` | Binding | `Internal to CascadeBinder — SelectorSymbol[] from SymbolTable` | `—` | LayoutStyleRuleNode dissolves: cssFile from SelectorSymbol.filePath, selectorId from SelectorSymbol.entity.id |
| 9 | `applies` | `readonly LayoutMatchEdge[]` | Binding | `FileSemanticModel.getMatchingSelectors(elementId)` | `readonly SelectorMatch[]` | Per-element, not workspace-wide flat list |
| 10 | `cssScopeBySolidFile` | `ReadonlyMap<string, readonly string[]>` | Binding | `FileSemanticModel.getScopedCSSFiles()` | `readonly string[]` | Delegates to DependencyGraph.getCSSScope() |
| 11 | `selectorCandidatesByNode` | `ReadonlyMap<LayoutElementNode, readonly number[]>` | Binding | `Internal to CascadeBinder dispatch index` | `—` | Not exposed — internal optimization for cascade binding |
| 12 | `selectorsById` | `ReadonlyMap<number, SelectorEntity>` | Binding | `SymbolTable.selectors` | `ReadonlyMap<number, SelectorSymbol>` |  |
| 13 | `records` | `ReadonlyMap<LayoutElementNode, LayoutElementRecord>` | Derived | `Decomposed into per-element queries on FileSemanticModel` | `—` | No single monolithic records map. Each fact computed lazily per element. |
| 14 | `cohortStatsByParentNode` | `ReadonlyMap<LayoutElementNode, LayoutCohortStats>` | Derived | `FileSemanticModel.getCohortStats(parentElementId)` | `CohortStats \\| null` | Computed by AlignmentAnalyzer |
| 15 | `contextByParentNode` | `ReadonlyMap<LayoutElementNode, AlignmentContext>` | Derived | `FileSemanticModel.getAlignmentContext(parentElementId)` | `AlignmentContext \\| null` | Computed by AlignmentAnalyzer |
| 16 | `elementsWithConditionalDeltaBySignal` | `ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>` | Derived | `FileSemanticModel.getElementsWithConditionalDelta(signal)` | `readonly ElementNode[]` |  |
| 17 | `elementsWithConditionalOverflowDelta` | `readonly LayoutElementNode[]` | Derived | `Derivable: union of getElementsWithConditionalDelta('overflow') and ('overflow-y')` | `readonly ElementNode[]` | Convenience index. Rules compute inline. |
| 18 | `elementsWithConditionalOffsetDelta` | `readonly LayoutElementNode[]` | Derived | `Derivable: union of getElementsWithConditionalDelta for offset signals` | `readonly ElementNode[]` | Uses layoutOffsetSignals list. Rules compute inline. |
| 19 | `elementsByKnownSignalValue` | `ReadonlyMap<LayoutSignalName, ReadonlyMap<string, readonly LayoutElementNode[]>>` | Derived | `FileSemanticModel.getElementsByKnownSignalValue(signal, value)` | `readonly ElementNode[]` | Cross-element index. Built lazily on first Tier 3+ query. |
| 20 | `dynamicSlotCandidateElements` | `readonly LayoutElementNode[]` | Derived | `FileSemanticModel.getDynamicSlotCandidates()` | `readonly ElementNode[]` |  |
| 21 | `scrollContainerElements` | `readonly LayoutElementNode[]` | Derived | `FileSemanticModel.getScrollContainerElements()` | `readonly ElementNode[]` |  |
| 22 | `statefulSelectorEntriesByRuleId` | `ReadonlyMap<number, readonly LayoutStatefulSelectorEntry[]>` | Derived | `FileSemanticModel.getStatefulSelectorEntries(ruleId)` | `readonly StatefulSelectorEntry[]` | Computed by StatefulnessAnalyzer |
| 23 | `statefulNormalizedDeclarationsByRuleId` | `ReadonlyMap<number, readonly LayoutNormalizedRuleDeclaration[]>` | Derived | `FileSemanticModel.getStatefulNormalizedDeclarations(ruleId)` | `readonly NormalizedRuleDeclaration[]` | Computed by StatefulnessAnalyzer |
| 24 | `statefulBaseValueIndex` | `ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>` | Derived | `FileSemanticModel.getStatefulBaseValueIndex()` | `ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>` | Computed by StatefulnessAnalyzer |
| 25 | `perf` | `LayoutPerfStatsMutable` | N/A | `AnalysisResult.perfStats` | `AnalysisPerfStats` | Perf tracking moves to dispatch layer |

## LayoutElementRecord fields

| # | Field | Type | Layer | New query/computation | Return type | Notes |
|---|-------|------|-------|----------------------|-------------|-------|
| 1 | `ref` | `LayoutElementRef \| null` | Binding | `ElementNode.jsxEntity + solidTree reference` | `JSXElementEntity` | Direct entity reference on ElementNode. SolidSyntaxTree accessible via compilation. |
| 2 | `edges` | `readonly LayoutMatchEdge[]` | Binding | `FileSemanticModel.getMatchingSelectors(elementId)` | `readonly SelectorMatch[]` |  |
| 3 | `cascade` | `ReadonlyMap<string, LayoutCascadedDeclaration>` | Binding | `FileSemanticModel.getElementCascade(elementId).declarations` | `ReadonlyMap<string, CascadedDeclaration>` | Lazy cascade binding |
| 4 | `snapshot` | `LayoutSignalSnapshot` | Derived | `FileSemanticModel.getSignalSnapshot(elementId)` | `SignalSnapshot` | Computed from cascade by SignalBuilder |
| 5 | `hotSignals` | `LayoutSnapshotHotSignals` | Derived | `Internal to CohortIndexBuilder` | `SnapshotHotSignals` | Not exposed on SemanticModel. Extracted from SignalSnapshot during cohort analysis. |
| 6 | `reservedSpace` | `LayoutReservedSpaceFact` | Derived | `FileSemanticModel.getLayoutFact(elementId, 'reservedSpace')` | `ReservedSpaceFact` |  |
| 7 | `scrollContainer` | `LayoutScrollContainerFact` | Derived | `FileSemanticModel.getLayoutFact(elementId, 'scrollContainer')` | `ScrollContainerFact` |  |
| 8 | `flowParticipation` | `LayoutFlowParticipationFact` | Derived | `FileSemanticModel.getLayoutFact(elementId, 'flowParticipation')` | `FlowParticipationFact` |  |
| 9 | `containingBlock` | `LayoutContainingBlockFact` | Derived | `FileSemanticModel.getLayoutFact(elementId, 'containingBlock')` | `ContainingBlockFact` |  |
| 10 | `conditionalDelta` | `ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact> \| null` | Derived | `FileSemanticModel.getConditionalDelta(elementId)` | `ReadonlyMap<LayoutSignalName, ConditionalSignalDeltaFact> \\| null` |  |
| 11 | `baselineOffsets` | `ReadonlyMap<LayoutSignalName, readonly number[]> \| null` | Derived | `FileSemanticModel.getBaselineOffsets(elementId)` | `ReadonlyMap<LayoutSignalName, readonly number[]> \\| null` |  |

## LayoutElementNode → ElementNode field mapping

| # | LayoutElementNode field | Type | ElementNode field | Notes |
|---|------------------------|------|-------------------|-------|
| 1 | `key` | `string` | `key` | Preserved |
| 2 | `solidFile` | `string` | `solidFile` | Same field. Also accessible via compilation. |
| 3 | `elementId` | `number` | `elementId` | Preserved |
| 4 | `tag` | `string \| null` | `tag` | Preserved |
| 5 | `tagName` | `string \| null` | `tagName` | Preserved |
| 6 | `classTokens` | `readonly string[]` | `classTokens` | Preserved |
| 7 | `classTokenSet` | `ReadonlySet<string>` | `classTokenSet` | Preserved |
| 8 | `inlineStyleKeys` | `readonly string[]` | `inlineStyleKeys` | Preserved |
| 9 | `parentElementNode` | `LayoutElementNode \| null` | `parentElementNode` | Preserved |
| 10 | `previousSiblingNode` | `LayoutElementNode \| null` | `previousSiblingNode` | Preserved |
| 11 | `siblingIndex` | `number` | `siblingIndex` | Preserved |
| 12 | `siblingCount` | `number` | `siblingCount` | Preserved |
| 13 | `siblingTypeIndex` | `number` | `siblingTypeIndex` | Preserved |
| 14 | `siblingTypeCount` | `number` | `siblingTypeCount` | Preserved |
| 15 | `selectorDispatchKeys` | `readonly string[]` | `selectorDispatchKeys` | Preserved |
| 16 | `attributes` | `ReadonlyMap<string, string \| null>` | `attributes` | Preserved |
| 17 | `inlineStyleValues` | `ReadonlyMap<string, string>` | `inlineStyleValues` | Preserved |
| 18 | `textualContent` | `LayoutTextualContentState` | `textualContent` | Preserved |
| 19 | `isControl` | `boolean` | `isControl` | Preserved |
| 20 | `isReplaced` | `boolean` | `isReplaced` | Preserved |

**Additional ElementNode fields not on LayoutElementNode**:
- `jsxEntity: JSXElementEntity` — direct reference to source entity (replaces LayoutElementRef indirection)
- `childElementNodes: readonly ElementNode[]` — direct children (replaces childrenByParentNode map lookup)