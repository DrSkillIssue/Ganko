# StyleCompilation — Implementation Plan

> **Canonical type signatures**: `SPEC.ts` in this directory.
> **This document**: what to build, in what order, against what existing code, validated how.
> Every type referenced below is defined in SPEC.ts. Do not reinvent types — import them.

---

## Part 1: Architecture Specification

### 1. StyleCompilation

**Replaces**: `SolidGraph[]` + `CSSGraph` + `LayoutGraph` + `GraphCache` — four separate objects with separate builders, separate queries, separate caching, no unified model.

**Why it must change**: Roslyn does not have a `SourceGraph` and a `MetadataGraph` that get merged. It has ONE `CSharpCompilation` that owns all syntax trees and metadata references. `AddSyntaxTrees()`, `WithReferences()`, `ReplaceSyntaxTree()` return NEW immutable compilations. The compilation produces ONE symbol table (`GlobalNamespace`) where `SourceNamedTypeSymbol` and `PENamedTypeSymbol` coexist as peers. ganko's three graphs must dissolve into one compilation following this identical pattern.

**Roslyn mapping**:
- `CSharpCompilation` → `StyleCompilation`
- `AddSyntaxTrees()` → `withSolidTree()` / `withCSSTree()`
- `ReplaceSyntaxTree()` → `withFile()` (replaces by path)
- `WithReferences()` → `withTailwindConfig()`
- `GlobalNamespace` → `symbolTable`
- `SyntaxAndDeclarationManager` → internal `DeclarationTable`

**Type signature**: See `SPEC.ts` section 4 — `StyleCompilation` interface. Key properties: `solidTrees`, `cssTrees`, `tailwindConfig`, `packageManifest`, `tsConfig`, `symbolTable` (lazy), `dependencyGraph`. Key methods: `withSolidTree()`, `withCSSTree()`, `withCSSTrees()`, `withoutFile()`, `withFile()`, `withTailwindConfig()`, `getSolidTree()`, `getCSSTree()`, `getSemanticModel()`.

**Key design decisions**:
- Immutable. Every mutation method returns a new instance. Old instance stays valid. Structural sharing of unchanged trees.
- `symbolTable` is lazy — materialized on first access by merging CSS tree contributions + Tailwind contributions via `DeclarationTable`.
- `id` is monotonic integer for tracker identity (detecting stale semantic models).
- `getSemanticModel(solidFilePath)` caches per file path. When `withFile()` creates a new compilation, semantic models for unaffected files (per dependency graph) transfer unchanged.

---

### 2. Syntax Trees

**Replaces**: `SolidGraph`'s syntax-level data (31 entity collections, 25+ indexes) and `CSSGraph`'s monolithic parse output.

**What is SYNTAX**: Everything produced by the parse phases. For Solid: scopes, variables, functions, calls, jsxElements, imports, exports, classes, properties, comments, all syntax indexes (variablesByName, functionsByNode, jsxByTag, staticClassTokensByElementId, etc.), reactive categorization (reactiveVariables, propsVariables, storeVariables, componentScopes, computations, dependencyEdges, ownershipEdges). For CSS: files, rules, selectors, declarations, variables, variableRefs, atRules, tokens, mixins, functions, placeholders, extends, per-file indexes (rulesBySelector, classNameIndex, atRulesByKind, etc.).

**What is NOT SYNTAX** (does not go in syntax trees):
- BINDING: CSSGraph's workspace-wide classNameIndex (merging across files), variableRef resolution (cross-file), cascade override links, duplicate selectors, containingMediaStacks. LayoutGraph's cssScopeBySolidFile, selectorCandidatesByNode, applies (selector matches), component host descriptors.
- DERIVED: LayoutGraph's records[].cascade, records[].snapshot, records[].hotSignals, records[].reservedSpace, cohortStatsByParentNode, contextByParentNode.

**Type signatures**: See `SPEC.ts` section 1 — `SolidSyntaxTree` and `CSSSyntaxTree` interfaces. `SolidSyntaxTree` has the exact same fields as `SolidGraph`'s readonly properties. `CSSSyntaxTree` is per-file (unlike the monolithic `CSSGraph`) and includes a `sourceOrderBase` for stable cross-file cascade sort.

**Key design decisions**:
- `SolidSyntaxTree` is the exact shape of `SolidGraph`'s readonly fields. During migration, `solidGraphToSyntaxTree(graph)` wraps an existing `SolidGraph` as a zero-copy view — fields point to the same arrays.
- `CSSSyntaxTree` is per-file. The workspace-wide indexes that `CSSGraph` maintains (classNameIndex across all files, declarationsByProperty across all files) move to the symbol table.
- `sourceOrderBase` is assigned by the compilation when a tree is inserted. Ensures stable cross-file cascade sort without a global counter.
- Forward references to entity types (ScopeEntity, VariableEntity, JSXElementEntity, CSSSelectorEntity, CSSDeclarationEntity, etc.) reference the EXISTING types from `solid/entities/` and `css/entities/`. These types do NOT change.

