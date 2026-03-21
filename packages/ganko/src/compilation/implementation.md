Phase 1: Compilation Shell

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — sections 1 (syntax trees) and 4 (StyleCompilation)
- packages/ganko/src/compilation/PLAN.md — Phase 1
- packages/ganko/src/solid/impl.ts — understand SolidGraph's readonly properties (the shape SolidSyntaxTree must match)
- packages/ganko/src/css/impl.ts — understand CSSGraph's per-file data (what CSSSyntaxTree per-file extraction looks
like)
- packages/ganko/src/css/entities/file.ts — FileEntity structure

Implement Phase 1. Create these files:
- compilation/core/compilation.ts — StyleCompilation: immutable, withSolidTree/withCSSTree/withoutFile/withFile return
new instances with structural sharing. No symbol table yet — that's Phase 2.
- compilation/core/solid-syntax-tree.ts — SolidSyntaxTree type + solidGraphToSyntaxTree() bridge that returns a
zero-copy view (same array references as SolidGraph)
- compilation/core/css-syntax-tree.ts — CSSSyntaxTree type + cssGraphToSyntaxTrees() bridge that splits monolithic
CSSGraph into per-file trees

Validation — write tests proving:
- compilation.getSolidTree(path).scopes === oldSolidGraph.scopes (reference equality)
- compilation.getSolidTree(path).jsxElements === oldSolidGraph.jsxElements (reference equality)
- compilation.withSolidTree(treeA).cssTrees === compilation.cssTrees (structural sharing)
- compilation.withoutFile(path).getSolidTree(path) === undefined
- Round-trip: build compilation from legacy graphs, extract all trees, verify every field matches

CRITICAL: The type signatures are in SPEC.ts. Do NOT reinvent types — implement what's specified. If the spec has a
gap, flag it explicitly instead of silently improvising.