---

### 3. Merged Symbol Table

**Replaces**: `CSSGraph.classNameIndex` + `CSSGraph.tailwind.has()` as two separate code paths. `CSSGraph.variablesByName`. `CSSGraph.selectorsBySubjectTag`. `CSSGraph.declarationsByProperty`. All workspace-wide indexes that currently require the monolithic CSSGraph.

**Roslyn mapping**: Like `GlobalNamespace` where `SourceNamedTypeSymbol` (from .cs files) and `PENamedTypeSymbol` (from .dll metadata) coexist as peers. `ClassNameSymbol` from a CSS `.btn` selector and `ClassNameSymbol` from a Tailwind `flex` utility coexist as peers in one table.

**Type signatures**: See `SPEC.ts` section 2 — `StyleSymbol`, `ClassNameSymbol`, `CSSClassNameSource`, `TailwindClassNameSource`, `TailwindParsedCandidate`, `TailwindParsedVariant`, `TailwindCandidateValue`, `TailwindCandidateModifier`, `TailwindResolvedDeclaration`, `TailwindCandidateDiagnostic`, `SelectorSymbol`, `DeclarationSymbol`, `CustomPropertySymbol`, `ComponentHostSymbol`, `KeyframesSymbol`, `FontFaceSymbol`, `LayerSymbol`, `ContainerSymbol`, `ThemeTokenSymbol`, `SymbolTable`, `DeclarationTable`.

**Key design decisions**:
- `DeclarationTable` implements Roslyn's two-forest merge: older contributions cached, latest lazily merged. Adding one CSS file to a 200-file project does NOT re-process contributions from 199 files.
- `ClassNameSymbol.source` is a discriminated union: `CSSClassNameSource | TailwindClassNameSource`. Code checking "is this class defined?" asks the table once. Code needing source details checks `source.kind`.
- `SelectorSymbol` wraps existing `CSSSelectorEntity` (unchanged) with pre-compiled matcher and dispatch keys.
- `ComponentHostSymbol` is a binding-layer symbol created during semantic model queries, NOT during syntax tree construction.

---

### 4. CSS Source Providers

**Replaces**: Monolithic `buildCSSGraph()` that takes a flat array of files, runs PostCSS on all of them, produces one CSSGraph. SCSS as a flag. Tailwind as a nullable field. No abstraction for different CSS input types producing the same output.

**Roslyn mapping**: Like source references (.cs) and metadata references (.dll) that both produce symbols in the same namespace.

**Type signatures**: See `SPEC.ts` section 8 — `CSSSourceProvider`, `CSSSymbolContribution`, `PlainCSSProvider`, `SCSSProvider`, `TailwindProvider`, `TailwindCandidateResult`, `TailwindResolution`, `TailwindVariantInfo`.

**Key design decisions**:
- `PlainCSSProvider` wraps existing PostCSS parse pipeline (the 6 phases from `css/phases/`). Implementation doesn't change; output wrapper changes from "accumulate into CSSGraph" to "return a CSSSyntaxTree."
- `TailwindProvider` is NOT a `CSSSourceProvider` — it doesn't parse files, it produces symbols from a design system. Its `parseCandidate()` replicates Tailwind v4's exact algorithm from `candidate.ts`: segment-by-colon, permutation root matching, arbitrary value parsing, variant registry lookup.
- `TailwindParsedCandidate` carries the full parse tree — variants, utility, value, modifier, important, negative. Not a boolean.

---

### 5. Dependency Graph

**Replaces**: `collectCSSScopeBySolidFile()` in `cross-file/layout/scope.ts` (imperative, recomputed from scratch each time). Cache invalidation via blunt generation counters in `GraphCache`.

**Type signatures**: See `SPEC.ts` section 5 — `DependencyGraph`, `DependencyEdgeInfo`, `DependencyEdgeKind`, `ComponentImportEdge`.

**Key design decisions**:
- `getCSSScope(solidFilePath)` computes the same result as `collectCSSScopeBySolidFile`: direct CSS imports + transitive @import chains + co-located CSS + cross-component CSS + global side-effect CSS.
- `getTransitivelyAffected(filePath)` is the key for incremental updates. CSS file X changes → returns only Solid files whose scope includes X. Only those files need semantic model invalidation.
- Module resolution logic from `module-resolver.ts` moves into the dependency graph builder unchanged.

---

### 6. SemanticModel

**Replaces**: The monolithic `LayoutGraph` — all per-element queries, all cross-file resolution, all derived computation.

**Roslyn mapping**: Like `SemanticModel` which is a per-tree VIEW that DELEGATES to the compilation's symbol table. `FileSemanticModel` is a per-Solid-file view into the compilation's symbol table with lazy cross-file resolution.

**Type signatures**: See `SPEC.ts` section 6 — `FileSemanticModel` (all query methods), `ElementNode`, `ElementCascade`, `CascadedDeclaration`, `SelectorMatch`, `CustomPropertyResolution`, `ScopedSelectorIndex`, `ReactiveKind`, `SignalSnapshot`, `SignalValue`, `SignalSource`, `RuleGuard`, `LayoutFactKind`, `LayoutFactMap`, `ReservedSpaceFact`, `ScrollContainerFact`, `FlowParticipationFact`, `ContainingBlockFact`, `ConditionalSignalDelta`, `AlignmentContext`, `CohortStats`, `CohortProfile`, `CohortSubjectStats`, `TextualContentState`, `StatefulSelectorEntry`, `CompiledSelectorMatcher`.

**Key design decisions**:
- Every query is lazy and cached. `getElementNodes()` builds the element tree on first call. `getElementCascade(elementId)` triggers cascade binding for that ONE element.
- This is the core architectural win: the old system computes cascade for ALL 5000 elements even if only 200 are queried. With lazy binding, only queried elements are computed.
- The model tracks per-element which computation tiers have been triggered via a bitmask to avoid redundant work.

---

### 7. Cascade Binding

**Replaces**: `cascade-builder.ts`'s imperative construction that builds cascade for ALL elements in a single pass.

**Roslyn mapping**: Like `Binder.LookupMembers` — invoked lazily per element, not upfront for all elements.

**Type signatures**: See `SPEC.ts` section 7 — `CascadeBinder`.

**How `getElementCascade(elementId)` works**:
1. Get scoped CSS files from `compilation.dependencyGraph.getCSSScope(filePath)` — cached per semantic model.
2. Build scoped selector index by filtering `symbolTable.selectorsByDispatchKey` to only in-scope CSS files — cached per semantic model.
3. For this element's dispatch keys, collect candidate selectors from the scoped index — O(1) per key.
4. Run each candidate's `compiledMatcher` against the element — pre-compiled into `SelectorSymbol`.
5. Sort matching selectors by cascade precedence: `!important` → layer → specificity → source order.
6. Resolve custom properties through `symbolTable.customProperties`.
7. Merge Tailwind utility declarations — Tailwind utilities are `ClassNameSymbol` with `TailwindClassNameSource`, declarations already resolved.
8. Cache result keyed by `(compilation.id, elementId)`.

---

### 8. Tiered Computation

**Replaces**: The current system that always computes Tier 5 (full alignment model) for ALL elements, even when only Tier 1 rules are active.

**The 6 tiers** (see `SPEC.ts` section 9 — `ComputationTier`, `TierRequirement`):
- **Tier 0** (3 rules): CSS syntax only. Queries touch only CSS syntax trees. No cross-file binding.
- **Tier 1** (11 rules): Solid + CSS syntax. Light symbol table lookups (hasClassName).
- **Tier 2** (2 rules): Element resolution + component hosts. No cascade.
- **Tier 3** (9 rules): Selective layout facts. Cascade computed for queried elements only. Each rule needs 1-3 fact types.
- **Tier 4** (5 rules): Full cascade + signal snapshots + conditional delta.
- **Tier 5** (1 rule): Alignment model with Bayesian evidence scoring.

Each tier is computed ONLY when queried. If no Tier 4+ rules are active, cascade is never computed.

---

### 9. Analyzer Dispatch

**Replaces**: `CrossRuleContext` god-object where `check(context, emit)` receives `solids`, `css`, `layout` — the entire world.

**Roslyn mapping**: Like `CompilationWithAnalyzers` + `AnalyzerDriver` — rules register typed subscriptions, framework inspects subscriptions to determine max tier, computes only that tier, dispatches.

**Type signatures**: See `SPEC.ts` section 10 — `AnalysisDispatcher`, `AnalysisRule`, `AnalysisActionRegistry` (with `registerCSSSyntaxAction`, `registerCrossSyntaxAction`, `registerSymbolAction`, `registerElementAction`, `registerFactAction`, `registerCascadeAction`, `registerConditionalDeltaAction`, `registerAlignmentAction`), `StyleSymbolByKind`, `Emit`, `AnalysisResult`, `AnalysisPerfStats`.

---

### 10. Incremental Updates

**Replaces**: Three-level `GraphCache` with generation counters — any CSS change invalidates entire CSSGraph + LayoutGraph.