---
Phase 2: Symbol Hierarchy

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 2 (symbols) and section 3 (DeclarationTable)
- packages/ganko/src/compilation/PLAN.md — Phase 2
- packages/ganko/src/compilation/core/ — Phase 1 output (CSSSyntaxTree you'll consume)
- packages/ganko/src/css/impl.ts — understand CSSGraph's workspace-wide indexes: classNameIndex, variablesByName,
selectorsBySubjectTag, declarationsByProperty, knownKeyframeNames, layerOrder, fontFaceDescriptorsByFamily,
containerQueryNames
- packages/ganko/src/css/entities/ — ALL entity types (these are wrapped by symbols, not replaced)
- packages/ganko/src/css/parser/specificity.ts — used by SelectorSymbol
- packages/ganko/src/cross-file/layout/selector-match.ts — CompiledSelectorMatcher (pre-compiled into SelectorSymbol)
- packages/ganko/src/cross-file/layout/selector-dispatch.ts — dispatch key extraction (pre-computed into
SelectorSymbol)

Then study Roslyn at /home/skill/p/roslyn:
- Search for DeclarationTable, _allOlderRootDeclarations, _latestLazyRootDeclaration — understand the two-forest
incremental merge pattern. This is how adding one CSS file doesn't reprocess 199 others.
- Search for MergedNamespaceSymbol — understand how heterogeneous symbol types coexist in one lookup.

Implement Phase 2. Create these files:
- compilation/symbols/symbol-table.ts — SymbolTable: classNames (Map<string, ClassNameSymbol>), selectors,
customProperties, keyframes, fontFaces, layers, containers, themeTokens. Populated from CSSSyntaxTree[].
- compilation/symbols/declaration-table.ts — DeclarationTable: two-forest incremental merge. Contributions from older
trees cached, latest tree lazily merged. merge() and withContribution()/withoutContribution() methods.
- compilation/symbols/class-name.ts — ClassNameSymbol with CSSClassNameSource (wraps SelectorEntity[])
- compilation/symbols/selector.ts — SelectorSymbol wrapping CSSSelectorEntity + pre-compiled matcher + dispatch keys
- compilation/symbols/declaration.ts — DeclarationSymbol wrapping CSSDeclarationEntity + cascade position
- compilation/symbols/custom-property.ts — CustomPropertySymbol wrapping CSSVariableEntity + scope + resolution chain
- compilation/symbols/keyframes.ts — KeyframesSymbol + KeyframeLayoutMutation
- compilation/symbols/font-face.ts — FontFaceSymbol
- compilation/symbols/layer.ts — LayerSymbol
- compilation/symbols/container.ts — ContainerSymbol
- compilation/symbols/theme-token.ts — ThemeTokenSymbol

Validation — write tests proving:
- Set.from(symbolTable.classNames.keys()) equals Set.from(oldCSSGraph.classNameIndex.keys())
- symbolTable.selectors.size === oldCSSGraph.selectors.length
- For every selector: symbolTable.selectors.get(id).specificity matches old specificity
- symbolTable.customProperties keys match oldCSSGraph.variablesByName keys (filtered to -- prefixed)
- symbolTable.keyframes keys match oldCSSGraph.knownKeyframeNames
- DeclarationTable incremental test: build table from 10 CSS trees, add 11th, verify only 11th is processed (not all 10
  re-merged)

CRITICAL: Symbols WRAP existing entity types from css/entities/. They do NOT duplicate fields. A SelectorSymbol holds a
  reference to the existing CSSSelectorEntity plus computed fields (matcher, dispatch keys). The entity types do NOT
change.

---
Phase 3: Dependency Graph

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 5 (DependencyGraph)
- packages/ganko/src/compilation/PLAN.md — Phase 3
- packages/ganko/src/compilation/core/ — Phase 1 output (syntax trees with import data)
- packages/ganko/src/cross-file/layout/scope.ts — ENTIRE FILE. Understand exactly how collectCSSScopeBySolidFile works:
  co-located CSS, direct CSS imports, transitive @import chains, cross-component CSS, global side-effect CSS. Your
dependency graph must produce IDENTICAL scope results.
- packages/ganko/src/cross-file/layout/module-resolver.ts — ENTIRE FILE. Module resolution logic: relative paths,
absolute paths, bare package imports, package.json exports, extension probing, workspace packages. This algorithm moves
  into the dependency graph — same logic, new location.
- packages/ganko/src/solid/entities/import.ts — ImportEntity shape (what import data is available from syntax trees)
- packages/ganko/src/css/entities/file.ts — FileEntity imports field

Then study Roslyn at /home/skill/p/roslyn:
- Search for CompilationTracker, DoesProjectTransitivelyDependOnProject — understand how the dependency graph enables
targeted invalidation.

Implement Phase 3. Create:
- compilation/incremental/dependency-graph.ts — DependencyGraph:
  - Built from syntax trees' import declarations
  - Edge kinds: CSSImport (Solid imports CSS), CSSAtImport (CSS @import CSS), ComponentImport (Solid imports component
from Solid), CoLocated (convention-based CSS association)
  - getCSSScope(solidFilePath): ReadonlySet<string> — transitive closure matching collectCSSScopeBySolidFile exactly
  - getReverseDependencies(filePath): ReadonlySet<string> — reverse edge index
  - getTransitivelyAffected(changedFilePath): ReadonlySet<string> — files needing re-analysis when changedFilePath
changes
  - Module resolution from module-resolver.ts moved here (same algorithm)

Validation — write tests proving:
- For EVERY Solid file in test suite: dependencyGraph.getCSSScope(solidFile) as Set equals
collectCSSScopeBySolidFile(solids, css).get(solidFile) as Set. ZERO differences.
- Reverse edges: if CSS file X is in scope for Solid file Y, then Y appears in getReverseDependencies(X)
- Transitively affected: changing CSS file X returns exactly the Solid files whose scope includes X
- Edge case: circular component imports don't infinite-loop
- Edge case: missing import targets produce edges to nowhere (no crash)

CRITICAL: The scope collection in scope.ts has 5 distinct inclusion mechanisms (co-located, direct import, transitive
@import, component CSS, global side-effect). ALL 5 must be replicated. Read scope.ts line by line and map each
mechanism to a dependency edge kind.

---
Phase 4: CSS Source Providers

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 8 (providers) and section 2 (TailwindParsedCandidate,
TailwindClassNameSource)
- packages/ganko/src/compilation/PLAN.md — Phase 4
- packages/ganko/src/compilation/symbols/ — Phase 2 output (symbol types that providers produce)
- packages/ganko/src/css/phases/ — ALL 6 phase files. PlainCSSProvider wraps this existing pipeline.
- packages/ganko/src/css/impl.ts — understand buildCSSGraph() orchestration that PlainCSSProvider replaces
- packages/ganko/src/css/tailwind.ts — ENTIRE FILE. Understand TailwindValidator (has/resolve), LiveValidator,
StaticValidator, detectTailwindEntry, resolveTailwindNodePath. TailwindProvider replaces this.

Then study Tailwind v4 internals at /home/skill/p/tailwindcss:
- packages/tailwindcss/src/candidate.ts — ENTIRE FILE. The candidate parsing algorithm you must replicate:
segment-by-colon for variant extraction, permutation-based root matching (bg-red-500 → tries bg-red-500, bg-red, bg),
arbitrary value parsing with bracket balancing, modifier extraction after /, underscore-to-space conversion, negative
utility prefix
- packages/tailwindcss/src/variants.ts — variant registry structure: static, functional, compound (group-hover),
arbitrary ([&_p])
- packages/tailwindcss/src/theme.ts — theme resolution: CSS variable namespaces, --color-*, --spacing-*
- packages/tailwindcss/src/design-system.ts — DesignSystem: how Theme + Utilities + Variants tie together

Implement Phase 4. Create:
- compilation/providers/provider.ts — CSSSourceProvider interface: parse(path, content) → CSSSyntaxTree
- compilation/providers/plain-css.ts — PlainCSSProvider: wraps existing css/phases/ pipeline. Input: file path +
content. Output: CSSSyntaxTree. Same parse logic, different output wrapper.
- compilation/providers/scss.ts — SCSSProvider: wraps PostCSS-SCSS + scss phase
- compilation/providers/tailwind.ts — TailwindProvider (NOT a CSSSourceProvider — it produces symbols, not syntax
trees):
  - parseCandidate(className): TailwindParsedCandidate | null — replicates v4's exact parsing
  - resolve(className): TailwindResolvedDeclaration[] | null — resolves to CSS declarations
  - has(className): boolean — valid utility check
  - contributeSymbols(symbolTable): void — adds ClassNameSymbol entries with TailwindClassNameSource
  - Typed diagnostics: TailwindCandidateDiagnostic with kind ("unknown-utility", "unknown-variant",
"invalid-arbitrary-value", "theme-token-not-found", "incompatible-compound-variant")

Validation:
- PlainCSSProvider.parse(path, content) produces CSSSyntaxTree whose entities match corresponding file in old CSSGraph
- tailwindProvider.has(name) matches oldTailwind.has(name) for a comprehensive class list (500+ classes including
arbitrary values, compound variants, modifiers)
- tailwindProvider.resolve(name).declarations matches oldTailwind.resolve(name) parsed as CSS
- tailwindProvider.parseCandidate("hover:bg-red-500/50") produces { variants: [{kind:"static", name:"hover"}],
utility:"bg", value:{kind:"named", value:"red-500"}, modifier:{kind:"named", value:"50"} }
- tailwindProvider.parseCandidate("group-hover:has-[&_p]:min-h-[calc(100vh-4rem)]") parses correctly (compound variant
+ arbitrary variant + arbitrary value)
- Invalid classes produce typed diagnostics, not silent false

CRITICAL: The TailwindProvider's parseCandidate must match Tailwind v4's candidate.ts EXACTLY. The permutation-based
root matching (trying progressively shorter prefixes) is the key algorithm. Do NOT approximate — replicate. Read
candidate.ts line by line.

---
Phase 5: SemanticModel Core (Tier 0-1)

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 6 (FileSemanticModel)
- packages/ganko/src/compilation/PLAN.md — Phase 5
- packages/ganko/src/compilation/ — all Phase 1-4 output
- packages/ganko/src/cross-file/queries.ts — ENTIRE FILE. getUndefinedCSSClasses, getUnusedCSSClasses,
getUndefinedVariableUsagesInJSX. Your semantic model Tier 0-1 queries must replace these.
- packages/ganko/src/cross-file/rules/ — read the 11 Tier 1 rules to understand what queries they need:
undefined-css-class, unreferenced-css-class, classlist-boolean-values, classlist-no-accessor-reference,
classlist-no-constant-literals, classlist-static-keys, style-kebab-case-keys, style-no-function-values,
style-no-unused-custom-prop, classlist-geometry-toggle, picture-source-ratio-consistency

Implement Phase 5. Create:
- compilation/binding/semantic-model.ts — FileSemanticModel:
  - Constructor takes: compilation, solidFilePath
  - Tier 0-1 queries:
    - getClassNameInfo(name): ClassNameSymbol | null — looks up in compilation.symbolTable
    - getCustomPropertyResolution(name): CustomPropertySymbol | null
    - getScopedCSSFiles(): ReadonlySet<string> — delegates to compilation.dependencyGraph.getCSSScope()
    - getScopedSelectors(): ReadonlyArray<SelectorSymbol> — filters symbol table selectors to scoped files
    - getReactiveKind(variable): ReactiveKind — reads from SolidSyntaxTree binding data
    - getDependencyEdges(computation): DependencyEdge[] — reads from SolidSyntaxTree
  - Per-query caching with lazy initialization
  - compilationId tracking to detect stale models

Validation:
- semanticModel.getClassNameInfo(name) !== null matches css.classNameIndex.has(name) || tailwind.has(name) for every
class name in test suite
- Iterate all Solid trees' staticClassTokensByElementId, check getClassNameInfo() for each → produces same
undefined-class set as getUndefinedCSSClasses()
- Custom property resolution matches css.variablesByName lookups
- getScopedCSSFiles() matches dependency graph validation from Phase 3

CRITICAL: This phase implements ONLY Tier 0-1 queries. getElementCascade, getSignalSnapshot, getLayoutFact do NOT exist
  yet — they'll throw "not implemented" if called. Phase 6 adds Tier 2-3.

---
Phase 6: Cascade Binder (Tier 2-3)

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 7 (CascadeBinder) and section 6 (ElementNode, ElementCascade,
CascadedDeclaration, SelectorMatch)
- packages/ganko/src/compilation/PLAN.md — Phase 6
- packages/ganko/src/compilation/binding/semantic-model.ts — Phase 5 output (you're adding Tier 2-3 methods here)
- packages/ganko/src/cross-file/layout/cascade-builder.ts — ENTIRE FILE line by line. The cascade algorithm moves here.
  Understand: monitored declaration collection, per-element cascade construction, variable substitution
(MAX_VAR_SUBSTITUTION_DEPTH=10), Tailwind augmentation, importance/layer/specificity/sourceOrder sort
- packages/ganko/src/cross-file/layout/selector-match.ts — ENTIRE FILE. CompiledSelectorMatcher.
selectorMatchesLayoutElement. This moves into cascade-binder.
- packages/ganko/src/cross-file/layout/selector-dispatch.ts — ENTIRE FILE. ScopedSelectorIndex, dispatch key bucketing,
  candidate collection. This moves into scope-resolver.
- packages/ganko/src/cross-file/layout/element-record.ts — ENTIRE FILE. Element composition metadata: tag resolution,
transparent primitives (For, Show, Switch, etc.), textual content state, parent resolution
- packages/ganko/src/cross-file/layout/component-host.ts — ENTIRE FILE. Component host resolution chain, circular
dependency detection, LayoutComponentHostDescriptor, cross-file attribute/class merging
- packages/ganko/src/cross-file/layout/build.ts — steps 0-6. Understand the exact construction sequence you're making
lazy.

Then study Roslyn at /home/skill/p/roslyn:
- Search for Binder, LookupSymbolsInSingleBinder — understand lazy scope-chain resolution as a METHOD, not upfront
construction

Implement Phase 6. Create:
- compilation/binding/cascade-binder.ts — CascadeBinder: bind(elementNode, scopedSelectors, symbolTable) →
ElementCascade. Same cascade algorithm as cascade-builder.ts, invoked per-element lazily instead of all-elements
upfront.
- compilation/binding/element-builder.ts — buildElementNodes(solidSyntaxTree, compilation) → ElementNode[]. Same logic
as element-record.ts: tag resolution, transparent primitive detection, parent-child wiring, sibling indexing, class
token extraction, inline style extraction, dispatch key computation. Component host resolution via compilation's
dependency graph.
- compilation/binding/scope-resolver.ts — buildScopedSelectorIndex(scopedCSSFiles, symbolTable) → ScopedSelectorIndex.
Same dispatch bucketing as selector-dispatch.ts, operating on SelectorSymbol from the symbol table instead of raw
SelectorEntity.

Add to semantic-model.ts:
- getElementNodes(): ReadonlyArray<ElementNode> — lazy, cached
- getElementCascade(elementId): ElementCascade — lazy per element, uses CascadeBinder
- getMatchingSelectors(elementId): ReadonlyArray<SelectorMatch> — subset of cascade binding
- getComponentHost(importSource, importName): ComponentHostSymbol — lazy, cached
- getLayoutFact(elementId, factType): Tier 3 fact types (reservedSpace, scrollContainer, flowParticipation,
containingBlock) — computed from cascade

Validation — for 50+ elements from the test suite:
- getElementCascade(elementId).declarations matches oldLayoutGraph.records.get(node).cascade — same property keys, same
  values, same source files, same guard provenance
- getMatchingSelectors(elementId).length === oldRecords.edges.length
- getComponentHost(source, name) returns same tag and classTokens as old system
- getLayoutFact(elementId, "reservedSpace") matches oldRecords.reservedSpace
- getLayoutFact(elementId, "flowParticipation") matches oldRecords.flowParticipation

CRITICAL: The cascade algorithm in cascade-builder.ts is ~200 lines of carefully ordered logic. Do NOT simplify or
rewrite. MOVE it. The only change is it's called per-element lazily instead of in a loop over all elements.

---
Phase 7: Signal + Fact Analyzers (Tier 4-5)

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 6 (SignalSnapshot, SignalValue, AlignmentContext, CohortStats,
ConditionalSignalDelta, StatefulSelectorEntry)
- packages/ganko/src/compilation/PLAN.md — Phase 7
- packages/ganko/src/compilation/binding/ — Phase 6 output
- packages/ganko/src/cross-file/layout/signal-normalization.ts — ENTIRE FILE. Signal normalization: CSS value →
normalized signal (Known px, Known keyword, Unknown variable, Conditional). 55 monitored signal names. This moves to
signal-builder.
- packages/ganko/src/cross-file/layout/signal-collection.ts — ENTIRE FILE. Signal snapshot construction: iterate
cascaded declarations, normalize each, inherit from parent (font-size, line-height). This moves to signal-builder.
- packages/ganko/src/cross-file/layout/build.ts — steps 7-8. Conditional delta analysis, context classification, cohort
  analysis, stateful rule indexes, measurement node index, baseline offsets.
- packages/ganko/src/cross-file/layout/rule-kit.ts — ENTIRE FILE. LayoutDetector framework, Bayesian evidence scoring,
confidence thresholds, deduplication. This moves to alignment.ts.
- packages/ganko/src/cross-file/layout/context-classification.ts — alignment context creation
- packages/ganko/src/cross-file/layout/cohort-index.ts — cohort statistics
- packages/ganko/src/cross-file/layout/offset-baseline.ts — baseline offset computation
- packages/ganko/src/cross-file/layout/stateful-rule-index.ts — stateful selector/declaration analysis
- packages/ganko/src/cross-file/layout/measurement-node.ts — measurement node index

Implement Phase 7. Create:
- compilation/binding/signal-builder.ts — buildSignalSnapshot(elementId, cascade, parentSnapshot?) → SignalSnapshot.
Same normalization + inheritance logic from signal-normalization.ts and signal-collection.ts.
- compilation/analysis/layout-fact.ts — computeReservedSpaceFact, computeScrollContainerFact,
computeFlowParticipationFact, computeContainingBlockFact. Same algorithms from build.ts steps 6-7.
- compilation/analysis/cascade-analyzer.ts — computeConditionalDelta(elements, cascades) → conditional delta index.
Same logic from build.ts step 7.
- compilation/analysis/alignment.ts — AlignmentContext creation, CohortStats computation, Bayesian evidence scoring.
Same logic from rule-kit.ts, context-classification.ts, cohort-index.ts, offset-baseline.ts, measurement-node.ts.
- compilation/analysis/statefulness.ts — stateful selector entry collection, normalized declaration extraction, base
value index. Same logic from stateful-rule-index.ts.

Add to semantic-model.ts:
- getSignalSnapshot(elementId): SignalSnapshot — lazy, uses signal-builder
- getConditionalDelta(elementId, signalName): ConditionalSignalDelta | null
- getAlignmentContext(parentElementId): AlignmentContext
- getCohortStats(parentElementId): CohortStats
- getStatefulSelectorEntries(ruleId): StatefulSelectorEntry[]

Validation — for every element in test suite:
- getSignalSnapshot(elementId).signals matches oldRecords.snapshot.signals for all 55 signal names — same kind, same
normalized value, same px, same guard
- Every layout fact matches old LayoutGraph (reservedSpace, scrollContainer, flowParticipation, containingBlock)
- getAlignmentContext matches oldLayoutGraph.contextByParentNode
- getCohortStats matches oldLayoutGraph.cohortStatsByParentNode
- Conditional delta matches oldLayoutGraph.elementsWithConditionalDeltaBySignal

CRITICAL: Signal normalization has 55 monitored signals with specific normalization rules per signal type. Do NOT
generalize — preserve the exact per-signal logic. The Bayesian scoring in rule-kit.ts is the most complex algorithm in
the codebase. MOVE it unchanged.

---
Phase 8: Rule Dispatch Framework

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 10 (AnalysisDispatcher, AnalysisRule, AnalysisActionRegistry)
- packages/ganko/src/compilation/PLAN.md — Phase 8
- packages/ganko/src/compilation/binding/semantic-model.ts — Phase 5-7 output (all query tiers available)
- packages/ganko/src/cross-file/rule.ts — CrossRule interface, CrossRuleContext (what you're replacing)
- packages/ganko/src/cross-file/rules/ — read the 3 Tier 0 rules you'll migrate first:
css-layout-animation-layout-property, css-layout-transition-layout-property, css-layout-font-swap-instability.
Understand their check() implementations.

Then study Roslyn at /home/skill/p/roslyn:
- Search for CompilationWithAnalyzers, AnalyzerDriver — understand event-driven dispatch
- Search for RegisterSymbolAction, RegisterOperationAction — understand typed subscription registration

Implement Phase 8. Create:
- compilation/dispatch/rule.ts — AnalysisRule interface: id, severity, meta, register(registry)
- compilation/dispatch/registry.ts — AnalysisActionRegistry: registerCSSSyntaxAction, registerCrossSyntaxAction,
registerSymbolAction, registerElementAction, registerFactAction, registerCascadeAction, registerConditionalDeltaAction,
  registerAlignmentAction. Each registration records the callback + its tier requirement.
- compilation/dispatch/tier-resolver.ts — resolveMaxTier(registrations): ComputationTier. Inspects all registered
actions, returns highest tier needed.
- compilation/dispatch/dispatcher.ts — AnalysisDispatcher: takes StyleCompilation + AnalysisRule[]. Collects
registrations, resolves max tier, creates semantic models only as needed, dispatches actions per file, collects
diagnostics.

Then migrate the 3 Tier 0 rules:
- Create new versions using defineAnalysisRule() with registerCSSSyntaxAction
- Run BOTH old dispatcher and new dispatcher on full test suite
- Assert identical diagnostics: same rule IDs, same file paths, same line/column, same messages

CRITICAL: The dispatch framework must support running OLD rules (CrossRule) and NEW rules (AnalysisRule) simultaneously
  during migration. The dispatcher should accept both types and route appropriately.

---
Phase 9: Rule Migration

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 10 (all action types)
- packages/ganko/src/compilation/PLAN.md — Phase 9
- packages/ganko/src/compilation/dispatch/ — Phase 8 output
- EVERY file in packages/ganko/src/cross-file/rules/ — read each rule's check() implementation

Migrate ALL remaining rules, one tier at a time. After EACH tier, run full test suite through BOTH dispatchers and
assert zero diagnostic differences before proceeding.

Tier 1 (11 rules): undefined-css-class, unreferenced-css-class, classlist-boolean-values,
classlist-no-accessor-reference, classlist-no-constant-literals, classlist-static-keys, style-kebab-case-keys,
style-no-function-values, style-no-unused-custom-prop, classlist-geometry-toggle, picture-source-ratio-consistency.
→ Each rule's check(context, emit) becomes register(registry) with registerCrossSyntaxAction or registerSymbolAction.
Detection logic inside the callback is IDENTICAL.

Tier 2 (2 rules): duplicate-class-token, style-policy.
→ Use registerElementAction. Detection logic unchanged.

Tier 3 (9 rules): fill-image-parent, unsized-replaced-element, dynamic-slot, overflow-anchor, scrollbar-gutter,
content-visibility, stateful-box-model-shift, unstable-style-toggle, policy-touch-target.
→ Use registerFactAction with specific fact types. Detection logic unchanged.

Tier 4 (5 rules): conditional-display-collapse, conditional-offset-shift, conditional-white-space,
overflow-mode-toggle, box-sizing-toggle.
→ Use registerConditionalDeltaAction. Detection logic unchanged.

Tier 5 (1 rule): sibling-alignment-outlier.
→ Use registerAlignmentAction. Detection logic unchanged.

CRITICAL: Rule detection logic does NOT change. Only the entry point changes from check(context, emit) to
register(registry) with a typed callback. If you find yourself rewriting detection logic, STOP — you're doing it wrong.
  The callback receives narrower typed arguments but performs the same computation.

---
Phase 10: Incremental Updates

Read these files completely:
- packages/ganko/src/compilation/SPEC.ts — section 11 (CompilationTracker)
- packages/ganko/src/compilation/PLAN.md — Phase 10
- packages/ganko/src/compilation/ — all previous phase output
- packages/ganko/src/cache.ts — ENTIRE FILE. GraphCache: three-level cache with generation counters. This is what
you're replacing.
- packages/lsp/src/core/analyze.ts — ENTIRE FILE. Diagnostic pipeline orchestration: single-file vs cross-file, graph
rebuild, fast-path cache hit detection. Understand how the tracker integrates.

Then study Roslyn at /home/skill/p/roslyn:
- Search for CompilationTracker — understand tracker reuse for unaffected projects
- Search for SolutionCompilationState — understand how file changes produce new compilation state

Implement Phase 10. Create:
- compilation/incremental/tracker.ts — CompilationTracker: holds current StyleCompilation, applyChange(path, content)
returns new tracker with updated compilation. Uses dependencyGraph.getTransitivelyAffected() to invalidate only
affected semantic models.
- compilation/incremental/change-propagation.ts — propagateChange(graph, changedPath): Set<string> of affected files.
CSS file changed → Solid files importing it. Solid file changed → just that file. Tailwind config changed → all files.

Validation:
- Change CSS file → only Solid files whose scope includes it are re-analyzed (verify via spy on getSemanticModel)
- Change Solid file → only that file's semantic model is invalidated
- Change Tailwind config → all files re-analyzed
- Full test suite through tracker-based pipeline — zero diagnostic regressions vs Phase 9 output
- LSP simulation: rapid sequential edits → tracker produces correct compilation at each step

CRITICAL: The tracker must be safe for the LSP hot path. applyChange must be fast — it should NOT reparse unchanged
files or rebuild the full symbol table. Only the changed file's syntax tree is replaced; the declaration table merges
incrementally (Phase 2's two-forest pattern).

---
Phase 11: Cleanup

Read these files completely:
- packages/ganko/src/compilation/PLAN.md — Phase 11
- packages/ganko/src/compilation/ — all previous phase output

Delete the old system:
- Delete packages/ganko/src/cross-file/ directory entirely
- Delete packages/ganko/src/cache.ts
- Remove SolidGraph class from solid/impl.ts — parse phases now produce SolidSyntaxTree directly
- Remove CSSGraph class from css/impl.ts — parse phases now produce CSSSyntaxTree via providers
- Update packages/lsp/src/core/analyze.ts to use AnalysisDispatcher exclusively
- Update all imports that referenced deleted paths

Do NOT delete:
- solid/phases/ — these become SolidSyntaxTree construction
- solid/entities/ — entity type definitions stay
- solid/queries/ — query functions stay
- css/phases/ — these become CSSSyntaxTree construction inside providers
- css/entities/ — entity type definitions stay
- css/parser/ — parser internals stay

Validation:
- Full test suite passes through new system exclusively
- Zero imports from deleted paths (grep for old import paths)
- Build succeeds with no errors
- LSP starts and produces diagnostics correctly
- CLI lint produces identical output to pre-cleanup baseline