**Roslyn mapping**: Like `CompilationTracker` + `SolutionCompilationState` — dependency graph pruning, trackers for unaffected files reused.

**Type signatures**: See `SPEC.ts` section 11 — `CompilationTracker`, `CompilationTrackerOptions`.

**How `applyChange` works**: Parse content → `compilation.withFile()` → dependency graph `getTransitivelyAffected()` → invalidate only affected semantic models → return new tracker.

---

### 11. Tailwind Native Integration

**Replaces**: `TailwindValidator.has()` (boolean) + `TailwindValidator.resolve()` (raw CSS string).

**How it dissolves**: `TailwindProvider` produces `ClassNameSymbol` instances with `TailwindClassNameSource` carrying the full `TailwindParsedCandidate` structure — variants, utility, value, modifier, resolved declarations, theme token references, typed diagnostics.

**Type signatures**: See `SPEC.ts` section 2 (`TailwindParsedCandidate`, `TailwindParsedVariant`, `TailwindCandidateValue`, `TailwindCandidateModifier`, `TailwindResolvedDeclaration`, `TailwindCandidateDiagnostic`) and section 8 (`TailwindProvider`, `TailwindCandidateResult`, `TailwindResolution`, `TailwindVariantInfo`).

**Candidate parsing replicates v4's exact algorithm**: Segment by colon → variant stack + utility root. Permutation root matching. Arbitrary value/modifier parsing with bracket balancing. Variant registry lookup (static, functional, compound, arbitrary). Theme token resolution via CSS variable namespaces.

---

## Part 2: Implementation Phases

### Phase 1: Compilation Shell

**Goal**: `StyleCompilation` holds syntax trees and returns them. `SolidSyntaxTree` and `CSSSyntaxTree` wrap existing parse output with zero-copy bridges.

**New files created**:
- `compilation/core/compilation.ts` — `StyleCompilation` implementation (the `withSolidTree`, `withCSSTree`, `withoutFile`, `withFile`, `getSolidTree`, `getCSSTree` methods + structural sharing)
- `compilation/core/solid-syntax-tree.ts` — `solidGraphToSyntaxTree()` bridge function: takes a `SolidGraph`, returns a `SolidSyntaxTree` where each field is the same array reference
- `compilation/core/css-syntax-tree.ts` — `cssGraphToSyntaxTrees()` bridge function: takes a `CSSGraph`, iterates its `files` array, returns one `CSSSyntaxTree` per file where entity arrays are filtered/sliced from the monolith

**Dependencies**: None.

**Old code still needed**: `solid/impl.ts` (SolidGraph class — parse phases write to it), `css/impl.ts` (CSSGraph class — parse phases write to it), all parse phases in `solid/phases/` and `css/phases/`.

**Old code now replaceable**: Nothing. This phase only adds the new abstraction layer.

**Validation**:
- `compilation.getSolidTree(path).scopes === oldSolidGraph.scopes` (reference equality — zero copy)
- `compilation.getSolidTree(path).jsxElements === oldSolidGraph.jsxElements` (reference equality)
- `compilation.withSolidTree(treeA).cssTrees === compilation.cssTrees` (structural sharing — CSS trees unaffected)
- `compilation.withoutFile(path).getSolidTree(path) === null`
- Round-trip: build compilation from legacy graphs, extract trees, verify every field matches

**Estimated scope**: Small (3 files, ~400 LOC).

---

### Phase 2: Symbol Hierarchy

**Goal**: Symbol types exist and a merged `SymbolTable` is populated from CSS syntax trees. Contains the same class names, selectors, and custom properties as old CSSGraph indexes.

**New files created**:
- `compilation/symbols/symbol-table.ts` — `SymbolTable` implementation
- `compilation/symbols/declaration-table.ts` — `DeclarationTable` with two-forest incremental merge
- `compilation/symbols/class-name.ts` — `ClassNameSymbol`, `CSSClassNameSource`
- `compilation/symbols/selector.ts` — `SelectorSymbol` (wraps existing `CSSSelectorEntity`, pre-compiles matcher)
- `compilation/symbols/declaration.ts` — `DeclarationSymbol`
- `compilation/symbols/custom-property.ts` — `CustomPropertySymbol`
- `compilation/symbols/keyframes.ts` — `KeyframesSymbol`, `KeyframeLayoutMutation`
- `compilation/symbols/font-face.ts` — `FontFaceSymbol`
- `compilation/symbols/layer.ts` — `LayerSymbol`
- `compilation/symbols/container.ts` — `ContainerSymbol`
- `compilation/symbols/theme-token.ts` — `ThemeTokenSymbol`

**Dependencies**: Phase 1 (CSSSyntaxTree must exist).

**Old code still needed**: `css/impl.ts` (CSSGraph — validate against its indexes). `css/entities/` (entity types referenced by symbols). `css/parser/specificity.ts` (specificity computation used by SelectorSymbol).

**Old code now replaceable**: Nothing yet — parallel validation.

**Validation**:
- `Set.from(symbolTable.classNames.keys())` equals `Set.from(oldCSSGraph.classNameIndex.keys())`
- `symbolTable.selectors.size === oldCSSGraph.selectors.length`
- For every selector: `symbolTable.selectors.get(id).specificity` matches old specificity
- `symbolTable.customProperties` keys match `oldCSSGraph.variablesByName` keys (filtered to `--` prefixed)
- `symbolTable.keyframes` keys match `oldCSSGraph.knownKeyframeNames`
- Layer order matches

**Estimated scope**: Medium (11 files, ~1000 LOC).

---

### Phase 3: Dependency Graph

**Goal**: First-class dependency graph produces the same CSS scope results as `collectCSSScopeBySolidFile`.

**New files created**:
- `compilation/incremental/dependency-graph.ts` — `DependencyGraph` implementation (edge extraction from syntax trees, transitive closure for CSS scope, reverse edge index)

**Dependencies**: Phase 1 (syntax trees with import information).

**Old code still needed**: `cross-file/layout/scope.ts` (validate against). `cross-file/layout/module-resolver.ts` (module resolution logic moves here — same algorithm, new location).

**Old code now replaceable**: `cross-file/layout/scope.ts`, `cross-file/layout/module-resolver.ts` (functionally replaced, deletion deferred to Phase 11).

**Validation**:
- For every Solid file in the test suite: `dependencyGraph.getCSSScope(solidFile)` as a Set equals `collectCSSScopeBySolidFile(solids, css).get(solidFile)` as a Set
- Reverse edges: if CSS file X is in scope for Solid file Y, then Y appears in `getReverseDependencies(X)`
- Transitively affected: changing a CSS file X returns exactly the Solid files whose scope includes X

**Estimated scope**: Medium (1 file, ~600 LOC — module resolution is substantial).

---

### Phase 4: CSS Source Providers

**Goal**: `PlainCSSProvider` and `TailwindProvider` produce the same symbols as old CSSGraph + TailwindValidator.

**New files created**:
- `compilation/providers/provider.ts` — `CSSSourceProvider` interface
- `compilation/providers/plain-css.ts` — `PlainCSSProvider` (wraps existing `css/phases/` pipeline, output changed from CSSGraph accumulation to per-file CSSSyntaxTree)
- `compilation/providers/scss.ts` — `SCSSProvider` (wraps PostCSS-SCSS + scss phase)
- `compilation/providers/tailwind.ts` — `TailwindProvider` with native v4 candidate parsing

**Dependencies**: Phase 2 (symbol types to produce).

**Old code still needed**: `css/phases/` (PlainCSSProvider wraps these). `css/tailwind.ts` (TailwindProvider wraps `LiveValidator` during migration).

**Old code now replaceable**: Nothing yet — providers are validated against existing outputs.

**Validation**:
- `PlainCSSProvider.parse(path, content)` produces a `CSSSyntaxTree` whose entities match the corresponding file's entities in old CSSGraph
- `tailwindProvider.has(name)` matches `oldTailwind.has(name)` for the full Tailwind class list
- `tailwindProvider.resolve(name).css` matches `oldTailwind.resolve(name)`
- `tailwindProvider.parseCandidate("hover:bg-red-500/50")` produces correct variant/utility/modifier structure matching v4's algorithm

**Estimated scope**: Large (4 files, ~1500 LOC — Tailwind native parser is the bulk).

---

### Phase 5: SemanticModel Core (Tier 0-1)

**Goal**: `FileSemanticModel` with Tier 0-1 queries (syntax + symbol lookup). Class name queries match old cross-file queries.

**New files created**:
- `compilation/binding/semantic-model.ts` — `FileSemanticModel` implementation (Tier 0-1 query methods: `getClassNameInfo`, `getCustomPropertyResolution`, `getScopedCSSFiles`, `getScopedSelectors`, `getReactiveKind`, `getDependencyEdges`)

**Dependencies**: Phase 2 (symbol table), Phase 3 (dependency graph for CSS scope).

**Old code still needed**: `cross-file/queries.ts` (`getUndefinedCSSClasses`, `getUnusedCSSClasses`, `getUndefinedVariableUsagesInJSX`) — validate against.

**Old code now replaceable**: `cross-file/queries.ts` (functionally replaced).

**Validation**:
- `semanticModel.getClassNameInfo(name) !== null` matches `css.classNameIndex.has(name) || tailwind.has(name)`
- Iterate solid trees' static class tokens, check `getClassNameInfo()` for each → produces same undefined-class results as `getUndefinedCSSClasses()`
- Custom property resolution matches `css.variablesByName` lookups

**Estimated scope**: Medium (1 file, ~500 LOC).

---

### Phase 6: Cascade Binder (Tier 2-3)

**Goal**: Lazy cascade binding produces the same cascade results as old LayoutGraph records.

**New files created**:
- `compilation/binding/cascade-binder.ts` — `CascadeBinder` (cascade sort, selector matching, custom property resolution, Tailwind merge)
- `compilation/binding/element-builder.ts` — `ElementNode` construction from JSX elements (tag resolution, parent-child wiring, class token extraction, sibling indexing, dispatch key computation)
- `compilation/binding/scope-resolver.ts` — `ScopedSelectorIndex` construction (filter symbol table selectors to in-scope CSS files, build dispatch key index)

**Dependencies**: Phase 5 (semantic model shell), Phase 3 (dependency graph for CSS scope).

**Old code still needed**: `cross-file/layout/cascade-builder.ts` (cascade logic moves here). `cross-file/layout/selector-match.ts` (selector matching). `cross-file/layout/selector-dispatch.ts` (dispatch bucketing). `cross-file/layout/element-record.ts` (element construction). `cross-file/layout/component-host.ts` (component host resolution). `cross-file/layout/guard-model.ts` (guard resolution).

**Old code now replaceable**: All of the above (functionally replaced, deletion deferred).

**Validation**:
- For 50+ test cases: `semanticModel.getElementCascade(elementId).declarations` matches `oldLayoutGraph.records.get(elementNode).cascade` entry by entry — same property keys, same values, same source, same guard provenance
- Edge counts match: `getMatchingSelectors(elementId).length === oldRecords.edges.length`
- Component host resolution matches: `getComponentHost(source, name)` returns same host tag and class tokens as old system

**Estimated scope**: Large (3 files, ~2000 LOC).

---

### Phase 7: Signal + Fact Analyzers (Tier 4-5)

**Goal**: Signal snapshots, layout facts, conditional delta, and alignment data match old LayoutGraph derived data.

**New files created**:
- `compilation/binding/signal-builder.ts` — `SignalSnapshot` computation from cascade (signal normalization, inheritance from parent, the forward pass)
- `compilation/analysis/layout-fact.ts` — `ReservedSpaceFact`, `ScrollContainerFact`, `FlowParticipationFact`, `ContainingBlockFact` computation
- `compilation/analysis/cascade-analyzer.ts` — Conditional delta analysis, hot signal extraction
- `compilation/analysis/alignment.ts` — `AlignmentContext`, `CohortStats` computation, Bayesian evidence scoring
- `compilation/analysis/statefulness.ts` — Stateful selector/declaration analysis

**Dependencies**: Phase 6 (cascade binder provides cascade data).

**Old code still needed**: `cross-file/layout/signal-collection.ts`, `cross-file/layout/signal-normalization.ts`, `cross-file/layout/context-model.ts`, `cross-file/layout/context-classification.ts`, `cross-file/layout/cohort-index.ts`, `cross-file/layout/rule-kit.ts`, `cross-file/layout/offset-baseline.ts`, `cross-file/layout/stateful-rule-index.ts`, `cross-file/layout/measurement-node.ts`.

**Old code now replaceable**: All of the above.

**Validation**:
- For every element in the test suite: `getSignalSnapshot(elementId).signals` matches `oldRecords.snapshot.signals` for all 55 signal names — same kind, same normalized value, same px, same guard
- `getLayoutFact(elementId, "reservedSpace")` matches `oldRecords.reservedSpace` — same `hasReservedSpace`, same reasons
- `getLayoutFact(elementId, "scrollContainer")` matches `oldRecords.scrollContainer`
- `getAlignmentContext(parentId)` matches `oldLayoutGraph.contextByParentNode.get(parentNode)` — same kind, certainty, crossAxisIsBlockAxis
- `getCohortStats(parentId)` matches `oldLayoutGraph.cohortStatsByParentNode.get(parentNode)` — same profile, same subject stats

**Estimated scope**: Large (5 files, ~2500 LOC).

---

### Phase 8: Rule Dispatch Framework

**Goal**: Subscription framework exists. Tier 0 rules migrated and producing identical diagnostics through new system.

**New files created**:
- `compilation/dispatch/dispatcher.ts` — `AnalysisDispatcher` implementation
- `compilation/dispatch/registry.ts` — `AnalysisActionRegistry` implementation
- `compilation/dispatch/tier-resolver.ts` — Max tier computation from active rules
- `compilation/dispatch/rule.ts` — `AnalysisRule` interface + `defineAnalysisRule` helper

**Dependencies**: Phase 5 (semantic model), Phase 7 (all computation tiers must be available for full dispatch).

**Old code still needed**: `cross-file/rule.ts` (old CrossRule interface — unmigrated rules still use it). All rule files in `cross-file/rules/`.

**Old code now replaceable**: Nothing yet — framework only.

**Validation**:
- Migrate 3 Tier 0 rules: `css-layout-animation-layout-property`, `css-layout-transition-layout-property`, `css-layout-font-swap-instability`
- Run BOTH old dispatcher (CrossRuleContext) and new dispatcher (AnalysisDispatcher) on full test suite
- Assert identical diagnostics: same rule IDs, same file paths, same line/column, same messages

**Estimated scope**: Medium (4 files, ~600 LOC).

---

### Phase 9: Rule Migration

**Goal**: All 31 rules migrated to `AnalysisRule` interface. Both systems produce identical diagnostics.

**No new files** — rules re-targeted in place within `cross-file/rules/`.

**Dependencies**: Phase 8 (dispatch framework), Phase 7 (all computation tiers available).

**Migration order** (one tier at a time, validated independently):

**Tier 1** (11 rules): `undefined-css-class`, `unreferenced-css-class`, `jsx-classlist-boolean-values`, `jsx-classlist-no-accessor-reference`, `jsx-classlist-no-constant-literals`, `jsx-classlist-static-keys`, `jsx-style-kebab-case-keys`, `jsx-style-no-function-values`, `jsx-style-no-unused-custom-prop`, `jsx-layout-classlist-geometry-toggle`, `jsx-layout-picture-source-ratio-consistency`.

**Tier 2** (2 rules): `jsx-no-duplicate-class-token-class-classlist`, `jsx-style-policy`.

**Tier 3** (9 rules): `jsx-layout-fill-image-parent-must-be-sized`, `css-layout-unsized-replaced-element`, `css-layout-dynamic-slot-no-reserved-space`, `css-layout-overflow-anchor-instability`, `css-layout-scrollbar-gutter-instability`, `css-layout-content-visibility-no-intrinsic-size`, `css-layout-stateful-box-model-shift`, `jsx-layout-unstable-style-toggle`, `jsx-layout-policy-touch-target`, plus 3 others.

**Tier 4** (5 rules): `css-layout-conditional-display-collapse`, `css-layout-conditional-offset-shift`, `css-layout-conditional-white-space-wrap-shift`, `css-layout-overflow-mode-toggle-instability`, `css-layout-box-sizing-toggle-with-chrome`.

**Tier 5** (1 rule): `css-layout-sibling-alignment-outlier`.

**Validation**: After each tier, run full test suite through BOTH dispatchers, diff diagnostics per rule. Zero differences required before proceeding.

**Old code now replaceable**: `cross-file/rule.ts` (CrossRule interface), `cross-file/queries.ts`.

**Estimated scope**: Large (31 files modified, ~3000 LOC changes).

---

### Phase 10: Incremental Updates

**Goal**: `CompilationTracker` replaces `GraphCache`. LSP edit-diagnose cycle works through new system.

**New files created**:
- `compilation/incremental/tracker.ts` — `CompilationTracker` implementation
- `compilation/incremental/change-propagation.ts` — Transitive invalidation via reverse edges

**Dependencies**: Phase 3 (dependency graph), Phase 9 (all rules migrated).

**Old code still needed**: `cache.ts` (GraphCache — validate against during transition).

**Old code now replaceable**: `cache.ts`.

**Validation**:
- Simulate LSP cycles: change CSS file → only affected Solid files re-analyzed
- Change Solid file → only that file's semantic model invalidated
- Diagnostic latency equal to or better than old system
- Full test suite through tracker-based pipeline — zero diagnostic regressions

**Estimated scope**: Medium (2 files, ~800 LOC).

---

### Phase 11: Cleanup

**Goal**: Old system deleted. All tests pass through new system exclusively.

**Deleted**:
- `cross-file/` directory entirely
- `cache.ts`
- `SolidGraph` class from `solid/impl.ts` (parse phases now produce `SolidSyntaxTree` directly)
- `CSSGraph` class from `css/impl.ts` (parse phases now produce `CSSSyntaxTree` directly via providers)

**Retained**:
- `solid/phases/` — become `SolidSyntaxTree` construction
- `solid/entities/` — entity type definitions
- `solid/queries/` — query functions (operate on same-shape data)
- `css/phases/` — become `CSSSyntaxTree` construction inside providers
- `css/entities/` — entity type definitions
- `css/parser/` — selector/value/specificity parsers
- `packages/lsp/src/core/analyze.ts` — updated to use `AnalysisDispatcher`

**Validation**: Full test suite passes. No imports from deleted paths. Zero diagnostic differences from pre-cleanup baseline.

**Estimated scope**: Medium (deletion + import rewiring, ~500 LOC changes).

---

## Part 3: What Stays Unchanged

### Parse phases → syntax tree construction

The 9 Solid phases (`prepare`, `scopes`, `entities`, `context`, `wiring`, `reactivity`, `reachability`, `exports`, `dependencies`) and 6 CSS phases (`parse`, `ast`, `references`, `tokens`, `cascade`, `scss`) keep their implementation. What changes: they write to a `SolidSyntaxTree`/`CSSSyntaxTree` builder instead of mutating `SolidGraph`/`CSSGraph`. What does NOT change: the AST traversal, entity creation logic, scope rules, reactive classification, specificity computation, variable resolution, cascade override detection.

### Entity types — no change

Every file in `solid/entities/` (`scope.ts`, `variable.ts`, `function.ts`, `call.ts`, `jsx.ts`, `import.ts`, `export.ts`, `class.ts`, `property.ts`, `property-assignment.ts`, `spread.ts`, `non-null-assertion.ts`, `type-assertion.ts`, `computation.ts`, `file.ts`, `inline-import.ts`) and `css/entities/` (all entity interfaces, flag constants, the `SelectorPart`/`SelectorCompound`/`CascadePosition` types) stay as-is. Symbols wrap them; they do not change.

### Algorithms that move location but not logic

| Algorithm | Current file | New file | Implementation change |
|---|---|---|---|
| Dispatch key bucketing | `cross-file/layout/selector-dispatch.ts` | `compilation/binding/scope-resolver.ts` | None |
| Selector matching | `cross-file/layout/selector-match.ts` | `compilation/binding/cascade-binder.ts` | None |
| Cascade sort | `cross-file/layout/cascade-builder.ts` | `compilation/binding/cascade-binder.ts` | None |
| Monitored declaration collection | `cross-file/layout/cascade-builder.ts` | `compilation/binding/cascade-binder.ts` | None |
| Guard resolution | `cross-file/layout/guard-model.ts` | `compilation/binding/cascade-binder.ts` | None |
| Element record construction | `cross-file/layout/element-record.ts` | `compilation/binding/element-builder.ts` | None |
| Component host resolution | `cross-file/layout/component-host.ts` | `compilation/binding/semantic-model.ts` | None |
| Module resolution | `cross-file/layout/module-resolver.ts` | `compilation/incremental/dependency-graph.ts` | None |
| Signal normalization | `cross-file/layout/signal-normalization.ts` | `compilation/binding/signal-builder.ts` | None |
| Signal snapshot construction | `cross-file/layout/signal-collection.ts` | `compilation/binding/signal-builder.ts` | None |
| Context classification | `cross-file/layout/context-classification.ts` | `compilation/analysis/alignment.ts` | None |
| Cohort analysis | `cross-file/layout/cohort-index.ts` | `compilation/analysis/alignment.ts` | None |
| Bayesian evidence scoring | `cross-file/layout/rule-kit.ts` | `compilation/analysis/alignment.ts` | None |
| Offset baseline computation | `cross-file/layout/offset-baseline.ts` | `compilation/analysis/alignment.ts` | None |
| Stateful rule indexes | `cross-file/layout/stateful-rule-index.ts` | `compilation/analysis/statefulness.ts` | None |
| Measurement node index | `cross-file/layout/measurement-node.ts` | `compilation/analysis/alignment.ts` | None |

### Infrastructure — no change

| Component | File | Change |
|---|---|---|
| Selector specificity | `css/parser/specificity.ts` | None |
| Selector parser | `css/parser/selector.ts` | None |
| CSS value parser | `css/parser/value.ts` | None |
| CSS value tokenizer | `css/parser/value-tokenizer.ts` | None |
| Animation/transition keywords | `css/parser/animation-transition-keywords.ts` | None |
| Value utilities | `css/parser/value-util.ts` | None |
| CSS string interner | `css/intern.ts` | None |
| Layout taxonomy constants | `css/layout-taxonomy.ts` | None |
| Solid utilities | `solid/util/` (all files) | None |
| Solid queries | `solid/queries/` (all files) | None |
| TypeScript type resolver | `solid/typescript.ts` | None |
| Suppression/comment handling | `suppression.ts` | None |
| Diagnostic creation | `diagnostic.ts` | None |
| Shared constants | `@drskillissue/ganko-shared` | None |

### All 31 rule implementations — re-targeted, not rewritten

Every rule file in `cross-file/rules/` keeps its detection logic. What changes: the rule's `check(context, emit)` signature becomes `register(registry)` with typed subscriptions. The detection algorithm inside the callback is identical — it just receives narrower, typed arguments instead of a god-object context.
